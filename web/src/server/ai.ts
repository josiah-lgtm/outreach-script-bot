// Wrapper around the Anthropic client: loads the key, folds the house lens in as the first
// system block, marks the longest STABLE prefix as a cached breakpoint (only when it actually
// clears the model's minimum), then meters tokens + cost (incl. cache reads/writes), and
// resumes paused server-tool (web_search) turns. Port of legacy index.ts:44-129.

import { messages as rawClaudeMessages } from "./anthropic";
import { ensureAnthropicKey } from "./secrets";
import { usageCtx, RATES, modelKey } from "./usage";

// Minimum cacheable prefix per model, in approximate characters (~4 chars/token).
// Anthropic silently refuses to cache a prefix below the model's minimum. Sonnet 4.6 = 2048
// tokens; Opus 4.6 / Haiku 4.5 = 4096 tokens.
function cacheMinChars(model: unknown): number {
  const m = String(model ?? "").toLowerCase();
  if (m.includes("opus") || m.includes("haiku")) return 16500; // 4096 tok
  return 8300;                                                  // sonnet-4-6: 2048 tok
}

// Caching convention: pass `system` as a single string for a fully-stable prompt, or as a
// multi-block array [stable…, volatile] when the LAST block varies per call (e.g. the
// per-framework block in generate). The cache breakpoint lands on the last stable block.
// deno-lint-ignore no-explicit-any
export async function claudeMessages(opts: any): Promise<any> {
  await ensureAnthropicKey();
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
  // deno-lint-ignore no-explicit-any
  const blocks: any[] = [];
  if (lens && lens.length) blocks.push({ type: "text", text: lens });
  for (const b of sysBlocks) blocks.push(b);
  if (blocks.length) {
    const lastStable = multiBlock ? blocks.length - 2 : blocks.length - 1;
    if (lastStable >= 0) {
      let prefixChars = 0;
      for (let i = 0; i <= lastStable; i++) prefixChars += (blocks[i]?.text?.length ?? 0);
      if (prefixChars >= cacheMinChars(opts?.model)) blocks[lastStable] = { ...blocks[lastStable], cache_control: { type: "ephemeral" } };
    }
    opts = { ...opts, system: blocks };
  }

  // Meter one response's tokens + cost into the per-request accumulator.
  // deno-lint-ignore no-explicit-any
  const meter = (res: any) => {
    const u = res?.usage as { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number } | undefined;
    if (!s || !u) return;
    const r = RATES[modelKey(opts?.model)] || RATES.sonnet;
    const inp = u.input_tokens ?? 0, out = u.output_tokens ?? 0;
    const cw = u.cache_creation_input_tokens ?? 0, cr = u.cache_read_input_tokens ?? 0;
    s.input += inp;
    s.output += out;
    s.cacheWrite = (s.cacheWrite ?? 0) + cw;
    s.cacheRead = (s.cacheRead ?? 0) + cr;
    // input_tokens from the API is the UNCACHED remainder; cache writes bill ~1.25× and reads ~0.1× of input rate.
    s.cost += (inp / 1e6) * r.in + (out / 1e6) * r.out + (cw / 1e6) * r.in * 1.25 + (cr / 1e6) * r.in * 0.1;
  };

  let res = await rawClaudeMessages(opts);
  meter(res);

  // Server-side tools (web_search) pause with stop_reason "pause_turn" at their iteration cap.
  // Resume by appending the paused assistant content and calling again (no extra user turn).
  const hasTools = Array.isArray(opts?.tools) && opts.tools.length > 0;
  let continuations = 0;
  while (hasTools && res?.stop_reason === "pause_turn" && continuations < 5) {
    continuations++;
    const msgs = [...(opts.messages ?? []), { role: "assistant", content: res.content }];
    opts = { ...opts, messages: msgs };
    res = await rawClaudeMessages(opts);
    meter(res);
  }
  return res;
}
