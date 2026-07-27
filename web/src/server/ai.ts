// The one place every AI call goes through. Resolves the active provider + tier into a real
// endpoint and model, folds the house lens in as the first system block, marks the longest
// STABLE prefix as a cached breakpoint (only when the provider supports it AND it actually
// clears the model's minimum), drops anything the provider can't do, then meters tokens +
// cost (incl. cache reads/writes) and resumes paused server-tool (web_search) turns.
// Port of legacy index.ts:44-129, generalised over providers (see server/providers.ts).

import { messages as rawMessages } from "./anthropic";
import { resolveEndpoint } from "./secrets";
import { rateFor, tierOf } from "./providers";
import { usageCtx } from "./usage";

// Minimum cacheable prefix per model, in approximate characters (~4 chars/token).
// Anthropic silently refuses to cache a prefix below the model's minimum. Sonnet 4.6 = 2048
// tokens; Opus 4.6 / Haiku 4.5 = 4096 tokens.
function cacheMinChars(model: unknown): number {
  const m = String(model ?? "").toLowerCase();
  if (m.includes("opus") || m.includes("haiku")) return 16500; // 4096 tok
  return 8300;                                                  // sonnet-4-6: 2048 tok
}

// Anthropic's server-side tools (web_search, code execution, MCP) are declared by `type` and
// carry no input_schema — that is what distinguishes them from tools we would execute here.
// deno-lint-ignore no-explicit-any
function isServerTool(t: any): boolean {
  return !!t && typeof t.type === "string" && !t.input_schema;
}

// When the provider can't search, say so plainly — otherwise prompts that ask for "up to 5
// web searches" get answered from memory, and research actions must never invent findings.
const NO_SEARCH_NOTE =
  "TOOLING NOTE: web search is NOT available on this model. Ignore any instruction below to " +
  "search the web, and never claim or imply that you searched. Work only from the information " +
  "given in this conversation. Leave anything you cannot support with that information as an " +
  "empty string or empty array rather than guessing.";

// Caching convention: pass `system` as a single string for a fully-stable prompt, or as a
// multi-block array [stable…, volatile] when the LAST block varies per call (e.g. the
// per-framework block in generate). The cache breakpoint lands on the last stable block.
// deno-lint-ignore no-explicit-any
export async function aiMessages(opts: any): Promise<any> {
  const { spec, endpoint } = await resolveEndpoint();
  const tier = tierOf(opts?.model);
  const model = spec.models[tier];
  const s = usageCtx.getStore();
  const lens = s && s.lens;

  // deno-lint-ignore no-explicit-any
  const rawSys: any = opts?.system;
  const multiBlock = Array.isArray(rawSys) && rawSys.length > 1; // caller flagged a volatile tail
  // deno-lint-ignore no-explicit-any
  const sysBlocks: any[] = typeof rawSys === "string"
    ? (rawSys ? [{ type: "text", text: rawSys }] : [])
    : Array.isArray(rawSys)
      ? rawSys.map((b) => ({ type: "text", text: String((b && b.text) ?? "") }))
      : [];

  // Drop tools the provider doesn't run (DeepSeek's Anthropic-compatible endpoint has no
  // server-side web search). PREPENDING the note rather than appending it keeps the caller's
  // "last block is volatile" contract — and therefore the cache breakpoint — intact.
  // deno-lint-ignore no-explicit-any
  const rawTools: any[] = Array.isArray(opts?.tools) ? opts.tools : [];
  const tools = spec.webSearch ? rawTools : rawTools.filter((t) => !isServerTool(t));
  const droppedServerTools = tools.length < rawTools.length;

  // deno-lint-ignore no-explicit-any
  const blocks: any[] = [];
  if (droppedServerTools) blocks.push({ type: "text", text: NO_SEARCH_NOTE });
  if (lens && lens.length) blocks.push({ type: "text", text: lens });
  for (const b of sysBlocks) blocks.push(b);
  if (spec.promptCaching && blocks.length) {
    const lastStable = multiBlock ? blocks.length - 2 : blocks.length - 1;
    if (lastStable >= 0) {
      let prefixChars = 0;
      for (let i = 0; i <= lastStable; i++) prefixChars += (blocks[i]?.text?.length ?? 0);
      if (prefixChars >= cacheMinChars(model)) blocks[lastStable] = { ...blocks[lastStable], cache_control: { type: "ephemeral" } };
    }
  }
  opts = { ...opts, model, ...(blocks.length ? { system: blocks } : {}) };
  if (rawTools.length) {
    if (tools.length) opts.tools = tools;
    else delete opts.tools;
  }

  // Meter one response's tokens + cost into the per-request accumulator.
  // deno-lint-ignore no-explicit-any
  const meter = (res: any) => {
    const u = res?.usage as { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number } | undefined;
    if (!s || !u) return;
    const r = rateFor(spec, tier);
    const inp = u.input_tokens ?? 0, out = u.output_tokens ?? 0;
    const cw = u.cache_creation_input_tokens ?? 0, cr = u.cache_read_input_tokens ?? 0;
    s.input += inp;
    s.output += out;
    s.cacheWrite = (s.cacheWrite ?? 0) + cw;
    s.cacheRead = (s.cacheRead ?? 0) + cr;
    // input_tokens from the API is the UNCACHED remainder; cache reads/writes each bill at
    // their own per-1M price (Anthropic ~0.1×/~1.25× of input; DeepSeek a flat cache-hit rate).
    s.cost += (inp / 1e6) * r.in + (out / 1e6) * r.out + (cw / 1e6) * r.cacheWrite + (cr / 1e6) * r.cacheRead;
  };

  let res = await rawMessages(opts, endpoint);
  meter(res);

  // Server-side tools (web_search) pause with stop_reason "pause_turn" at their iteration cap.
  // Resume by appending the paused assistant content and calling again (no extra user turn).
  const hasTools = Array.isArray(opts?.tools) && opts.tools.length > 0;
  let continuations = 0;
  while (hasTools && res?.stop_reason === "pause_turn" && continuations < 5) {
    continuations++;
    const msgs = [...(opts.messages ?? []), { role: "assistant", content: res.content }];
    opts = { ...opts, messages: msgs };
    res = await rawMessages(opts, endpoint);
    meter(res);
  }
  return res;
}
