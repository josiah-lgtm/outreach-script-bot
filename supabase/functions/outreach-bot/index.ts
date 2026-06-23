// Outreach Script Bot — Supabase Edge Function (v3)
//
// GET  → serves the UI (bundled into html.ts by deploy.sh).
// POST → JSON actions, all guarded by x-admin-key (ADMIN_KEY secret):
//   generate              → matrix generation: one Claude call per framework,
//                           one script per angle × variantsPerAngle, parallel.
//   research              → prospect website → insights/pains/hooks (haiku).
//   research_client_site  → onboard an agency client: scrape their site (+ web
//                           search for case studies/reviews) → mechanism,
//                           results, proof line, offers, case studies.
//   research_niche        → real web search (Reddit/forums/Google) on a niche →
//                           pains, angles, trigger words, desires, objections.
//   research_competitors  → web search for the client's competitors → their
//                           offers, mechanisms, results, guarantees.
//   get_config / save_config → config persistence in Supabase Storage.
//
// Web research uses Anthropic's server-side web_search tool — searches run on
// Anthropic's side; no search API keys needed. No API keys ever reach the
// browser.

import { CLAUDE_HAIKU, CLAUDE_MODEL, CLAUDE_MODEL_OPUS, messages as rawClaudeMessages, setApiKeyOverride, type Tool } from "../_shared/anthropic.ts";
import { AsyncLocalStorage } from "node:async_hooks";

// Map a safe model alias (from the UI) to a real Claude model id. Unknown → default.
function pickModel(alias: unknown): string {
  const map: Record<string, string> = { sonnet: CLAUDE_MODEL, opus: CLAUDE_MODEL_OPUS, haiku: CLAUDE_HAIKU };
  return map[String(alias ?? "").toLowerCase()] || CLAUDE_MODEL;
}

// ─── Usage metering (powers the admin Usage dashboard) ───────────────────────
// Approx Anthropic prices, USD per 1M tokens (input/output). Adjust if pricing changes.
// Keep in sync with the model IDs in _shared/anthropic.ts. Opus 4.x = $5/$25,
// Sonnet 4.x = $3/$15, Haiku 4.5 = $1/$5 per 1M tokens (input/output).
const RATES: Record<string, { in: number; out: number }> = {
  sonnet: { in: 3, out: 15 }, opus: { in: 5, out: 25 }, haiku: { in: 1, out: 5 },
};
function modelKey(m: unknown): string {
  const s = String(m ?? "").toLowerCase();
  return s.includes("opus") ? "opus" : s.includes("haiku") ? "haiku" : "sonnet";
}
interface UsageAccum { input: number; output: number; cost: number; lens?: string; cacheRead?: number; cacheWrite?: number }
// Per-request accumulator, concurrency-safe via AsyncLocalStorage.
const usageCtx = new AsyncLocalStorage<UsageAccum>();

// Minimum cacheable prefix per model, in approximate characters (~4 chars/token).
// Anthropic silently refuses to cache a prefix below the model's minimum, so a
// cache_control marker on a too-short prefix is a no-op (you pay full price and the
// dashboard can't tell). Sonnet 4.6 = 2048 tokens; Opus 4.6 / Haiku 4.5 = 4096 tokens.
function cacheMinChars(model: unknown): number {
  const m = String(model ?? "").toLowerCase();
  if (m.includes("opus") || m.includes("haiku")) return 16500;  // 4096 tok
  return 8300;                                                   // sonnet-4-6: 2048 tok
}

// Wrapper around the Claude client: loads the key, folds the house lens in as the first
// system block, marks the longest STABLE prefix as a cached breakpoint (only when it
// actually clears the model's minimum), then meters tokens + cost (incl. cache reads/writes).
//
// Caching convention: pass `system` as a single string for a fully-stable prompt, or as a
// multi-block array [stable…, volatile] when the LAST block varies per call (e.g. the
// per-framework block in generate). The cache breakpoint lands on the last stable block,
// so [lens + stable…] is cached and the volatile tail stays uncached.
// deno-lint-ignore no-explicit-any
async function claudeMessages(opts: any): Promise<any> {
  await ensureAnthropicKey();
  const s = usageCtx.getStore();
  const lens = s && s.lens;

  // deno-lint-ignore no-explicit-any
  const rawSys: any = opts?.system;
  const multiBlock = Array.isArray(rawSys) && rawSys.length > 1;  // caller flagged a volatile tail
  // deno-lint-ignore no-explicit-any
  const sysBlocks: any[] = typeof rawSys === "string"
    ? (rawSys ? [{ type: "text", text: rawSys }] : [])
    : Array.isArray(rawSys)
      ? rawSys.map((b) => ({ type: "text", text: String((b && b.text) ?? "") }))  // strip any pre-set cache_control; we decide below
      : [];
  // deno-lint-ignore no-explicit-any
  const blocks: any[] = [];
  if (lens && lens.length) blocks.push({ type: "text", text: lens });
  for (const b of sysBlocks) blocks.push(b);
  if (blocks.length) {
    // Last stable block: everything except the final block when the caller passed a
    // multi-block (volatile-tail) system; otherwise the whole thing is stable.
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

  // Server-side tools (web_search) run an internal sampling loop that stops with
  // stop_reason "pause_turn" once it hits its iteration cap. To get the final answer
  // we must resume: append the paused assistant content as an assistant message and
  // call again (no extra user turn — the trailing server_tool_use is the resume signal).
  // Without this, textOf()/parseJson see a partial turn with no final text and every
  // web-search research action silently returns its parse-failure fallback.
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

// ─── Anthropic key management (admin can rotate from the console) ─────────────
// An admin-set key in secrets.json overrides the env ANTHROPIC_API_KEY; clearing reverts to env.
let __keyAt = 0;
async function secretsLoad(): Promise<Record<string, string>> {
  try {
    const { url, headers } = storageEnv();
    const r = await fetch(`${url}/storage/v1/object/${BUCKET}/secrets.json`, { headers });
    if (r.ok) { const d = await r.json().catch(() => null); if (d && typeof d === "object") return d as Record<string, string>; }
  } catch { /* ignore */ }
  return {};
}
async function secretsSave(s: Record<string, string>): Promise<void> {
  const { url, headers } = storageEnv();
  await fetch(`${url}/storage/v1/bucket`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }) }).catch(() => {});
  const res = await fetch(`${url}/storage/v1/object/${BUCKET}/secrets.json`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json", "x-upsert": "true" },
    body: JSON.stringify(s),
  });
  if (!res.ok) throw new Error(`secrets save failed: ${res.status}`);
}
async function ensureAnthropicKey(): Promise<void> {
  const now = Date.now();
  if (now - __keyAt < 30_000) return;   // refresh the override at most every 30s per isolate
  __keyAt = now;
  try { const s = await secretsLoad(); setApiKeyOverride(s.anthropicKey || null); } catch { /* keep env */ }
}
async function anthropicKeyStatus(): Promise<{ set: boolean; source: string; last4: string }> {
  const stored = (await secretsLoad()).anthropicKey;
  const env = Deno.env.get("ANTHROPIC_API_KEY");
  const k = stored || env || "";
  return { set: !!k, source: stored ? "stored" : (env ? "env" : "none"), last4: k ? k.slice(-4) : "" };
}
// Tiny 1-token call to validate a key. Tests the given key, or the resolved (stored/env) one.
async function testAnthropicKey(candidate?: string): Promise<{ ok: boolean; model?: string; error?: string }> {
  const key = (candidate && candidate.trim()) || (await secretsLoad()).anthropicKey || Deno.env.get("ANTHROPIC_API_KEY") || "";
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
import { HTML } from "./html.ts";

// ─── Limits ───────────────────────────────────────────────────────────────────
const MAX_FRAMEWORKS = 6;
const MAX_ANGLES = 8;
const MAX_VARIANTS_PER_ANGLE = 3;
const MAX_TOTAL_SCRIPTS = Number(Deno.env.get("MAX_TOTAL_SCRIPTS") || 24);   // was 48 — caps scripts (and output cost) per generate run
const MAX_PROMPT_CHARS = Number(Deno.env.get("MAX_PROMPT_CHARS") || 80_000);  // input ceiling; was 150k. 40k was too small for filter-laden prompts, 80k is safe + cheaper
// Daily safety cap on AI calls to control spend if the admin key is ever abused. 0 disables.
// Override at runtime with the DAILY_AI_CALL_CAP secret (no code change / redeploy of logic needed).
const DAILY_AI_CALL_CAP = Number(Deno.env.get("DAILY_AI_CALL_CAP") || 1000);

// Anthropic server-side web search tool (executed by the API, not by us).
const webSearchTool = (maxUses: number): Tool =>
  ({ type: "web_search_20250305", name: "web_search", max_uses: maxUses }) as unknown as Tool;

function textOf(content: Array<{ type: string }>): string {
  return content.filter((b) => b.type === "text").map((b) => (b as unknown as { text: string }).text).join("");
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    // Tolerate fences and prose around the JSON object.
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1) return fallback;
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  } catch {
    return fallback;
  }
}

// ─── Notion export helpers ──────────────────────────────────────────────────
// Notion rich_text content caps at 2000 chars; keep a safe margin.
function nRich(content: string) {
  return [{ type: "text", text: { content: String(content ?? "").slice(0, 1900) } }];
}
// Convert the app's portable block list into Notion API block objects.
// deno-lint-ignore no-explicit-any
function toNotionBlock(b: { t: string; text?: string; headers?: string[]; rows?: string[][]; children?: Array<{ t: string }> }): any {
  switch (b.t) {
    case "h1": return { object: "block", type: "heading_1", heading_1: { rich_text: nRich(b.text ?? "") } };
    case "h2": return { object: "block", type: "heading_2", heading_2: { rich_text: nRich(b.text ?? "") } };
    case "h3": return { object: "block", type: "heading_3", heading_3: { rich_text: nRich(b.text ?? "") } };
    case "callout": return { object: "block", type: "callout", callout: { rich_text: nRich(b.text ?? ""), icon: { emoji: "📌" } } };
    case "bullet": return { object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: nRich(b.text ?? "") } };
    case "todo": return { object: "block", type: "to_do", to_do: { rich_text: nRich(b.text ?? ""), checked: false } };
    case "code": return { object: "block", type: "code", code: { rich_text: nRich(b.text ?? ""), language: "plain text" } };
    case "toggle": {
      const kids = (b.children ?? []).map(toNotionBlock);
      return { object: "block", type: "toggle", toggle: { rich_text: nRich(b.text ?? ""), children: kids.slice(0, 100) } };
    }
    case "image": {
      const url = String((b as { url?: string }).url ?? "");
      return { object: "block", type: "image", image: { type: "external", external: { url } } };
    }
    case "bookmark": {
      return { object: "block", type: "bookmark", bookmark: { url: String((b as { url?: string }).url ?? "") } };
    }
    case "divider": return { object: "block", type: "divider", divider: {} };
    case "table": {
      const headers = b.headers ?? [];
      const rows = b.rows ?? [];
      const width = Math.max(1, headers.length || (rows[0]?.length ?? 1));
      // Notion rejects any table_row whose cell count != table_width, so pad/trim every row.
      const norm = (cells: string[]) => {
        const a = (cells || []).slice(0, width).map((c) => nRich(c));
        while (a.length < width) a.push(nRich(""));
        return a;
      };
      const tableRows: unknown[] = [];
      if (headers.length) tableRows.push({ type: "table_row", table_row: { cells: norm(headers) } });
      rows.forEach((r) => tableRows.push({ type: "table_row", table_row: { cells: norm(r) } }));
      if (!tableRows.length) tableRows.push({ type: "table_row", table_row: { cells: norm([""]) } });
      // Notion caps a block's children at 100 per request, and table rows can only be
      // supplied at creation (no append-rows API), so an oversized table would 422 the
      // whole page. Cap to 100 rows to keep the export from failing/silently dropping.
      return { object: "block", type: "table", table: { table_width: width, has_column_header: headers.length > 0, has_row_header: false, children: tableRows.slice(0, 100) } };
    }
    default: return { object: "block", type: "paragraph", paragraph: { rich_text: nRich(b.text ?? "") } };
  }
}
function dashifyId(raw: string): string {
  const id = String(raw).replace(/-/g, "");
  return id.length === 32 ? `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}` : raw;
}

