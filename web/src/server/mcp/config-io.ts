// Config read/write for the MCP server.
//
// The browser owns migrateConfig + the debounced save queue; the MCP server is a
// second writer against the SAME single jsonb document, so every write here goes
// through the same atomic compare-and-swap the browser uses (db.casSaveConfig),
// with a small read-modify-retry loop on conflict. That is what keeps a Claude/
// ChatGPT edit and a teammate's browser edit from clobbering each other.
//
// Deliberately does NOT run migrateConfig: that lives in the client bundle (it
// imports the browser storage helpers) and the UI re-runs it on every load, so a
// targeted MCP write stays minimal-touch and the browser backfills any new field
// on the next boot.

import { getConfig, casSaveConfig } from "../db";
import { invalidateEngineCache } from "../prompts";

// The config document is dynamically shaped (ported from an untyped app).

export type Cfg = Record<string, any>;

export async function readConfig(): Promise<Cfg> {
  const cfg = (await getConfig()) as Cfg | null;
  if (!cfg || typeof cfg !== "object") {
    throw new Error(
      "No config saved on the server yet. Open the web app once and let it sync before using the MCP server.",
    );
  }
  return cfg;
}

export interface MutateResult<T> {
  rev: number;
  result: T;
  attempts: number;
}

/**
 * Apply `recipe` to the live config and persist it atomically.
 *
 * On a CAS conflict the config is re-read and the recipe is re-applied against the
 * fresh copy (up to `maxAttempts`), so a concurrent browser save is never lost —
 * write recipes to be re-runnable (mutate the draft you are given, don't close
 * over a config you read earlier).
 */
export async function mutateConfig<T>(
  recipe: (draft: Cfg) => T,
  maxAttempts = 4,
): Promise<MutateResult<T>> {
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const cfg = await readConfig();
    const baseRev = Number(cfg._rev);
    const draft = structuredClone(cfg) as Cfg;
    delete draft._dirty; // never persist the client-side dirty flag
    const result = recipe(draft);
    const save = await casSaveConfig(draft, Number.isFinite(baseRev) ? baseRev : null);
    if (save.ok) {
      invalidateEngineCache(); // a prompt-slot edit must take effect on the next AI call
      return { rev: save.rev, result, attempts: attempt };
    }
    lastErr = new Error(`config changed underneath us (server rev ${save.rev})`);
    // Small backoff so a burst of MCP writes doesn't livelock against each other.
    await new Promise((r) => setTimeout(r, 60 * attempt));
  }
  throw new Error(
    `Could not save: ${String((lastErr as Error)?.message ?? lastErr)}. Someone else is editing the same config right now — try again.`,
  );
}

// ─── Lookup helpers ──────────────────────────────────────────────────────────

export function findClient(cfg: Cfg, idOrName: string): Cfg | undefined {
  const clients: Cfg[] = cfg.clients || [];
  const needle = String(idOrName ?? "").trim().toLowerCase();
  if (!needle) return undefined;
  return (
    clients.find((c) => String(c.id).toLowerCase() === needle) ??
    clients.find((c) => String(c.name ?? "").toLowerCase() === needle) ??
    clients.find((c) => String(c.name ?? "").toLowerCase().includes(needle))
  );
}

export function findNiche(cfg: Cfg, idOrName: string): Cfg | undefined {
  const niches: Cfg[] = cfg.niches || [];
  const needle = String(idOrName ?? "").trim().toLowerCase();
  if (!needle) return undefined;
  return (
    niches.find((n) => String(n.id).toLowerCase() === needle) ??
    niches.find((n) => String(n.name ?? "").toLowerCase() === needle) ??
    niches.find((n) => String(n.name ?? "").toLowerCase().includes(needle))
  );
}

export function findFramework(cfg: Cfg, idOrName: string): Cfg | undefined {
  const fws: Cfg[] = cfg.frameworks || [];
  const needle = String(idOrName ?? "").trim().toLowerCase();
  if (!needle) return undefined;
  return (
    fws.find((f) => String(f.id).toLowerCase() === needle) ??
    fws.find((f) => String(f.name ?? "").toLowerCase() === needle) ??
    fws.find((f) => String(f.name ?? "").toLowerCase().includes(needle))
  );
}

/** Slug-ish id generator matching the shapes already in the config. */
export function mkId(prefix: string, seed?: string): string {
  const slug = String(seed ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28);
  const rand = Math.random().toString(36).slice(2, 7);
  return slug ? `${slug}-${rand}` : `${prefix}-${rand}`;
}

/** Per-niche bucket, created on demand (mirrors the wizard's ensureBucket). */
export function ensureBucket(client: Cfg, nicheId: string): Cfg {
  client.nicheData = client.nicheData || {};
  const b = (client.nicheData[nicheId] = client.nicheData[nicheId] || {});
  b.pains = b.pains || [];
  b.desires = b.desires || [];
  b.offers = b.offers || [];
  return b;
}

/** Dedupe-preserving push of trimmed strings. */
export function mergeStrings(target: string[], items: unknown[]): number {
  let added = 0;
  (items || []).forEach((raw) => {
    const t = String(raw ?? "").trim();
    if (t && target.indexOf(t) < 0) {
      target.push(t);
      added++;
    }
  });
  return added;
}

/** Read a dotted path out of the config (`settings.systemFilter.lens`). */
export function getPath(obj: Cfg, path: string): unknown {
  if (!path) return obj;
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc == null) return undefined;
    if (Array.isArray(acc) && /^\d+$/.test(key)) return acc[Number(key)];
    return (acc as Cfg)[key];
  }, obj);
}

/** Write a dotted path, creating intermediate objects. Returns the previous value. */
export function setPath(obj: Cfg, path: string, value: unknown): unknown {
  const keys = path.split(".").filter(Boolean);
  if (!keys.length) throw new Error("path required");
  let cur: Cfg = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (cur[k] == null || typeof cur[k] !== "object") cur[k] = /^\d+$/.test(keys[i + 1]) ? [] : {};
    cur = cur[k];
  }
  const last = keys[keys.length - 1];
  const prev = cur[last];
  cur[last] = value;
  return prev;
}

export function deletePath(obj: Cfg, path: string): unknown {
  const keys = path.split(".").filter(Boolean);
  if (!keys.length) throw new Error("path required");
  let cur: Cfg = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (cur[k] == null || typeof cur[k] !== "object") return undefined;
    cur = cur[k];
  }
  const last = keys[keys.length - 1];
  const prev = cur[last];
  if (Array.isArray(cur) && /^\d+$/.test(last)) (cur as unknown[]).splice(Number(last), 1);
  else delete (cur as Cfg)[last];
  return prev;
}

/** Shallow "what's in here" summary so a model can orient without dumping megabytes. */
export function summarize(value: unknown, depth = 1): unknown {
  if (value == null) return value;
  if (typeof value === "string") return value.length > 400 ? value.slice(0, 400) + `… (${value.length} chars)` : value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    if (depth <= 0) return `[${value.length} items]`;
    return value.slice(0, 25).map((v) => summarize(v, depth - 1));
  }
  if (depth <= 0) return `{${Object.keys(value as Cfg).join(", ")}}`;
  const out: Cfg = {};
  for (const [k, v] of Object.entries(value as Cfg)) out[k] = summarize(v, depth - 1);
  return out;
}
