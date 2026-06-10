// Minimal Anthropic Messages API client for Deno Edge Functions.
// Supports non-streaming (used for finalize/synthesis) and streaming (used
// for the conversational turn) with tool use.
//
// Docs: https://docs.anthropic.com/en/api/messages

const API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export const CLAUDE_MODEL = "claude-sonnet-4-6";
export const CLAUDE_MODEL_OPUS = "claude-opus-4-6";
// Cheap/fast model for side tasks: chip suggestions, website summarization.
// Falls back to sonnet at deploy time if haiku-4-5 isn't enabled on the account.
export const CLAUDE_HAIKU = "claude-haiku-4-5";

export interface CacheControl { type: "ephemeral" }

export interface Tool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  cache_control?: CacheControl;
}

/** Block form of `system` — required when you want a cache_control marker. */
export interface SystemBlock {
  type: "text";
  text: string;
  cache_control?: CacheControl;
}

export interface TextBlock { type: "text"; text: string }
export interface ToolUseBlock { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
export interface ToolResultBlock { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }
export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface Message {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

export interface MessagesRequest {
  model: string;
  max_tokens: number;
  system?: string | SystemBlock[];
  messages: Message[];
  tools?: Tool[];
  temperature?: number;
}

export interface MessagesResponse {
  id: string;
  model: string;
  role: "assistant";
  content: ContentBlock[];
  stop_reason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence";
  usage: { input_tokens: number; output_tokens: number };
}

function apiKey(): string {
  const k = Deno.env.get("ANTHROPIC_API_KEY");
  if (!k) throw new Error("ANTHROPIC_API_KEY is not set");
  return k;
}

/** Non-streaming call. Returns the full response. */
export async function messages(req: MessagesRequest): Promise<MessagesResponse> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey(),
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic ${res.status}: ${body}`);
  }
  return (await res.json()) as MessagesResponse;
}

/** SSE event from Anthropic's streaming API. */
export interface StreamEvent {
  type: string;
  // deltas, message snapshots, content_block starts, etc.
  // We only project the fields we care about.
  index?: number;
  content_block?: ContentBlock;
  delta?: {
    type?: "text_delta" | "input_json_delta";
    text?: string;
    partial_json?: string;
    stop_reason?: string;
  };
  message?: MessagesResponse;
}

/**
 * Streaming call. Yields parsed SSE events and, at the end, the assembled
 * assistant message. The caller is responsible for pushing text deltas to
 * its own SSE stream for the client UI.
 */
export async function* messagesStream(req: MessagesRequest): AsyncGenerator<StreamEvent, MessagesResponse, void> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey(),
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({ ...req, stream: true }),
  });
  if (!res.ok || !res.body) {
    const body = await res.text();
    throw new Error(`Anthropic ${res.status}: ${body}`);
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";

  // Build the final assistant message as blocks stream in.
  const blocks: ContentBlock[] = [];
  const partialJson: Record<number, string> = {};
  let stopReason: MessagesResponse["stop_reason"] = "end_turn";
  let usage = { input_tokens: 0, output_tokens: 0 };
  let msgId = "", model = req.model;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;

    // SSE frames are separated by \n\n
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const line = frame.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      const payload = line.slice(6).trim();
      if (!payload || payload === "[DONE]") continue;
      let ev: StreamEvent;
      try { ev = JSON.parse(payload); } catch { continue; }

      // Track block assembly
      if (ev.type === "message_start" && ev.message) {
        msgId = ev.message.id;
        model = ev.message.model;
        usage = ev.message.usage ?? usage;
      } else if (ev.type === "content_block_start" && ev.content_block && typeof ev.index === "number") {
        blocks[ev.index] = structuredClone(ev.content_block);
        if (ev.content_block.type === "tool_use") partialJson[ev.index] = "";
      } else if (ev.type === "content_block_delta" && ev.delta && typeof ev.index === "number") {
        const b = blocks[ev.index];
        if (!b) continue;
        if (ev.delta.type === "text_delta" && b.type === "text" && ev.delta.text) {
          b.text += ev.delta.text;
        } else if (ev.delta.type === "input_json_delta" && ev.delta.partial_json !== undefined) {
          partialJson[ev.index] = (partialJson[ev.index] ?? "") + ev.delta.partial_json;
        }
      } else if (ev.type === "content_block_stop" && typeof ev.index === "number") {
        const b = blocks[ev.index];
        if (b?.type === "tool_use") {
          try { b.input = JSON.parse(partialJson[ev.index] || "{}"); }
          catch { b.input = {}; }
        }
      } else if (ev.type === "message_delta" && ev.delta?.stop_reason) {
        stopReason = ev.delta.stop_reason as MessagesResponse["stop_reason"];
      }

      yield ev;
    }
  }

  return {
    id: msgId,
    model,
    role: "assistant",
    content: blocks,
    stop_reason: stopReason,
    usage,
  };
}