// ─── Config storage (Supabase Storage, service-role only) ─────────────────────
const BUCKET = "outreach-bot";
const OBJECT = "config.json";

function storageEnv() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("storage env not available");
  // `apikey` works for both legacy JWT service keys and new sb_secret_ keys;
  // the bare Bearer header alone fails JWT parsing on new-style keys.
  return { url, headers: { Authorization: `Bearer ${key}`, apikey: key } };
}

function cfgRev(c: unknown): number {
  const r = (c && typeof c === "object") ? (c as { _rev?: unknown })._rev : undefined;
  const n = Number(r);
  return Number.isFinite(n) ? n : 0;
}

// Returns {ok:true, config} (config may be null if none is stored yet), or
// {ok:false, status} on a transient/error response. The caller MUST distinguish
// these: a transient read failure must NOT be treated as "no config" (that path
// lets a stale client overwrite a good server copy).
async function configLoad(): Promise<{ ok: true; config: unknown | null } | { ok: false; status: number }> {
  const { url, headers } = storageEnv();
  const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${OBJECT}`, { headers });
  if (res.status === 404) return { ok: true, config: null };   // no config stored yet
  if (!res.ok) return { ok: false, status: res.status };       // transient/error
  return { ok: true, config: await res.json().catch(() => null) };
}

// Compare-and-swap save. `baseRev` is the _rev the client last loaded. If the stored
// config has advanced past it, another writer won the race → return a conflict with the
// current server copy so the client can merge instead of clobbering. On success we stamp
// a server-authoritative monotonic _rev (immune to client wall-clock skew).
// NOTE: this is read-then-write against Supabase Storage, which has no atomic CAS, so two
// saves sharing the SAME baseRev can still race (mitigated, not eliminated — true atomicity
// would need a Postgres row). It does reliably stop the dominant case: a stale client
// (older baseRev) silently overwriting a newer server copy.
async function configSave(
  config: Record<string, unknown>,
  baseRev: number | null,
): Promise<{ ok: true; rev: number } | { ok: false; conflict: true; config: unknown; rev: number }> {
  const cur = await configLoad();
  if (!cur.ok) throw new Error(`config read failed: ${cur.status}`);  // never blind-overwrite when the current rev is unknown
  const storedRev = cfgRev(cur.config);
  // CAS: if the client sent a baseRev (CAS-aware client — always does, using 0 when it has
  // never synced) and a server copy exists whose rev differs, another writer is ahead → return
  // a conflict so the client merges instead of clobbering. baseRev === null means a legacy
  // client that predates CAS: keep the old last-write-wins behaviour for backward compatibility.
  if (baseRev !== null && cur.config && storedRev !== baseRev) {
    return { ok: false, conflict: true, config: cur.config, rev: storedRev };
  }
  const newRev = storedRev + 1;
  const toStore = { ...config, _rev: newRev };
  const { url, headers } = storageEnv();
  await fetch(`${url}/storage/v1/bucket`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }),
  }).catch(() => {});
  const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${OBJECT}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json", "x-upsert": "true" },
    body: JSON.stringify(toStore),
  });
  if (!res.ok) throw new Error(`config save failed: ${res.status} ${await res.text()}`);
  return { ok: true, rev: newRev };
}

// ─── Team logins (email + password → the shared admin key) ───────────────────
// Users live in the same private bucket; passwords stored as PBKDF2 hashes.
interface TeamUser { email: string; name: string; salt: string; hash: string; createdAt: string }

async function usersLoad(): Promise<TeamUser[]> {
  const { url, headers } = storageEnv();
  const res = await fetch(`${url}/storage/v1/object/${BUCKET}/users.json`, { headers });
  if (!res.ok) return [];
  const data = await res.json().catch(() => null);
  return Array.isArray(data?.users) ? data.users : [];
}

async function usersSave(users: TeamUser[]): Promise<void> {
  const { url, headers } = storageEnv();
  const res = await fetch(`${url}/storage/v1/object/${BUCKET}/users.json`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json", "x-upsert": "true" },
    body: JSON.stringify({ users }),
  });
  if (!res.ok) throw new Error(`users save failed: ${res.status}`);
}

// ─── Login brute-force throttle (per IP + per email) ─────────────────────────
// The fixed 900ms sleep alone doesn't stop parallel password spraying (each request
// is its own isolate). This adds a real attempt budget per IP and per email, so a
// guessed weak password can't be found by a high-rate online spray.
interface LoginAttempt { n: number; first: number }
const LOGIN_WINDOW_MS = 15 * 60_000;   // rolling 15-minute window
const LOGIN_MAX = 8;                    // failures per key per window before lockout
async function loginAttemptsLoad(): Promise<Record<string, LoginAttempt>> {
  try {
    const { url, headers } = storageEnv();
    const r = await fetch(`${url}/storage/v1/object/${BUCKET}/login-attempts.json`, { headers });
    if (r.ok) { const d = await r.json().catch(() => null); if (d && typeof d === "object") return d as Record<string, LoginAttempt>; }
  } catch { /* ignore */ }
  return {};
}
async function loginAttemptsSave(d: Record<string, LoginAttempt>): Promise<void> {
  try {
    const { url, headers } = storageEnv();
    await fetch(`${url}/storage/v1/object/${BUCKET}/login-attempts.json`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json", "x-upsert": "true" },
      body: JSON.stringify(d),
    });
  } catch { /* best effort */ }
}
function loginClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") || "";
  return (xff.split(",")[0] || "").trim() || req.headers.get("cf-connecting-ip") || "unknown";
}

// ─── Usage metering + daily spend cap ────────────────────────────────────────
// Stored as usage.json in the private bucket:
//   { days: { 'YYYY-MM-DD': { requests, input, output, cost, actions: { [action]: {requests,input,output,cost} } } } }
// deno-lint-ignore no-explicit-any
type UsageDoc = { days: Record<string, any> };
function todayUTC(): string { return new Date().toISOString().slice(0, 10); }
async function usageLoad(): Promise<UsageDoc> {
  try {
    const { url, headers } = storageEnv();
    const res = await fetch(`${url}/storage/v1/object/${BUCKET}/usage.json`, { headers });
    if (res.ok) { const d = await res.json().catch(() => null); if (d && d.days) return d; }
  } catch { /* fall through */ }
  return { days: {} };
}
async function usageSave(d: UsageDoc): Promise<void> {
  try {
    const { url, headers } = storageEnv();
    await fetch(`${url}/storage/v1/object/${BUCKET}/usage.json`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json", "x-upsert": "true" },
      body: JSON.stringify(d),
    });
  } catch { /* best effort */ }
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
// Serialize usage.json read-modify-write WITHIN this isolate so concurrent requests
// don't clobber each other's increments. Cross-isolate races remain (true atomicity
// would need a Postgres counter), but Deno reuses isolates so this removes the common case.
let usageChain: Promise<unknown> = Promise.resolve();
function withUsage<T>(fn: () => Promise<T>): Promise<T> {
  const run = usageChain.then(fn, fn);
  usageChain = run.then(() => {}, () => {});
  return run;
}
// Pre-call: count `weight` requests for this action today + enforce the daily cap.
// `weight` is the number of real Claude calls the action will make (e.g. one per
// framework for generate), so the cap bounds actual model spend, not just POSTs.
async function usageBumpAndCheck(action: string, weight = 1): Promise<{ ok: boolean; calls: number; cap: number }> {
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
    return { ok: true, calls: 0, cap };  // storage down → fail open, never block legit use
  }
}
// Post-call: add the tokens + cost this request actually consumed.
async function recordActionUsage(action: string, s: UsageAccum | undefined): Promise<void> {
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

// Actions that call Claude (and therefore cost money) — the daily cap applies to these only.
const AI_ACTIONS = new Set([
  "generate", "suggest_angles", "build_icp", "suggest_offers", "fuse_angle", "ai_edit_text",
  "refine_script", "refine_selection", "refine_batch", "ai_edit_batch", "extract_transcript", "extract_framework",
  "research", "research_client_site", "research_niche", "research_competitors",
  "compose_growth_plan", "compose_client_brief", "compose_sales_plan",
  "find_icp_example", "generate_followups",
]);

const hexBytes = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function hashPassword(password: string, saltHex: string): Promise<string> {
  const salt = new Uint8Array((saltHex.match(/.{2}/g) ?? []).map((h) => parseInt(h, 16)));
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" }, keyMaterial, 256);
  return hexBytes(bits);
}

// ─── SSRF guard ──────────────────────────────────────────────────────────────
// fetchSiteText pulls arbitrary user-supplied URLs server-side, so it must refuse to
// reach loopback / link-local / private / cloud-metadata addresses, and must re-check
// every redirect hop (an attacker page can 302 to an internal target).
function ipIsPrivate(ip: string): boolean {
  const s = ip.trim().toLowerCase();
  if (s.includes(":")) { // IPv6
    if (s === "::1" || s === "::") return true;
    if (s.startsWith("fe80") || s.startsWith("fc") || s.startsWith("fd")) return true; // link-local + unique-local
    const m = s.match(/(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped (::ffff:a.b.c.d)
    return m ? ipIsPrivate(m[1]) : false;
  }
  const p = s.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = p;
  if (a === 0 || a === 10 || a === 127) return true;                // this-network, private, loopback
  if (a === 169 && b === 254) return true;                          // link-local incl. 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true;                 // private
  if (a === 192 && b === 168) return true;                          // private
  if (a === 100 && b >= 64 && b <= 127) return true;                // CGNAT
  return false;
}
function hostIsBlocked(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase(); // strip IPv6 brackets
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (/^[0-9.]+$/.test(h) || h.includes(":")) return ipIsPrivate(h); // literal IP
  return false;
}
// Best-effort DNS-rebinding defense: reject if a hostname resolves to a private IP.
// If Deno.resolveDns is unavailable/blocked, fall back to the literal-host check only.
async function hostResolvesPrivate(hostname: string): Promise<boolean> {
  const h = hostname.replace(/^\[|\]$/g, "");
  if (/^[0-9.]+$/.test(h) || h.includes(":")) return false; // literal IP already checked
  try {
    const a4 = await Deno.resolveDns(h, "A").catch(() => [] as string[]);
    const a6 = await Deno.resolveDns(h, "AAAA").catch(() => [] as string[]);
    const all = [...a4, ...a6];
    return all.length > 0 && all.some(ipIsPrivate);
  } catch { return false; }
}
async function assertPublicUrl(u: URL): Promise<void> {
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error(`blocked scheme ${u.protocol}`);
  if (hostIsBlocked(u.hostname)) throw new Error(`blocked host ${u.hostname}`);
  if (await hostResolvesPrivate(u.hostname)) throw new Error(`host resolves to a private address: ${u.hostname}`);
}
// fetch that validates the initial URL and every redirect hop.
async function safeFetch(target: string, init: RequestInit, maxHops = 5): Promise<Response> {
  let url = new URL(target);
  for (let hop = 0; hop <= maxHops; hop++) {
    await assertPublicUrl(url);
    const res = await fetch(url, { ...init, redirect: "manual" });
    const loc = (res.status >= 300 && res.status < 400) ? res.headers.get("location") : null;
    if (loc) { url = new URL(loc, url); continue; } // resolve relative redirects, re-validate next loop
    return res;
  }
  throw new Error("too many redirects");
}

// ─── Site fetching ─────────────────────────────────────────────────────────────
async function fetchSiteText(rawUrl: string): Promise<{ ok: true; target: string; text: string } | { ok: false; error: string }> {
  let target = rawUrl.trim();
  if (!/^https?:\/\//i.test(target)) target = "https://" + target;
  try {
    const res = await safeFetch(target, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; OutreachBot/3.0)" },
      signal: AbortSignal.timeout(12_000),
    });
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z#0-9]+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 11_000);
    if (text.length < 100) return { ok: false, error: `Fetched ${target} but found almost no readable text (JS-rendered site?)` };
    return { ok: true, target, text };
  } catch (err) {
    return { ok: false, error: `Could not fetch ${target}: ${String((err as Error).message ?? err)}` };
  }
}

// ─── Research actions ──────────────────────────────────────────────────────────
// Prospect research (used at generate time) — cheap direct scrape; falls back
// to web search when the site is JS-rendered or blocked.
async function researchProspect(rawUrl: string, classification: string) {
  const page = await fetchSiteText(rawUrl);
  const sparse = !page.ok || page.text.length < 300;
  const target = page.ok ? page.target : normalizeUrl(rawUrl);
  const system =
    `You are a cold outreach researcher. ` +
    (sparse
      ? `The prospect's website could not be read directly — use web search (up to 3 searches) on their domain/company to learn about them. `
      : `You are given the text of a prospect company's website. `) +
    `Extract what matters for personalizing a cold email. Return valid JSON only, no markdown fences:\n` +
    `{"summary":"2-3 sentences: what they do, who they sell to, anything notable",` +
    `"pains":["3-4 likely business pains, specific to them"],` +
    `"hooks":["3-4 personalization hooks — concrete details a cold email could reference"]}`;
  const res = await claudeMessages({
    model: CLAUDE_HAIKU,
    max_tokens: 1200,
    system,
    messages: [{
      role: "user",
      content: `Prospect type: ${classification || "unknown"}\nWebsite: ${target}\n` +
        (page.ok ? `Website text:\n${page.text}` : `(site unreadable — research ${new URL(target).hostname} via web search)`),
    }],
    tools: sparse ? [webSearchTool(3)] : undefined,
  });
  const parsed = parseJson(textOf(res.content), { summary: textOf(res.content).slice(0, 600), pains: [], hooks: [] });
  return { ok: true as const, url: target, ...parsed };
}

