// Minimal Anthropic Messages API client (Node port of the old Deno _shared/anthropic.ts).
// Non-streaming only — the backend never streamed. Retries transient failures with backoff.
// Docs: https://docs.anthropic.com/en/api/messages

const API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export const CLAUDE_MODEL = "claude-sonnet-4-6";
export const CLAUDE_MODEL_OPUS = "claude-opus-4-6";
// Cheap/fast model for side tasks: chip suggestions, website summarization.
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
  // "pause_turn" is returned when a long server-tool turn (e.g. web_search) is paused
  // and must be resumed by re-sending the assistant content. See claudeMessages().
  stop_reason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" | "pause_turn";
  // cache_* fields are present when prompt caching engages — used by the Usage dashboard.
  usage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
}

// Optional runtime override (set from the admin console). Falls back to the env secret.
let keyOverride: string | null = null;
export function setApiKeyOverride(k: string | null): void { keyOverride = (k && k.trim()) ? k.trim() : null; }
function apiKey(): string {
  const k = keyOverride || process.env.ANTHROPIC_API_KEY;
  if (!k) throw new Error("ANTHROPIC_API_KEY is not set");
  return k;
}

// Retryable transient conditions per Anthropic guidance: 429 (rate limit),
// 529 (overloaded), 500/502/503/504 (server), and thrown network errors.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504, 529]);
const MAX_RETRIES = 3;
function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }
function backoffMs(attempt: number, retryAfter: string | null): number {
  const ra = retryAfter ? Number(retryAfter) : NaN;
  if (Number.isFinite(ra) && ra >= 0) return Math.min(ra * 1000, 20_000);
  // exponential with jitter: ~0.5s, 1s, 2s (+0-250ms)
  return Math.min(500 * 2 ** attempt, 8_000) + Math.floor(Math.random() * 250);
}

/** Non-streaming call. Returns the full response. Retries transient failures with backoff. */
export async function messages(req: MessagesRequest): Promise<MessagesResponse> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let res: Response;
    try {
      res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey(),
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify(req),
      });
    } catch (e) {
      lastErr = e;
      if (attempt < MAX_RETRIES) { await sleep(backoffMs(attempt, null)); continue; }
      throw new Error(`Anthropic request failed: ${String((e as Error).message ?? e)}`);
    }
    if (res.ok) return (await res.json()) as MessagesResponse;
    const body = await res.text();
    if (RETRYABLE_STATUS.has(res.status) && attempt < MAX_RETRIES) {
      await sleep(backoffMs(attempt, res.headers.get("retry-after")));
      continue;
    }
    throw new Error(`Anthropic ${res.status}: ${body}`);
  }
  throw new Error(`Anthropic request failed after retries: ${String((lastErr as Error)?.message ?? lastErr ?? "unknown")}`);
}
