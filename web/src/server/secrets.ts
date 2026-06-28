// Anthropic key management (admin can rotate from the console).
// An admin-set key in kv['secrets'] overrides the env ANTHROPIC_API_KEY; clearing reverts to env.
// Port of legacy index.ts:131-177 (Supabase Storage secrets.json → Postgres kv).

import { kvGet, kvSet } from "./db";
import { setApiKeyOverride, CLAUDE_HAIKU } from "./anthropic";

let __keyAt = 0;

export async function secretsLoad(): Promise<Record<string, string>> {
  try {
    const d = await kvGet<Record<string, string>>("secrets");
    if (d && typeof d === "object") return d;
  } catch { /* ignore */ }
  return {};
}

export async function secretsSave(s: Record<string, string>): Promise<void> {
  await kvSet("secrets", s);
}

export async function ensureAnthropicKey(): Promise<void> {
  const now = Date.now();
  if (now - __keyAt < 30_000) return; // refresh the override at most every 30s per process
  __keyAt = now;
  try { const s = await secretsLoad(); setApiKeyOverride(s.anthropicKey || null); } catch { /* keep env */ }
}

/** Force the next ensureAnthropicKey() to skip its 30s throttle (call after set/clear). */
export function markKeyChanged(): void { __keyAt = Date.now(); }

export async function anthropicKeyStatus(): Promise<{ set: boolean; source: string; last4: string }> {
  const stored = (await secretsLoad()).anthropicKey;
  const env = process.env.ANTHROPIC_API_KEY;
  const k = stored || env || "";
  return { set: !!k, source: stored ? "stored" : (env ? "env" : "none"), last4: k ? k.slice(-4) : "" };
}

// Tiny 1-token call to validate a key. Tests the given key, or the resolved (stored/env) one.
export async function testAnthropicKey(candidate?: string): Promise<{ ok: boolean; model?: string; error?: string }> {
  const key = (candidate && candidate.trim()) || (await secretsLoad()).anthropicKey || process.env.ANTHROPIC_API_KEY || "";
  if (!key) return { ok: false, error: "No key set" };
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: CLAUDE_HAIKU, max_tokens: 1, messages: [{ role: "user", content: "ping" }] }),
    });
    if (res.ok) return { ok: true, model: CLAUDE_HAIKU };
    return { ok: false, error: `Anthropic ${res.status}: ${(await res.text()).slice(0, 160)}` };
  } catch (e) { return { ok: false, error: String((e as Error).message ?? e) }; }
}