function normalizeUrl(rawUrl: string): string {
  let target = rawUrl.trim();
  if (!/^https?:\/\//i.test(target)) target = "https://" + target;
  return target;
}

// Client onboarding: scrape the agency client's own site into case-study data.
// JS-rendered sites serve an empty HTML shell — in that case we fall back to
// pure web-search research (search indexes carry the rendered content).
async function researchClientSite(rawUrl: string) {
  const page = await fetchSiteText(rawUrl);
  const target = page.ok ? page.target : normalizeUrl(rawUrl);
  const domain = new URL(target).hostname.replace(/^www\./, "");
  const sparse = !page.ok || page.text.length < 600;
  const userContent = page.ok
    ? `Client website: ${target}\n\nHomepage text:\n${page.text}`
    : `Client website: ${target}\n\nThe homepage could not be read directly (JS-rendered or blocked). You MUST rely on web searches: try "site:${domain}", "${domain}", the company name, their LinkedIn page, reviews, and directories.`;
  const res = await claudeMessages({
    model: CLAUDE_MODEL,
    max_tokens: 2400,
    system:
      `You onboard clients for a lead generation agency. ` +
      (sparse
        ? `The client's website could not be read directly, so research them via web search (up to 4 searches): their domain, company name, LinkedIn, reviews, case studies, testimonials. `
        : `The client's website text is provided. Use up to 3 web searches to find their case studies, testimonials, reviews, or named results if the homepage lacks numbers. `) +
      `Extract the raw material for cold outreach offers. Be accurate — never invent numbers; if a field is unknown leave it as an empty string/array.\n` +
      `Return valid JSON only, no markdown fences:\n` +
      `{"name":"company name","meta":"one-line descriptor (location · size · type)",` +
      `"niche_guess":"the niche(s) THEY target, best guess",` +
      `"size":"company size / revenue if stated","result":"their single most impressive client result (with numbers if found)",` +
      `"mechanism":"how they get results, in plain words (their process/system)",` +
      `"proofLine":"one sendable sentence of proof: 'We just helped X do Y...' style, built only from real findings",` +
      `"offers":["their offers/packages/guarantees as stated"],` +
      `"caseStudies":["each concrete case study/result found, one line each"],` +
      `"pains":["pains their customers have (from their own copy)"],` +
      `"desires":["outcomes their customers want"],` +
      `"objections":["objections their copy preempts"],` +
      `"summary":"2-3 sentence overview of the client"}`,
    messages: [{ role: "user", content: userContent }],
    tools: [webSearchTool(sparse ? 4 : 3)],
  });
  const parsed = parseJson(textOf(res.content), null as Record<string, unknown> | null);
  if (!parsed) return { ok: false as const, error: "Could not parse research output — try again" };
  return {
    ok: true as const,
    url: target,
    fetchNote: sparse ? "Site is JS-rendered/blocked — researched via web search instead of direct scrape." : "",
    ...parsed,
  };
}

// Niche research: real web search incl. Reddit/forums for pains → angles.
async function researchNiche(nicheName: string, clientContext: string) {
  const res = await claudeMessages({
    model: CLAUDE_MODEL,
    max_tokens: 2400,
    system:
      `You are a lead generation researcher building cold outreach assets for a niche. ` +
      `Use web search (up to 5 searches) to find this niche's real pain points — search Reddit, industry forums, communities, and Google. ` +
      `Prioritize how people in the niche actually talk about their problems (their words beat marketing words).\n` +
      `Return valid JSON only, no markdown fences:\n` +
      `{"insights":"3-4 sentences: state of the niche, what they complain about, where the money pressure is",` +
      `"pains":["6-8 specific pains, phrased the way the niche says them"],` +
      `"angles":["6-8 short cold-email angles (testable hooks) derived from those pains"],` +
      `"triggerWords":["8-12 niche-native terms/acronyms that signal insider knowledge"],` +
      `"desires":["4-6 outcomes this niche wants most"],` +
      `"objections":["4-6 objections they raise to outreach offers"]}`,
    messages: [{
      role: "user",
      content: `Niche: ${nicheName}\n${clientContext ? `Our client (who sells into this niche): ${clientContext}` : ""}`,
    }],
    tools: [webSearchTool(5)],
  });
  const parsed = parseJson(textOf(res.content), null as Record<string, unknown> | null);
  if (!parsed) return { ok: false as const, error: "Could not parse niche research — try again" };
  return { ok: true as const, niche: nicheName, ...parsed };
}

// Competitor research: find the client's competitors and pull their offers.
async function researchCompetitors(clientName: string, clientUrl: string, nicheName: string) {
  const res = await claudeMessages({
    model: CLAUDE_MODEL,
    max_tokens: 2600,
    system:
      `You are a lead generation strategist doing competitor intel. ` +
      `Use web search (up to 4 searches) to find 3-5 direct competitors of the client below — companies selling a similar service to the same niche. ` +
      `For each, pull what is publicly visible: their offer/packages, their mechanism (how they claim to get results), named results/case studies, and any guarantee. ` +
      `Never invent data; leave unknown fields as empty strings.\n` +
      `Return valid JSON only, no markdown fences:\n` +
      `{"insights":"2-3 sentences: how the competitive field positions itself, and the gap our client can exploit",` +
      `"competitors":[{"name":"","website":"","offer":"their core offer/packages","mechanism":"how they get results","results":"named results/case studies found","guarantee":"guarantee if any"}]}`,
    messages: [{
      role: "user",
      content: `Client: ${clientName}${clientUrl ? ` (${clientUrl})` : ""}\nNiche they sell into: ${nicheName || "unknown"}`,
    }],
    tools: [webSearchTool(4)],
  });
  const parsed = parseJson(textOf(res.content), null as Record<string, unknown> | null);
  if (!parsed) return { ok: false as const, error: "Could not parse competitor research — try again" };
  return { ok: true as const, ...parsed };
}

// ─── Generation ────────────────────────────────────────────────────────────────
interface Framework {
  id: string;
  name: string;
  category: string;
  template: string;
  rules?: string;
}

interface GenerateBody {
  action: "generate";
  prospect: { fname?: string; company?: string; url?: string; classification?: string; customPain?: string };
  client: {
    name: string;
    caseStudy: Record<string, unknown>;
    emphasis?: { pains?: string[]; desires?: string[]; caseStudies?: string[]; offers?: string[] };
    frameworkOverride?: string;
    competitorIntel?: string;
    avoid?: string[];
  };
  niche: { name: string; triggerWords?: string[] };
  frameworks: Framework[];
  angles: string[];
  variantsPerAngle: number;
  globalRules?: string;
  guarantee?: string;
  icp?: { title?: string; niche?: string; jobTitles?: string[]; locations?: string[]; employeeSize?: string; revenue?: string; outboundNotes?: string };
  research?: { summary?: string; pains?: string[]; hooks?: string[] };
}

function buildSystemPrompt(body: GenerateBody, fw: Framework): { shared: string; framework: string } {
  const cs = body.client.caseStudy ?? {};
  const csLines = Object.entries(cs)
    .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== "")
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? (v as unknown[]).join(", ") : v}`)
    .join("\n");
  const tw = (body.niche.triggerWords ?? []).join(", ");
  const r = body.research;
  const researchBlock = r && (r.summary || r.pains?.length || r.hooks?.length)
    ? `\nPROSPECT RESEARCH (from their website — personalize with this, reference real details):\n` +
      `${r.summary ?? ""}\nLikely pains: ${(r.pains ?? []).join("; ")}\nHooks: ${(r.hooks ?? []).join("; ")}\n`
    : "";
  const overrideBlock = body.client.frameworkOverride?.trim()
    ? `\nCLIENT-SPECIFIC FRAMEWORK NOTES (these override the defaults where they conflict):\n${body.client.frameworkOverride.trim()}\n`
    : "";
  const competitorBlock = body.client.competitorIntel?.trim()
    ? `\nCOMPETITOR INTEL (what rivals in this niche promise — position our client distinctly, never copy their claims):\n${body.client.competitorIntel.trim().slice(0, 2000)}\n`
    : "";
  const avoidBlock = (body.client.avoid ?? []).filter((a) => String(a).trim()).length
    ? `\nHARD EXCLUSIONS — the client forbids these. NEVER mention, imply, or allude to any of them in any script:\n` +
      (body.client.avoid ?? []).filter((a) => String(a).trim()).map((a) => `- ${a}`).join("\n") + "\n"
    : "";

  const guaranteeBlock = body.guarantee?.trim()
    ? `\nGUARANTEE / RISK REVERSAL (incorporate naturally where it fits — don't force into every variant):\n${body.guarantee.trim()}\n`
    : "";

  const icp = body.icp;
  const icpBlock = icp?.title
    ? `\nTARGET ICP — every script is written TO this exact persona. Match their seniority, vocabulary and pain framing; a CFO reads differently than a founder:\n` +
      `ICP: ${icp.title}${icp.niche ? ` (${icp.niche})` : ""}\n` +
      `Recipient job titles: ${(icp.jobTitles ?? []).join(", ") || "unknown"}\n` +
      `Company size: ${icp.employeeSize || "unknown"}${icp.revenue ? ` · ${icp.revenue}` : ""}\n` +
      `Locations: ${(icp.locations ?? []).join(", ") || "unknown"}\n` +
      (icp.outboundNotes ? `Outbound notes (lead with this): ${icp.outboundNotes}\n` : "")
    : "";

  const em = body.client.emphasis ?? {};
  const emList = (arr?: string[]) => (arr ?? []).filter((x) => String(x).trim()).map((x) => `- ${x}`).join("\n");
  const emphasisParts: string[] = [];
  if (em.pains?.length) emphasisParts.push(`Pains to lead with (these matter most to this client — prioritize them):\n${emList(em.pains)}`);
  if (em.desires?.length) emphasisParts.push(`Desired outcomes to point at:\n${emList(em.desires)}`);
  if (em.caseStudies?.length) emphasisParts.push(`Use ONLY these case studies as proof (don't invent others):\n${emList(em.caseStudies)}`);
  if (em.offers?.length) emphasisParts.push(`Offers to pitch:\n${emList(em.offers)}`);
  const emphasisBlock = emphasisParts.length
    ? `\nEMPHASIS — the user hand-picked these as the focus. Build the scripts around them:\n${emphasisParts.join("\n")}\n`
    : "";

  // SHARED prefix — identical for every framework in this generate run (same client, niche,
  // ICP, research, emphasis…). It's sent as a CACHED prefix so it's billed once and read at
  // ~0.1× on the rest of the fan-out. Must stay byte-stable across frameworks → no fw.* here.
  const shared = `You are a world-class cold email copywriter. You write short, punchy, conversational scripts that get replies, never marketing copy.

GLOBAL STYLE RULES:
${body.globalRules || "(none)"}

CLIENT CASE STUDY (the sender's proof — use it accurately, never invent numbers):
${csLines}

NICHE: ${body.niche.name}
NICHE TRIGGER WORDS (work 1-3 in naturally where they genuinely fit; never force them): ${tw || "(none)"}
${icpBlock}${researchBlock}${overrideBlock}${competitorBlock}${avoidBlock}${guaranteeBlock}${emphasisBlock}
OUTPUT FORMAT — return valid JSON only, no markdown, no preamble:
{
  "framework_fill": { "<variable_name>": "<value used in the first script>", ... },
  "variants": [ { "angle": "<the angle>", "label": "<3-6 word label>", "script": "<complete send-ready script>" } ]
}`;

  // FRAMEWORK tail — varies per call, so it comes AFTER the cached prefix (uncached).
  const framework = `FRAMEWORK FOR THIS BATCH: ${fw.name} (category: ${fw.category})
TEMPLATE — every {{variable}} must be filled; the final script follows this structure exactly:
${fw.template}

FRAMEWORK RULES:
${fw.rules || "(none)"}

Write every variant using THIS framework, following the OUTPUT FORMAT defined above.`;

  return { shared, framework };
}

