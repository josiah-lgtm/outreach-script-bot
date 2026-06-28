// Usage metering + daily spend cap (powers the admin Usage dashboard).
// Port of legacy index.ts:30-43 + 388-474 (Supabase Storage usage.json → Postgres kv['usage']).

import { AsyncLocalStorage } from "node:async_hooks";
import { kvGet, kvSet } from "./db";

// Approx Anthropic prices, USD per 1M tokens (input/output). Keep in sync with model IDs
// in anthropic.ts. Opus 4.x = $5/$25, Sonnet 4.x = $3/$15, Haiku 4.5 = $1/$5.
export const RATES: Record<string, { in: number; out: number }> = {
  sonnet: { in: 3, out: 15 }, opus: { in: 5, out: 25 }, haiku: { in: 1, out: 5 },
};
export function modelKey(m: unknown): string {
  const s = String(m ?? "").toLowerCase();
  return s.includes("opus") ? "opus" : s.includes("haiku") ? "haiku" : "sonnet";
}

export interface UsageAccum { input: number; output: number; cost: number; lens?: string; cacheRead?: number; cacheWrite?: number }
// Per-request accumulator, concurrency-safe via AsyncLocalStorage.
export const usageCtx = new AsyncLocalStorage<UsageAccum>();

// Daily safety cap on AI calls to control spend. 0 disables. Override via env.
export const DAILY_AI_CALL_CAP = Number(process.env.DAILY_AI_CALL_CAP || 1000);

// Actions that call Claude (and therefore cost money) — the daily cap applies to these only.
export const AI_ACTIONS = new Set([
  "generate", "suggest_angles", "build_icp", "suggest_offers", "fuse_angle", "ai_edit_text",
  "refine_script", "refine_selection", "refine_batch", "ai_edit_batch", "extract_transcript", "extract_framework",
  "research", "research_client_site", "research_niche", "research_competitors",
  "compose_growth_plan", "compose_client_brief", "compose_sales_plan",
  "find_icp_example", "generate_followups",
]);

// deno-lint-ignore no-explicit-any
type UsageDoc = { days: Record<string, any> };
function todayUTC(): string { return new Date().toISOString().slice(0, 10); }

async function usageLoad(): Promise<UsageDoc> {
  try {
    const d = await kvGet<UsageDoc>("usage");
    if (d && d.days) return d;
  } catch { /* fall through */ }
  return { days: {} };
}
async function usageSave(d: UsageDoc): Promise<void> {
  try { await kvSet("usage", d); } catch { /* best effort */ }
}
// deno-lint-ignore no-explicit-any
function dayRec(d: UsageDoc, day: string): any {
  d.days[day] = d.days[day] || { requests: 0, input: 0, output: 0, cost: 0, actions: {} };
  return d.days[day];
}
function pruneDays(d: UsageDoc, keep = 60): void {
  const ks = Object.keys(d.days).sort();
  while (ks.length > keep) { delete d.days[ks.shift() as string]; }
}

// Serialize usage read-modify-write WITHIN this process so concurrent requests don't
// clobber each other's increments.
let usageChain: Promise<unknown> = Promise.resolve();
function withUsage<T>(fn: () => Promise<T>): Promise<T> {
  const run = usageChain.then(fn, fn);
  usageChain = run.then(() => {}, () => {});
  return run;
}

// Pre-call: count `weight` requests for this action today + enforce the daily cap.
export async function usageBumpAndCheck(action: string, weight = 1): Promise<{ ok: boolean; calls: number; cap: number }> {
  const cap = DAILY_AI_CALL_CAP;
  try {
    return await withUsage(async () => {
      const d = await usageLoad();
      const rec = dayRec(d, todayUTC());
      rec.requests += weight;
      const a = rec.actions[action] = rec.actions[action] || { requests: 0, input: 0, output: 0, cost: 0 };
      a.requests += weight;
      pruneDays(d);
      await usageSave(d);
      return { ok: !cap || cap <= 0 || rec.requests <= cap, calls: rec.requests, cap };
    });
  } catch {
    return { ok: true, calls: 0, cap }; // storage down → fail open, never block legit use
  }
}

// Post-call: add the tokens + cost this request actually consumed.
export async function recordActionUsage(action: string, s: UsageAccum | undefined): Promise<void> {
  if (!s || (!s.input && !s.output)) return;
  await withUsage(async () => {
    const d = await usageLoad();
    const rec = dayRec(d, todayUTC());
    rec.input += s.input; rec.output += s.output; rec.cost += s.cost;
    rec.cacheRead = (rec.cacheRead ?? 0) + (s.cacheRead ?? 0);
    rec.cacheWrite = (rec.cacheWrite ?? 0) + (s.cacheWrite ?? 0);
    const a = rec.actions[action] = rec.actions[action] || { requests: 0, input: 0, output: 0, cost: 0 };
    a.input += s.input; a.output += s.output; a.cost += s.cost;
    a.cacheRead = (a.cacheRead ?? 0) + (s.cacheRead ?? 0);
    a.cacheWrite = (a.cacheWrite ?? 0) + (s.cacheWrite ?? 0);
    await usageSave(d);
  });
}

export async function getUsage(): Promise<UsageDoc> { return usageLoad(); }