function buildUserPrompt(body: GenerateBody): string {
  const p = body.prospect;
  const lines = [
    `Prospect first name: ${p.fname || "{{first_name}}"}`,
    `Prospect company: ${p.company || "{{company}}"}`,
    `Classification: ${p.classification || "unknown"}`,
    p.customPain ? `Custom pain point to consider: ${p.customPain}` : "",
    "",
    `Write exactly ${body.variantsPerAngle} variant(s) for EACH of these angles, in order (${body.angles.length * body.variantsPerAngle} scripts total). Each variant of the same angle must take a noticeably different approach to the opening line:`,
    ...body.angles.map((a, i) => `${i + 1}. ${a}`),
    "",
    `Return JSON only.`,
  ];
  return lines.filter((l) => l !== "").join("\n");
}

interface VariantOut { angle: string; label: string; script: string }

async function generateForFramework(body: GenerateBody, fw: Framework) {
  const count = body.angles.length * body.variantsPerAngle;
  const { shared, framework } = buildSystemPrompt(body, fw);
  const user = buildUserPrompt(body);
  if (shared.length + framework.length + user.length > MAX_PROMPT_CHARS) {
    return { frameworkId: fw.id, framework: fw.name, category: fw.category, error: "prompt too long" };
  }
  try {
    const res = await claudeMessages({
      model: CLAUDE_MODEL,
      max_tokens: Math.min(800 + 260 * count, 7000),
      // [shared (cached prefix), framework (volatile tail)] — claudeMessages caches the prefix
      // so the shared client context is billed once per run instead of once per framework.
      system: [{ type: "text", text: shared }, { type: "text", text: framework }],
      messages: [{ role: "user", content: user }],
    });
    const raw = textOf(res.content);
    const parsed = parseJson<{ framework_fill?: Record<string, string>; variants?: VariantOut[] }>(
      raw,
      { variants: [{ angle: body.angles[0] ?? "", label: "Unparsed output", script: raw }] },
    );
    const usedFallback = parsed.variants?.length === 1 && parsed.variants[0]?.label === "Unparsed output";
    // If the model was cut off mid-JSON, say so instead of returning one giant unusable
    // "Unparsed output" variant that looks like a content failure.
    if (res.stop_reason === "max_tokens" && usedFallback) {
      return { frameworkId: fw.id, framework: fw.name, category: fw.category, error: "response was truncated (hit the output limit) — try fewer angles/variants or a shorter framework", usage: res.usage };
    }
    return {
      frameworkId: fw.id,
      framework: fw.name,
      category: fw.category,
      fills: parsed.framework_fill ?? {},
      variants: (parsed.variants ?? []).slice(0, count + 2),
      usage: res.usage,
    };
  } catch (err) {
    return { frameworkId: fw.id, framework: fw.name, category: fw.category, error: String((err as Error).message ?? err) };
  }
}

// ─── HTTP ──────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const origin = req.headers.get("origin") ?? "*";
  const cors = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-admin-key",
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  if (req.method === "GET") {
    return new Response(HTML, {
      status: 200,
      headers: { ...cors, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid JSON body" }, 400);
  }

  const adminKey = Deno.env.get("ADMIN_KEY");

  // Login is the only unauthenticated action: it exchanges valid team
  // credentials for the shared admin key (which guards everything else).
  if (body.action === "login") {
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    if (!email || !password) return json({ ok: false, error: "email and password required" }, 400);
    // Brute-force throttle: lock out an IP or email after too many recent failures.
    const ip = loginClientIp(req);
    const now = Date.now();
    const keyIp = "ip:" + ip, keyEmail = "em:" + email;
    const attempts = await loginAttemptsLoad();
    for (const k of Object.keys(attempts)) { if (now - attempts[k].first > LOGIN_WINDOW_MS) delete attempts[k]; } // prune expired
    const blocked = [keyIp, keyEmail].some((k) => attempts[k] && attempts[k].n >= LOGIN_MAX && (now - attempts[k].first) <= LOGIN_WINDOW_MS);
    if (blocked) {
      await new Promise((r) => setTimeout(r, 900));
      return json({ ok: false, error: "Too many login attempts. Wait a few minutes and try again." }, 429);
    }
    const users = await usersLoad();
    const u = users.find((x) => x.email.toLowerCase() === email);
    const okPw = u ? (await hashPassword(password, u.salt)) === u.hash : false;
    if (!u || !okPw) {
      for (const k of [keyIp, keyEmail]) { const a = attempts[k] = attempts[k] || { n: 0, first: now }; a.n += 1; }
      await loginAttemptsSave(attempts);
      await new Promise((r) => setTimeout(r, 900)); // slow brute force
      return json({ ok: false, error: "wrong email or password" }, 401);
    }
    if (!adminKey) return json({ ok: false, error: "server has no ADMIN_KEY set" }, 500);
    if (attempts[keyIp] || attempts[keyEmail]) { delete attempts[keyIp]; delete attempts[keyEmail]; await loginAttemptsSave(attempts); } // clear on success
    return json({ ok: true, adminKey, name: u.name, email: u.email });
  }

  if (!adminKey || req.headers.get("x-admin-key") !== adminKey) {
    return json({ ok: false, error: "unauthorized — missing or wrong x-admin-key" }, 401);
  }

  const action = String(body.action);
  const isAi = AI_ACTIONS.has(action);

  // Daily spend safety cap: block AI actions once the day's call budget is exhausted.
  // generate fans out one Claude call per framework, so it counts that many toward the cap.
  if (isAi) {
    const weight = action === "generate" && Array.isArray(body.frameworks)
      ? Math.max(1, Math.min((body.frameworks as unknown[]).length, MAX_FRAMEWORKS))
      : 1;
    const u = await usageBumpAndCheck(action, weight);
    if (!u.ok) {
      return json({ ok: false, error: `Daily AI limit reached (${u.cap} calls/day). This is a safety cap to control spend; it resets at UTC midnight. Raise it by setting the DAILY_AI_CALL_CAP secret.` }, 429);
    }
  }

  // Run the action inside a usage accumulator so every Claude call's tokens/cost are metered,
  // then persist what this request consumed (for the Usage dashboard).
  return await usageCtx.run({ input: 0, output: 0, cost: 0, lens: typeof body.lensPrefix === "string" ? body.lensPrefix : "" }, async () => {
  try {
    // deno-lint-ignore no-explicit-any
    const __result: any = await (async () => {
    switch (body.action) {
      case "get_usage": {
        return json({ ok: true, usage: await usageLoad(), cap: DAILY_AI_CALL_CAP, rates: RATES });
      }

      case "get_key_status": {
        return json({ ok: true, status: await anthropicKeyStatus() });
      }

      case "set_anthropic_key": {
        const key = String(body.key ?? "").trim();
        if (!key) return json({ ok: false, error: "key required" }, 400);
        if (!key.startsWith("sk-ant-")) return json({ ok: false, error: "That doesn't look like an Anthropic key (should start with sk-ant-)." }, 400);
        // Validate before saving so we never store a dud.
        const t = await testAnthropicKey(key);
        if (!t.ok) return json({ ok: false, error: "Key rejected by Anthropic: " + (t.error || "invalid") }, 400);
        const s = await secretsLoad();
        s.anthropicKey = key;
        await secretsSave(s);
        setApiKeyOverride(key);
        __keyAt = Date.now();
        return json({ ok: true, status: await anthropicKeyStatus() });
      }

      case "clear_anthropic_key": {
        const s = await secretsLoad();
        delete s.anthropicKey;
        await secretsSave(s);
        setApiKeyOverride(null);
        __keyAt = Date.now();
        return json({ ok: true, status: await anthropicKeyStatus() });
      }

      case "test_anthropic_key": {
        const cand = body.key ? String(body.key).trim() : undefined;
        return json({ ok: true, result: await testAnthropicKey(cand) });
      }

      case "get_config": {
        const r = await configLoad();
        // Surface a transient read error as ok:false so the client treats it as
        // "could not verify" rather than "server is empty" (which would trigger a
        // stale-local self-heal overwrite). 404/empty still returns config:null.
        if (!r.ok) return json({ ok: false, error: `config read failed: ${r.status}` }, 502);
        return json({ ok: true, config: r.config });
      }

      case "save_config": {
        if (!body.config || typeof body.config !== "object") {
          return json({ ok: false, error: "config object required" }, 400);
        }
        if (JSON.stringify(body.config).length > 1_000_000) {
          return json({ ok: false, error: "config too large (1MB max)" }, 400);
        }
        const baseRev = (typeof body.baseRev === "number" && Number.isFinite(body.baseRev)) ? body.baseRev : null;
        const r = await configSave(body.config as Record<string, unknown>, baseRev);
        // Conflict is returned as ok:true (so the client's api() doesn't throw) with a
        // conflict flag + the current server copy; the client merges and re-saves.
        if (!r.ok) return json({ ok: true, conflict: true, config: r.config, rev: r.rev });
        return json({ ok: true, rev: r.rev });
      }

      case "research": {
        const url = String(body.url ?? "").trim();
        if (!url) return json({ ok: false, error: "url required" }, 400);
        const result = await researchProspect(url, String(body.classification ?? ""));
        return json(result, result.ok ? 200 : 422);
      }

      case "research_client_site": {
        const url = String(body.url ?? "").trim();
        if (!url) return json({ ok: false, error: "url required" }, 400);
        const result = await researchClientSite(url);
        return json(result, result.ok ? 200 : 422);
      }

      case "research_niche": {
        const nicheName = String(body.niche ?? "").trim();
        if (!nicheName) return json({ ok: false, error: "niche required" }, 400);
        const result = await researchNiche(nicheName, String(body.clientContext ?? ""));
        return json(result, result.ok ? 200 : 422);
      }

      case "extract_framework": {
        const scripts = Array.isArray(body.scripts) ? (body.scripts as unknown[]).map(String).filter((s) => s.trim()) : [];
        if (!scripts.length) return json({ ok: false, error: "scripts required" }, 400);
        const res = await claudeMessages({
          model: CLAUDE_MODEL,
          max_tokens: 1600,
          system:
            `You reverse-engineer winning cold outreach scripts into reusable frameworks for a lead generation agency.\n` +
            `Given one or more scripts that got replies, extract the underlying repeatable structure:\n` +
            `- Keep the load-bearing structure and phrasing patterns that make it work.\n` +
            `- Replace the situation-specific parts (pain, proof, names, numbers, CTA target) with descriptive snake_case {{variables}}.\n` +
            `- Write rules that capture why it wins: length, tone, rhythm, what each part must do.\n` +
            `Return valid JSON only, no markdown fences:\n` +
            `{"name":"short memorable framework name","category":"what it is (Proof-led / Pain-led / Curiosity-led / Ultra-short / ...)",` +
            `"template":"the structure with {{variables}}","rules":"the rules that make it win",` +
            `"analysis":"2-3 sentences on why this script structure works"}`,
          messages: [{
            role: "user",
            content: scripts.map((s, i) => `SCRIPT ${i + 1}:\n${s}`).join("\n\n---\n\n") +
              (body.context ? `\n\nContext: ${body.context}` : ""),
          }],
        });
        const parsed = parseJson(textOf(res.content), null as Record<string, unknown> | null);
        if (!parsed) return json({ ok: false, error: "could not parse framework extraction — try again" }, 422);
        return json({ ok: true, ...parsed });
      }

      case "refine_script": {
        const script = String(body.script ?? "").trim();
        const prompt = String(body.prompt ?? "").trim();
        if (!script || !prompt) return json({ ok: false, error: "script and prompt required" }, 400);
        const res = await claudeMessages({
          model: pickModel(body.model),   // builder buttons can pick sonnet/opus/haiku; default sonnet
          max_tokens: 4000,   // was 600 — too small for JSON tasks (mechanism builder / grouping) that ride on refine_script
          system: `You are a cold email editor. The user gives you a script and a revision instruction. Make ONLY the requested changes — preserve what works. Return ONLY the revised script text, no commentary, no quotes, no markdown.`,
          messages: [{ role: "user", content: `SCRIPT:\n${script}\n\nINSTRUCTION: ${prompt}` }],
        });
        return json({ ok: true, script: textOf(res.content).trim() });
      }

      case "refine_batch": {
        // Rewrite an ARRAY of short lines in ONE call (replaces N per-item refine_script calls
        // in the System Filter "run through lens" feature). Returns an array aligned to the input.
        const items = Array.isArray(body.items) ? (body.items as unknown[]).map((x) => String(x ?? "")) : [];
        const prompt = String(body.prompt ?? "").trim();
        if (!items.length || !prompt) return json({ ok: false, error: "items and prompt required" }, 400);
        if (items.length > 40) return json({ ok: false, error: "too many items in one batch (max 40)" }, 400);
        const res = await claudeMessages({
          model: pickModel(body.model),   // defaults to sonnet — same quality the per-item path used
          max_tokens: Math.min(500 + 160 * items.length, 8000),
          system:
            `You are a cold email editor. You are given a JSON array of short text items and ONE instruction. ` +
            `Apply the instruction to EACH item independently — keep what works, change only what the instruction asks. ` +
            `Preserve any {{merge_tags}} exactly. Return ONLY valid JSON (no markdown fences): ` +
            `{"items":["<rewrite of item 0>","<rewrite of item 1>", …]} with EXACTLY ${items.length} strings, in the SAME ORDER as the input. No commentary.`,
          messages: [{ role: "user", content: `INSTRUCTION: ${prompt}\n\nITEMS (JSON array):\n${JSON.stringify(items)}` }],
        });
        const parsed = parseJson(textOf(res.content), null as { items?: unknown[] } | null);
        const arr = parsed && Array.isArray(parsed.items) ? parsed.items.map((x) => String(x ?? "")) : [];
        // The model must return EXACTLY one rewrite per item, in order. If the count differs
        // (it dropped/merged an item, or the JSON was truncated), positionally remapping would
        // shift every later rewrite onto the WRONG original and corrupt saved data — so reject
        // the whole batch and fall every item back to its original instead.
        if (arr.length !== items.length) return json({ ok: true, items });
        const out = items.map((orig, i) => { const v = (arr[i] ?? "").trim(); return v || orig; });
        return json({ ok: true, items: out });
      }

      case "ai_edit_batch": {
        // Restyle an ARRAY of growth-plan passages in ONE call (replaces N per-block ai_edit_text calls).
        const items = Array.isArray(body.items) ? (body.items as unknown[]).map((x) => String(x ?? "")) : [];
        const instruction = String(body.instruction ?? "").trim();
        if (!items.length || !instruction) return json({ ok: false, error: "items and instruction required" }, 400);
        if (items.length > 30) return json({ ok: false, error: "too many items in one batch (max 30)" }, 400);
        const ctx = String(body.context ?? "").slice(0, 6000);
        const rules = String(body.rules ?? "").trim();
        const res = await claudeMessages({
          model: CLAUDE_HAIKU,   // light restyle — Haiku is plenty and ~10x cheaper
          max_tokens: Math.min(800 + 320 * items.length, 8000),   // HTML fragments are bigger than plain lines — headroom to avoid truncating the JSON array
          system:
            `You restyle passages of a client-facing growth-plan document to match a house style. ` +
            `You are given the document context, a JSON array of passages, and ONE instruction. Apply it to EACH passage. ` +
            `Keep every number, name and fact exact.\n` +
            `Each result is a minimal HTML fragment using ONLY these tags: <p>, <ul>, <li>, <b>, <i>, <br>, <h3>. ` +
            `Never include style attributes, classes, font tags, markdown, or commentary. If a passage is a short inline phrase, return plain text with no tags.\n` +
            (rules ? `HOUSE LANGUAGE RULES (always obey):\n${rules}\n` : "") +
            `Return ONLY valid JSON (no fences): {"items":["<fragment 0>","<fragment 1>", …]} with EXACTLY ${items.length} strings, in the SAME ORDER as the input.`,
          messages: [{ role: "user", content: `INSTRUCTION: ${instruction}\n\nDOCUMENT CONTEXT:\n${ctx}\n\nPASSAGES (JSON array):\n${JSON.stringify(items)}` }],
        });
        const parsed = parseJson(textOf(res.content), null as { items?: unknown[] } | null);
        const arr = parsed && Array.isArray(parsed.items) ? parsed.items.map((x) => String(x ?? "")) : [];
        // The model must return EXACTLY one rewrite per item, in order. If the count differs
        // (it dropped/merged an item, or the JSON was truncated), positionally remapping would
        // shift every later rewrite onto the WRONG original and corrupt saved data — so reject
        // the whole batch and fall every item back to its original instead.
        if (arr.length !== items.length) return json({ ok: true, items });
        const out = items.map((orig, i) => { const v = (arr[i] ?? "").trim(); return v || orig; });
        return json({ ok: true, items: out });
      }

      case "refine_selection": {
        const script = String(body.script ?? "").trim();
        const selection = String(body.selection ?? "").trim();
        const prompt = String(body.prompt ?? "").trim();
        if (!script || !selection || !prompt) return json({ ok: false, error: "script, selection and prompt required" }, 400);
        const res = await claudeMessages({
          model: CLAUDE_HAIKU,   // light single-excerpt rewrite — Haiku is plenty and ~10x cheaper
          max_tokens: 400,
          system:
            `You are a cold email editor. The user highlighted ONE EXCERPT of a script and wants only that excerpt rewritten. ` +
            `Rewrite the excerpt per the instruction so it fits seamlessly back into the surrounding script (tone, tense, flow). ` +
            `Return ONLY the replacement text for the excerpt — no commentary, no quotes, no markdown, and do NOT return the rest of the script.`,
          messages: [{
            role: "user",
            content: `FULL SCRIPT (context):\n${script}\n\nHIGHLIGHTED EXCERPT TO REWRITE:\n${selection}\n\nINSTRUCTION: ${prompt}`,
          }],
        });
        return json({ ok: true, replacement: textOf(res.content).trim() });
      }

      case "extract_transcript": {
        const text = String(body.text ?? "").slice(0, 30_000);
        if (!text.trim()) return json({ ok: false, error: "transcript text required" }, 400);
        const res = await claudeMessages({
          model: CLAUDE_MODEL,
          max_tokens: 2000,
          system:
            `You extract cold outreach intelligence from sales call transcripts. Read the transcript and identify actionable material.\n` +
            `Return valid JSON only, no markdown fences:\n` +
            `{"pains":["6-8 specific pain points, phrased in the prospect's exact words where possible"],` +
            `"desires":["4-6 outcomes they explicitly or implicitly want"],` +
            `"angles":["5-8 testable cold email angles derived from what you heard — use their exact language"],` +
            `"offers":["3-5 potential offer structures that would resonate based on what was said"],` +
            `"insights":"2-3 sentences on what this call reveals about the niche and what messaging will land"}`,
          messages: [{ role: "user", content: `Call transcript:\n${text}` }],
        });
        const parsed = parseJson(textOf(res.content), null as Record<string, unknown> | null);
        if (!parsed) return json({ ok: false, error: "could not parse transcript — try again" }, 422);
        return json({ ok: true, ...parsed });
      }

      case "suggest_angles": {
        const nicheName = String(body.niche ?? "").trim();
        const clientContext = String(body.clientContext ?? "").trim();
        const userPrompt = String(body.prompt ?? "").trim();
        if (!nicheName) return json({ ok: false, error: "niche required" }, 400);
        const res = await claudeMessages({
          model: CLAUDE_HAIKU,   // short constrained angle hooks — Haiku is plenty and ~3.75x cheaper
          max_tokens: 600,
          system:
            `You generate testable cold email angle hooks for a specific niche. Each angle is a 5-14 word specific hook — a problem, trigger event, or curiosity gap. Make them distinct, concrete, and sendable as email openers.\n` +
            `Return valid JSON only, no markdown: {"angles":["6 angles"]}`,
          messages: [{
            role: "user",
            content: `Niche: ${nicheName}\n${clientContext ? `Client context: ${clientContext}` : ""}${userPrompt ? `\nDirection / focus: ${userPrompt}` : ""}`,
          }],
        });
        const parsed = parseJson(textOf(res.content), { angles: [] as string[] });
        return json({ ok: true, angles: parsed.angles ?? [] });
      }

      case "research_competitors": {
        const name = String(body.clientName ?? "").trim();
        const url = String(body.clientUrl ?? "").trim();
        if (!name && !url) return json({ ok: false, error: "clientName or clientUrl required" }, 400);
        const result = await researchCompetitors(name, url, String(body.niche ?? ""));
        return json(result, result.ok ? 200 : 422);
      }

      case "build_icp": {
        const context = String(body.context ?? "").slice(0, 14_000);
        if (!context.trim()) return json({ ok: false, error: "client context required" }, 400);
        const res = await claudeMessages({
          model: CLAUDE_MODEL,
          max_tokens: 6000,
          system:
            `You are a world-renowned outbound/cold-email strategist. Given everything known about a lead-gen agency's client ` +
            `(their offer, mechanism, proof, customer pains, call-transcript intel, competitors), define the 1-5 BEST ideal customer profiles to target with cold outreach.\n` +
            `Rules of great outbound ICPs:\n` +
            `- Specific job titles that actually hold the budget/pain (not generic "decision makers").\n` +
            `- A market that is ACCESSIBLE via outbound (findable on LinkedIn/Apollo/email databases). The sweet spot is roughly 10,000-100,000 reachable prospects — big enough to scale sequences, small enough to specialize messaging. Around 30-40K is ideal. Flag anything under ~5K (too thin) or over ~500K (unfocused).\n` +
            `- The client's existing proof must transfer: pick ICPs where their case studies and mechanism are believable.\n` +
            `- Use web search (up to 4 searches) to ESTIMATE market size: LinkedIn title counts, industry association stats, census/firmographic data ("number of X companies in Y"). State numbers with their basis; never present a guess as fact — if it is a reasoned estimate, say so.\n` +
            `Return valid JSON only, no markdown fences:\n` +
            `{"icps":[{` +
            `"title":"short memorable ICP label",` +
            `"niche":"the vertical/niche",` +
            `"jobTitles":["3-6 exact titles to target"],` +
            `"locations":["1-3 geos, most accessible first"],` +
            `"employeeSize":"company size band, e.g. 11-50",` +
            `"revenue":"revenue band if relevant, else empty string",` +
            `"marketSize":"estimated reachable prospects + one-line basis, e.g. '~35K — LinkedIn shows 32-38K matching titles in US'",` +
            `"why":"2-3 sentences: why this ICP fits THIS client — tie to their pains/mechanism/proof",` +
            `"outboundNotes":"reachability, buying triggers, what to lead with",` +
            `"score":8` +
            `}],"insights":"2-3 sentences: overall targeting strategy and which ICP to start with"}\n` +
            `Order icps best-first. score is outbound-fit 1-10.\n` +
            `IMPORTANT: do all web searching FIRST, then write NOTHING except the single JSON object as your final answer — no commentary before or after it.`,
          messages: [{ role: "user", content: `CLIENT DOSSIER:\n${context}` }],
          tools: [webSearchTool(4)],
        });
        const parsed = parseJson(textOf(res.content), null as Record<string, unknown> | null);
        if (!parsed) {
          const why = res.stop_reason === "max_tokens"
            ? "the response was truncated (hit the output limit) — try a shorter client dossier"
            : "could not parse ICP output — try again";
          return json({ ok: false, error: why }, 422);
        }
        return json({ ok: true, ...parsed });
      }

      case "fuse_angle": {
        const ingredients = Array.isArray(body.ingredients) ? body.ingredients as Array<{ kind: string; text: string }> : [];
        if (!ingredients.length) return json({ ok: false, error: "ingredients required" }, 400);
        const res = await claudeMessages({
          model: CLAUDE_HAIKU,   // one short fused angle line — Haiku is plenty and ~3.75x cheaper
          max_tokens: 300,
          system:
            `You fuse hand-picked ingredients (pains, desired outcomes, guarantees, offers) into ONE cold-email angle hook. ` +
            `5-14 words, specific, written the way the prospect would say it, sendable as an email opener's theme. ` +
            `Use the ingredients' substance — don't just concatenate them. The angle must make immediate sense to the prospect: ` +
            `frame the PAIN as their situation and the outcome/guarantee as the tension or promise.\n` +
            `Example — pain: "leads go cold before we follow up" + outcome: "predictable booked calls" → {"angle":"Leads going cold while the calendar stays empty"}\n` +
            `NEVER invent numbers or claims: only numbers that appear verbatim in the ingredients may be used.\n` +
            `Return valid JSON only: {"angle":"the fused angle"}`,
          messages: [{
            role: "user",
            content: ingredients.map((i) => `${i.kind}: ${i.text}`).join("\n") +
              (body.niche ? `\nNiche: ${body.niche}` : "") +
              (body.clientContext ? `\nClient: ${body.clientContext}` : ""),
          }],
        });
        const parsed = parseJson(textOf(res.content), { angle: "" });
        if (!parsed.angle) return json({ ok: false, error: "could not fuse — try again" }, 422);
        return json({ ok: true, angle: parsed.angle });
      }

      case "ai_edit_text": {
        const text = String(body.text ?? "").trim();
        const instruction = String(body.instruction ?? "").trim();
        if (!text || !instruction) return json({ ok: false, error: "text and instruction required" }, 400);
        const rules = String(body.rules ?? "").trim();
        const res = await claudeMessages({
          model: CLAUDE_HAIKU,   // inline highlight-edit helper — Haiku is plenty and ~10x cheaper
          max_tokens: 1200,
          system:
            `You edit text inside a client-facing outbound growth plan document. The user highlighted a passage and gave an instruction ` +
            `(summarize, analyze, expand, rewrite, add to it, etc.). Apply it.\n` +
            `STYLE — stay congruent with the document: same confident plain-English tone, same tense, same level of formality. ` +
            `Use emojis the way the document does (sparing, section-level: 🎯 📊 ✅ 📈). Use bullet points for any list of 3+ items.\n` +
            (rules ? `HOUSE LANGUAGE RULES (always obey):\n${rules}\n` : "") +
            `OUTPUT — return ONLY the replacement as a minimal HTML fragment using ONLY these tags: <p>, <ul>, <li>, <b>, <i>, <br>, <h3>. ` +
            `Never include style attributes, classes, font tags, markdown, or commentary. ` +
            `If the highlighted passage is a short inline phrase (part of a sentence), return plain text with no tags at all.`,
          messages: [{
            role: "user",
            content: `DOCUMENT (context):\n${String(body.context ?? "").slice(0, 8000)}\n\nHIGHLIGHTED PASSAGE:\n${text}\n\nINSTRUCTION: ${instruction}`,
          }],
        });
        return json({ ok: true, html: textOf(res.content).trim() });
      }

      case "users_list": {
        const users = await usersLoad();
        return json({ ok: true, users: users.map((u) => ({ email: u.email, name: u.name, createdAt: u.createdAt })) });
      }

      case "users_add": {
        const email = String(body.email ?? "").trim().toLowerCase();
        const name = String(body.name ?? "").trim();
        const password = String(body.password ?? "");
        if (!email || !email.includes("@")) return json({ ok: false, error: "valid email required" }, 400);
        if (password.length < 8) return json({ ok: false, error: "password must be at least 8 characters" }, 400);
        const users = await usersLoad();
        const salt = hexBytes(crypto.getRandomValues(new Uint8Array(16)).buffer);
        const hash = await hashPassword(password, salt);
        const entry: TeamUser = { email, name: name || email.split("@")[0], salt, hash, createdAt: new Date().toISOString().slice(0, 10) };
        const i = users.findIndex((u) => u.email.toLowerCase() === email);
        if (i !== -1) users[i] = entry; else users.push(entry);
        await usersSave(users);
        return json({ ok: true, updated: i !== -1 });
      }

      case "users_remove": {
        const email = String(body.email ?? "").trim().toLowerCase();
        const users = await usersLoad();
        const next = users.filter((u) => u.email.toLowerCase() !== email);
        if (next.length === users.length) return json({ ok: false, error: "no such user" }, 404);
        await usersSave(next);
        return json({ ok: true });
      }

      case "compose_client_brief": {
        const ctx = String(body.context ?? "").slice(0, 10_000);
        if (!ctx.trim()) return json({ ok: false, error: "client context required" }, 400);
        const rules = String(body.rules ?? "").trim();
        const res = await claudeMessages({
          model: CLAUDE_MODEL,
          max_tokens: 1400,
          system:
            `You turn a lead gen agency's internal client notes into a clean client facing brief that opens a growth plan. ` +
            `The client reading it should feel "they did their research on us".\n` +
            `STYLE RULES (strict): simple, concise, clear. Plain English a busy founder skims in seconds. ` +
            `NEVER use dashes or hyphens of any kind in the text, not even in compound words you can rephrase. Use commas or the word "to" instead. ` +
            `No jargon, no fluff, no exaggeration. Only use facts present in the notes, never invent numbers or names.\n` +
            (rules ? `HOUSE LANGUAGE RULES (also obey):\n${rules}\n` : "") +
            `Return valid JSON only, no fences:\n` +
            `{"services":["3 to 5 short lines, what the client offers, each under 12 words"],` +
            `"positioning":"2 to 3 sentences: who they serve, how they get results, why them",` +
            `"caseStudies":["each proven result as one clean line with its real numbers"],` +
            `"competitors":["each competitor as one line: Name, what they pitch, how our client differs"]}`,
          messages: [{ role: "user", content: `CLIENT NOTES:\n${ctx}` }],
        });
        const parsed = parseJson(textOf(res.content), null as Record<string, unknown> | null);
        if (!parsed) return json({ ok: false, error: "could not parse brief — try again" }, 422);
        return json({ ok: true, ...parsed });
      }

      case "find_icp_example": {
        const icp = body.icp as { title?: string; niche?: string; jobTitles?: string[]; employeeSize?: string; locations?: string[] } | undefined;
        if (!icp?.title) return json({ ok: false, error: "icp required" }, 400);
        const res = await claudeMessages({
          model: CLAUDE_MODEL,
          max_tokens: 800,
          system:
            `You find ONE real company that is a textbook example of an ideal customer profile, using web search (up to 3 searches). ` +
            `It must be a real, currently operating company with a working website that matches the ICP's niche, size and location. ` +
            `Never invent a company. If genuinely nothing fits, return an empty company string.\n` +
            `Style: no dashes or hyphens in the text, plain clear English.\n` +
            `Return valid JSON only, no fences: {"company":"name","website":"domain.com","why":"one sentence: why this company is a perfect example of the ICP"}`,
          messages: [{
            role: "user",
            content: `ICP: ${icp.title}\nNiche: ${icp.niche ?? ""}\nBuyer titles: ${(icp.jobTitles ?? []).join(", ")}\nCompany size: ${icp.employeeSize ?? ""}\nLocations: ${(icp.locations ?? []).join(", ")}`,
          }],
          tools: [webSearchTool(3)],
        });
        const parsed = parseJson(textOf(res.content), null as { company?: string; website?: string; why?: string } | null);
        if (!parsed) return json({ ok: false, error: "could not parse example — try again" }, 422);
        return json({ ok: true, ...parsed });
      }

      case "generate_followups": {
        const parent = String(body.parentScript ?? "").trim();
        const frameworks = Array.isArray(body.frameworks) ? body.frameworks as Array<{ name: string; template: string }> : [];
        if (!frameworks.length) return json({ ok: false, error: "at least one follow-up framework required" }, 400);
        const gapDays = Math.max(1, +(body.gapDays ?? 2));
        const icp = body.icp as { title?: string; jobTitles?: string[]; niche?: string } | undefined;
        const cs = (body.client as { name?: string; caseStudy?: Record<string, unknown> } | undefined) ?? {};
        const basis = body.basis as { pains?: string[]; desires?: string[]; angles?: string[] } | undefined;
        const rules = String(body.rules ?? "").trim();
        const sys =
          `You write OUTBOUND FOLLOW-UP emails — short messages sent AFTER a first cold email that got no reply. ` +
          `Write ${frameworks.length} follow-ups, one per framework given, in order. Each must:\n` +
          `- Follow its framework's structure and fill every {placeholder} from the real client data (never leave a {placeholder} or invent numbers).\n` +
          `- Build on the first script's thread without repeating it; reference it lightly ("circling back", "following up").\n` +
          `- Be sendable as-is, short, plain, human. Keep {{first_name}} / {{company}} merge tags.\n` +
          (icp?.title ? `- Speak to the ICP: ${icp.title}${icp.jobTitles?.length ? " (" + icp.jobTitles.join(", ") + ")" : ""}.\n` : "") +
          (rules ? `HOUSE LANGUAGE RULES (always obey):\n${rules}\n` : "") +
          `Return valid JSON only, no fences: {"followups":[{"framework":"<framework name>","text":"<the follow-up>"}]}`;
        const user =
          `FIRST SCRIPT (the one already sent):\n${parent || "(none provided)"}\n\n` +
          `CLIENT: ${cs.name ?? ""}\nProof: ${(cs.caseStudy?.proofLine as string) ?? ""}\nMechanism: ${(cs.caseStudy?.mechanism as string) ?? ""}\n` +
          `Case studies: ${((cs.caseStudy?.caseStudies as string[]) ?? []).join(" | ")}\n` +
          (basis?.pains?.length ? `Pains: ${basis.pains.join("; ")}\n` : "") +
          (basis?.desires?.length ? `Desired outcomes: ${basis.desires.join("; ")}\n` : "") +
          (basis?.angles?.length ? `Angles: ${basis.angles.join("; ")}\n` : "") +
          `\nFRAMEWORKS (write one follow-up each, in this order):\n` +
          frameworks.map((f, i) => `FRAMEWORK ${i + 1} — ${f.name}:\n${f.template}`).join("\n\n");
        const res = await claudeMessages({
          model: CLAUDE_MODEL,
          max_tokens: 1800,
          system: sys,
          messages: [{ role: "user", content: user }],
        });
        const parsed = parseJson(textOf(res.content), null as { followups?: Array<{ framework: string; text: string }> } | null);
        if (!parsed?.followups?.length) return json({ ok: false, error: "could not parse follow-ups — try again" }, 422);
        // Stamp the send-day cadence (Day +gap, +2*gap, …) server-side.
        const followups = parsed.followups.map((f, i) => ({ day: gapDays * (i + 1), framework: f.framework || frameworks[i]?.name || "", text: f.text || "" }));
        return json({ ok: true, followups });
      }

      case "compose_sales_plan": {
        const ctx = String(body.context ?? "").slice(0, 12_000);
        const rules = String(body.rules ?? "").trim();
        const customPrompt = String(body.prompt ?? "").trim();
        const mention = Array.isArray(body.mention) ? (body.mention as unknown[]).map(String).filter((s) => s.trim()) : [];
        const res = await claudeMessages({
          model: CLAUDE_MODEL,
          max_tokens: 1400,
          system:
            `You are an outreach expert writing a short, warm sales plan that an agency sends to a prospect to win their business. ` +
            `The reader knows nothing about outreach tools or jargon. Write like a friendly human, not a marketer.\n` +
            `HARD STYLE RULES: a 12 year old must understand every line. Short sentences. No dashes or hyphens anywhere, rephrase instead. ` +
            `No buzzwords, no AI sounding words (no "leverage", "utilize", "synergy", "robust", "seamless", "elevate", "unlock", "empower"). ` +
            `Only use facts from the notes, never invent numbers or names. Speak to the prospect as "you".\n` +
            (rules ? `HOUSE LANGUAGE RULES (also obey):\n${rules}\n` : "") +
            (customPrompt ? `EXTRA INSTRUCTIONS FROM THE AGENCY OWNER (always obey):\n${customPrompt}\n` : "") +
            (mention.length ? `ALWAYS WORK THESE POINTS IN NATURALLY (across intro and expectations, never as a list):\n${mention.map((m) => `- ${m}`).join("\n")}\n` : "") +
            `Return valid JSON only, no fences:\n` +
            `{"intro":"2 to 3 sentences: show you understand the prospect's business and what they want, warm and specific to them",` +
            `"expectations":"2 to 3 sentences: in plain words, what they can expect once this is running, framed around booked calls",` +
            `"closing":"1 or 2 sentences: a simple, low pressure nudge to take the next step"}`,
          messages: [{ role: "user", content: ctx }],
        });
        const parsed = parseJson(textOf(res.content), null as Record<string, unknown> | null);
        if (!parsed) return json({ ok: false, error: "could not parse sales plan — try again" }, 422);
        return json({ ok: true, ...parsed });
      }

      case "compose_growth_plan": {
        const mode = String(body.mode ?? "strategy");
        const rules = String(body.rules ?? "").trim();
        const ctx = JSON.stringify({
          client: body.client, targets: body.targets, numbers: body.numbers,
          channels: body.channels, targetBookings: body.targetBookings, nicheSize: body.nicheSize,
        }).slice(0, 12_000);
        const res = await claudeMessages({
          model: CLAUDE_MODEL,
          max_tokens: 1600,
          system:
            `You are a senior outbound strategist writing a client-facing growth plan. Write crisp, confident, plain-English prose — no fluff, no hype. ` +
            `The numbers are already computed and given to you; never invent or change them, reference them naturally.\n` +
            (rules ? `HOUSE LANGUAGE RULES (always obey these):\n${rules}\n` : "") +
            `Return valid JSON only, no markdown fences:\n` +
            `{"execSummary":"2-3 sentences framing the plan and the goal",` +
            (mode === "strategy"
              ? `"targetRationales":[{"title":"the exact target title","rationale":"2-3 sentences: why this audience + these pains + this offer will work for THIS client, referencing their proof"}],`
              : `"targetRationales":[],`) +
            `"closing":"1 sentence on what success looks like / the next move"}`,
          messages: [{ role: "user", content: `MODE: ${mode}\n${ctx}` }],
        });
        const parsed = parseJson(textOf(res.content), null as Record<string, unknown> | null);
        if (!parsed) return json({ ok: false, error: "could not parse narrative — try again" }, 422);
        return json({ ok: true, ...parsed });
      }

      case "export_notion": {
        const key = Deno.env.get("NOTION_API_KEY");
        if (!key) return json({ ok: false, error: "NOTION_API_KEY not set on the server — add it as a Supabase secret and redeploy" }, 400);
        const parentId = dashifyId(String(body.parentId ?? "").trim());
        if (!parentId) return json({ ok: false, error: "parentId (Notion page) required" }, 400);
        const headers = { "Authorization": `Bearer ${key}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json" };

        // Test mode: just confirm we can read the destination page.
        if (body.test) {
          const res = await fetch(`https://api.notion.com/v1/pages/${parentId}`, { headers });
          if (!res.ok) return json({ ok: false, error: `Notion ${res.status}: ${(await res.text()).slice(0, 200)}` }, 422);
          const data = await res.json();
          const titleProp = data?.properties ? Object.values(data.properties).find((p: unknown) => (p as { type?: string }).type === "title") : null;
          const title = (titleProp as { title?: Array<{ plain_text?: string }> })?.title?.[0]?.plain_text;
          return json({ ok: true, title: title || "(page found)" });
        }

        const blocks = Array.isArray(body.blocks) && body.blocks.length
          ? (body.blocks as Array<{ t: string }>).map(toNotionBlock)
          : [{ object: "block", type: "paragraph", paragraph: { rich_text: nRich("(empty plan)") } }];
        const createRes = await fetch("https://api.notion.com/v1/pages", {
          method: "POST",
          headers,
          body: JSON.stringify({
            parent: { page_id: parentId },
            properties: { title: { title: nRich(String(body.title ?? "Growth Plan")) } },
            children: blocks.slice(0, 100),
          }),
        });
        if (!createRes.ok) return json({ ok: false, error: `Notion ${createRes.status}: ${(await createRes.text()).slice(0, 300)}` }, 422);
        const page = await createRes.json();
        let rest = blocks.slice(100);
        let appended = Math.min(blocks.length, 100);
        let warning = "";
        while (rest.length) {
          const chunk = rest.slice(0, 100);
          rest = rest.slice(100);
          const ap = await fetch(`https://api.notion.com/v1/blocks/${page.id}/children`, { method: "PATCH", headers, body: JSON.stringify({ children: chunk }) });
          // Don't claim full success when an append chunk fails — surface a warning so
          // the caller knows the page is truncated (rate limit / rejected block / 5xx).
          if (!ap.ok) { warning = `Exported ${appended} of ${blocks.length} blocks — Notion ${ap.status}: ${(await ap.text()).slice(0, 200)}`; break; }
          appended += chunk.length;
        }
        return json({ ok: true, url: page.url, ...(warning ? { warning } : {}) });
      }

      // Export selected scripts as ONE row in a Notion database (the "clients script testing board").
      // Schema-aware: reads the database's columns and maps our fields to whatever they're named.
      case "export_notion_db": {
        const key = Deno.env.get("NOTION_API_KEY");
        if (!key) return json({ ok: false, error: "NOTION_API_KEY not set on the server — add it as a Supabase secret and redeploy" }, 400);
        const headers = { "Authorization": `Bearer ${key}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json" };

        // Resolve the destination database by id, or by name via search.
        let dbId = dashifyId(String(body.databaseId ?? "").trim());
        const wantName = String(body.databaseName ?? "clients script testing board").trim();
        if (!dbId && wantName) {
          const sr = await fetch("https://api.notion.com/v1/search", {
            method: "POST",
            headers,
            body: JSON.stringify({ query: wantName, filter: { property: "object", value: "database" } }),
          });
          if (sr.ok) {
            const sd = await sr.json();
            const wn = wantName.toLowerCase();
            // deno-lint-ignore no-explicit-any
            const hit = (sd.results || []).find((r: any) => {
              const t = (r.title || []).map((x: { plain_text?: string }) => x.plain_text || "").join("").toLowerCase();
              return t === wn || t.includes(wn);
            }) || (sd.results || [])[0];
            if (hit) dbId = hit.id;
          }
        }
        if (!dbId) return json({ ok: false, error: `Couldn't find the Notion database. Set its ID in Settings, or share a database named "${wantName}" with the integration.` }, 422);

        // Read the schema so we map to the user's actual column names/types.
        const dbRes = await fetch(`https://api.notion.com/v1/databases/${dbId}`, { headers });
        if (!dbRes.ok) return json({ ok: false, error: `Notion ${dbRes.status}: ${(await dbRes.text()).slice(0, 200)}` }, 422);
        const db = await dbRes.json();
        // deno-lint-ignore no-explicit-any
        const props: Record<string, any> = db.properties || {};
        const names = Object.keys(props);
        // Columns we must never write to (computed / read-only): writing them no-ops
        // silently, so picking one as a match would drop the value into a black hole.
        const READONLY_TYPES = new Set(["formula", "rollup", "created_time", "last_edited_time", "created_by", "last_edited_by", "unique_id", "button", "verification"]);
        const writable = (nm: string) => !READONLY_TYPES.has(props[nm]?.type);
        // Prefer an EXACT (case-insensitive) name match across all aliases before falling
        // back to substring — avoids 'date'→'Last edited date', 'state'→'Real estate', etc.
        const findProp = (aliases: string[]) => {
          for (const a of aliases) { const n = names.find((nm) => writable(nm) && nm.toLowerCase() === a); if (n) return n; }
          for (const a of aliases) { const n = names.find((nm) => writable(nm) && nm.toLowerCase().includes(a)); if (n) return n; }
          return null;
        };
        // deno-lint-ignore no-explicit-any
        const out: Record<string, any> = {};
        const titleName = names.find((n) => props[n].type === "title");
        if (titleName) out[titleName] = { title: nRich(String(body.title ?? "Script testing")) };
        // Pick the existing select/status option that best matches the requested value.
        // status options CANNOT be created via the API, so we must use one that exists.
        const matchOption = (value: string, options: Array<{ name?: string }>): string | null => {
          const opts = (options || []).map((o) => o.name || "").filter(Boolean);
          if (!opts.length) return null;
          const v = value.toLowerCase().trim();
          const exact = opts.find((o) => o.toLowerCase() === v); // exact, case-insensitive
          if (exact) return exact;
          // Containment only when the shorter side is non-trivial (>=4 chars) so we don't
          // map e.g. 'on' onto 'Winner'. The collision-prone first-4-chars prefix rule
          // ('Test won'→'Testing') was removed — for select/multi_select the caller falls
          // back to creating the literal value; for status it leaves the field unset.
          const sub = opts.find((o) => {
            const lo = o.toLowerCase();
            const short = lo.length < v.length ? lo : v;
            return short.length >= 4 && (lo.includes(v) || v.includes(lo));
          });
          return sub || null;
        };
        const setProp = (aliases: string[], value: unknown) => {
          if (value === undefined || value === null || value === "") return;
          const name = findProp(aliases);
          if (!name || name === titleName) return;
          const type = props[name].type;
          const sv = String(value);
          if (type === "rich_text") out[name] = { rich_text: nRich(sv) };
          else if (type === "select") {
            // select lets the API create new options, but reuse an existing match when there is one.
            const m = matchOption(sv, props[name].select?.options || []);
            out[name] = { select: { name: m || sv } };
          } else if (type === "multi_select") {
            const opts = props[name].multi_select?.options || [];
            out[name] = { multi_select: sv.split(",").map((s) => s.trim()).filter(Boolean).map((s) => ({ name: matchOption(s, opts) || s })) };
          } else if (type === "status") {
            // status options can't be created via API — only set it if we can match an existing one.
            const m = matchOption(sv, props[name].status?.options || []);
            if (m) out[name] = { status: { name: m } };
          } else if (type === "date") out[name] = { date: { start: sv } };
          else if (type === "number") out[name] = { number: Number(value) };
          else if (type === "url") out[name] = { url: sv };
          else if (type === "title") out[name] = { title: nRich(sv) };
        };
        const f = (body.fields ?? {}) as Record<string, unknown>;
        setProp(["client", "account", "company", "customer"], f.client);
        setProp(["niche", "industry", "vertical", "category"], f.niche);
        setProp(["status", "stage", "state", "type"], f.status);
        setProp(["who", "target", "audience", "icp", "prospect"], f.target);
        setProp(["number of test", "# test", "tests", "test count", "count"], f.tests);
        setProp(["date", "day", "when"], f.date);

        const blocks = Array.isArray(body.blocks) && body.blocks.length
          ? (body.blocks as Array<{ t: string }>).map(toNotionBlock)
          : [{ object: "block", type: "paragraph", paragraph: { rich_text: nRich("(no scripts)") } }];
        const createRes = await fetch("https://api.notion.com/v1/pages", {
          method: "POST",
          headers,
          body: JSON.stringify({ parent: { database_id: dbId }, properties: out, children: blocks.slice(0, 100) }),
        });
        if (!createRes.ok) return json({ ok: false, error: `Notion ${createRes.status}: ${(await createRes.text()).slice(0, 300)}` }, 422);
        const page = await createRes.json();
        let rest = blocks.slice(100);
        let appended = Math.min(blocks.length, 100);
        let warning = "";
        while (rest.length) {
          const chunk = rest.slice(0, 100);
          rest = rest.slice(100);
          const ap = await fetch(`https://api.notion.com/v1/blocks/${page.id}/children`, { method: "PATCH", headers, body: JSON.stringify({ children: chunk }) });
          // Don't claim full success when an append chunk fails — surface a warning so
          // the caller knows the page is truncated (rate limit / rejected block / 5xx).
          if (!ap.ok) { warning = `Exported ${appended} of ${blocks.length} blocks — Notion ${ap.status}: ${(await ap.text()).slice(0, 200)}`; break; }
          appended += chunk.length;
        }
        return json({ ok: true, url: page.url, ...(warning ? { warning } : {}) });
      }

      // Create the "clients script testing board" database under a given Notion page,
      // with the schema the export expects (Status is a SELECT so options are API-creatable).
      case "create_notion_db": {
        const key = Deno.env.get("NOTION_API_KEY");
        if (!key) return json({ ok: false, error: "NOTION_API_KEY not set on the server" }, 400);
        const parentId = dashifyId(String(body.parentId ?? "").trim());
        if (!parentId) return json({ ok: false, error: "parentId (Notion page) required" }, 400);
        const headers = { "Authorization": `Bearer ${key}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json" };
        const title = String(body.title ?? "clients script testing board");
        const res = await fetch("https://api.notion.com/v1/databases", {
          method: "POST",
          headers,
          body: JSON.stringify({
            parent: { type: "page_id", page_id: parentId },
            title: [{ type: "text", text: { content: title } }],
            properties: {
              "Name": { title: {} },
              "Client": { rich_text: {} },
              "Niche": { rich_text: {} },
              "Status": { select: { options: [
                { name: "Test idea", color: "gray" },
                { name: "Testing", color: "yellow" },
                { name: "Winner", color: "green" },
              ] } },
              "Who we're targeting": { rich_text: {} },
              "Number of tests": { number: {} },
              "Date": { date: {} },
            },
          }),
        });
        if (!res.ok) return json({ ok: false, error: `Notion ${res.status}: ${(await res.text()).slice(0, 300)}` }, 422);
        const db = await res.json();
        return json({ ok: true, id: db.id, url: db.url });
      }

      case "suggest_offers": {
        const context = String(body.context ?? "").slice(0, 6_000);
        if (!context.trim()) return json({ ok: false, error: "context required" }, 400);
        const res = await claudeMessages({
          model: CLAUDE_HAIKU,   // short list of offer names/descriptions — Haiku is plenty and ~3.75x cheaper
          max_tokens: 800,
          system:
            `You are a cold outreach strategist. Given a client's case study data, suggest 4-6 distinct offer packages they could sell — each with a name and one-line description. Make them concrete, risk-reversed, and outcome-focused.\n` +
            `Return valid JSON only, no markdown: {"offers":[{"name":"short offer name","description":"one-line description of what's included and the outcome"}]}`,
          messages: [{ role: "user", content: `Client data:\n${context}` }],
        });
        const parsed = parseJson(textOf(res.content), { offers: [] as { name: string; description: string }[] });
        return json({ ok: true, offers: parsed.offers ?? [] });
      }

      case "generate": {
        const g = body as unknown as GenerateBody;
        if (!Array.isArray(g.frameworks) || g.frameworks.length === 0) {
          return json({ ok: false, error: "at least one framework required" }, 400);
        }
        if (!Array.isArray(g.angles) || g.angles.length === 0) {
          return json({ ok: false, error: "at least one angle required" }, 400);
        }
        g.frameworks = g.frameworks.slice(0, MAX_FRAMEWORKS);
        g.angles = g.angles.slice(0, MAX_ANGLES);
        g.variantsPerAngle = Math.max(1, Math.min(Number(g.variantsPerAngle) || 1, MAX_VARIANTS_PER_ANGLE));
        const total = g.frameworks.length * g.angles.length * g.variantsPerAngle;
        if (total > MAX_TOTAL_SCRIPTS) {
          return json({ ok: false, error: `matrix too large: ${total} scripts (max ${MAX_TOTAL_SCRIPTS}) — deselect some frameworks/angles` }, 400);
        }
        // Warm the shared cached prefix with the first framework, then fan out the rest so they
        // READ that prefix (~0.1×) instead of all racing the cache write in parallel. A single
        // framework has no shared prefix to reuse, so skip the stagger.
        let results: Awaited<ReturnType<typeof generateForFramework>>[];
        if (g.frameworks.length > 1) {
          const first = await generateForFramework(g, g.frameworks[0]);
          const rest = await Promise.all(g.frameworks.slice(1).map((fw) => generateForFramework(g, fw)));
          results = [first, ...rest];
        } else {
          results = [await generateForFramework(g, g.frameworks[0])];
        }
        const usage = results.reduce(
          (acc, r) => "usage" in r && r.usage
            ? { input_tokens: acc.input_tokens + r.usage.input_tokens, output_tokens: acc.output_tokens + r.usage.output_tokens }
            : acc,
          { input_tokens: 0, output_tokens: 0 },
        );
        return json({ ok: true, results, usage });
      }

      default:
        return json({ ok: false, error: "unknown action" }, 400);
    }
    })();
    // Persist the tokens/cost this request consumed (for the Usage dashboard).
    if (isAi) { try { await recordActionUsage(action, usageCtx.getStore()); } catch (_e) { /* ignore */ } }
    return __result;
  } catch (err) {
    console.error("outreach-bot error:", err);
    return json({ ok: false, error: String((err as Error).message ?? err) }, 502);
  }
  });
});
