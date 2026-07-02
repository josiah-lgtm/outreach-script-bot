#!/usr/bin/env node
// Legacy → self-hosted migration: load the old app's `config` document into the
// new Postgres `config` row. The old data lives in Supabase Storage (config.json)
// and is reachable via the edge function's `get_config` action (x-admin-key), or
// via the app's Admin → Export JSON download. This script takes either source,
// validates it, normalizes it, and writes it into the single `config` row.
//
// It does NOT touch the UI/data model — `migrateConfig` (which the app runs on every
// load) idempotently backfills all newer fields, so we only carry the raw document.
//
// ─── Usage ──────────────────────────────────────────────────────────────────────
//   Pull live (needs the shared admin key in the env, never on argv):
//     OUTREACH_ADMIN_KEY=<key> node scripts/import-legacy.mjs --pull
//   From an exported JSON file (Admin → Export JSON in the legacy app):
//     node scripts/import-legacy.mjs --file ./live-config.json
//
//   By default it writes ./scripts/seed-config.sql (a safe, idempotent upsert you
//   pipe into the db container). Add --direct to also write straight to Postgres
//   using DATABASE_URL (guarded: refuses to clobber an existing non-empty config
//   unless --force).
//
//   Push straight onto a DEPLOYED new-app server (no DB/SSH access needed — just the
//   app's URL + its admin key). This is the remote path: it reads the server's current
//   rev and overwrites in one shot (a clean REPLACE, not the app's union-merge), so the
//   demo/sample data is gone. Add --merge to union instead, --yes to confirm a replace.
//     OUTREACH_ADMIN_KEY=<new server key> node scripts/import-legacy.mjs \
//       --file "./outreach-config.json" --push https://YOUR-APP/api/outreach --yes --no-sql
//
//   Flags:
//     --pull                 fetch config via get_config (OUTREACH_ADMIN_KEY env)
//     --file <path>          read config from an exported JSON file instead
//     --url <endpoint>       override the edge-function URL (default: the legacy one)
//     --rev <n>              rev to stamp (default: legacy _rev, else 1)
//     --out <path>           SQL output path (default: scripts/seed-config.sql)
//     --direct               also upsert into Postgres via DATABASE_URL
//     --force                allow --direct to overwrite an existing config row
//     --push <endpoint>      push onto a deployed server's /api/outreach (OUTREACH_ADMIN_KEY)
//     --merge                with --push: union with the server copy instead of replacing
//     --yes                  with --push: confirm replacing existing server clients
//     --no-sql               skip writing the .sql file (use with --direct or --push)

import { writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const DEFAULT_URL =
  "https://pturxqgrhywyhylxovun.supabase.co/functions/v1/outreach-bot";
const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── args ───────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = { out: resolve(__dirname, "seed-config.sql") };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--pull") a.pull = true;
    else if (t === "--direct") a.direct = true;
    else if (t === "--force") a.force = true;
    else if (t === "--merge") a.merge = true;
    else if (t === "--yes") a.yes = true;
    else if (t === "--no-sql") a.noSql = true;
    else if (t === "--file") a.file = argv[++i];
    else if (t === "--url") a.url = argv[++i];
    else if (t === "--push") a.push = argv[++i];
    else if (t === "--rev") a.rev = Number(argv[++i]);
    else if (t === "--out") { a.out = resolve(process.cwd(), argv[++i]); a.outExplicit = true; }
    else die(`unknown argument: ${t}`);
  }
  return a;
}
const die = (m) => {
  console.error(`\n✗ ${m}\n`);
  process.exit(1);
};

// ─── acquire the config document ──────────────────────────────────────────────────
async function pullConfig(url) {
  const key = process.env.OUTREACH_ADMIN_KEY;
  if (!key)
    die(
      "OUTREACH_ADMIN_KEY is not set. Export it in your shell (don't pass it on argv):\n" +
        "  export OUTREACH_ADMIN_KEY='<the shared admin key>'",
    );
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-key": key },
      body: JSON.stringify({ action: "get_config" }),
    });
  } catch (e) {
    die(`could not reach the backend (${url}): ${e?.message || e}`);
  }
  const data = await res.json().catch(() => ({ ok: false, error: "bad response" }));
  if (!res.ok || data.ok === false)
    die(`get_config failed: ${data.error || "HTTP " + res.status} (check the admin key)`);
  if (!data.config) die("get_config returned no config (server has never been saved?)");
  return data.config;
}

async function readConfigFile(path) {
  let raw;
  try {
    raw = await readFile(resolve(process.cwd(), path), "utf8");
  } catch {
    die(`cannot read file: ${path}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    die(`file is not valid JSON: ${e?.message || e}`);
  }
  // Export JSON is the config object itself; a get_config dump would be {config:…}.
  return parsed && parsed.config && parsed.config.frameworks ? parsed.config : parsed;
}

// ─── validate + report ────────────────────────────────────────────────────────────
function validate(cfg) {
  if (!cfg || typeof cfg !== "object") die("config is not an object");
  if (!Array.isArray(cfg.frameworks) || !cfg.frameworks.length)
    die("config has no non-empty `frameworks[]` — this doesn't look like a real export");
  const n = (x) => (Array.isArray(x) ? x.length : 0);
  const counts = {
    clients: n(cfg.clients),
    niches: n(cfg.niches),
    frameworks: n(cfg.frameworks),
    prospects: n(cfg.prospects),
    winningScripts: n(cfg.winningScripts),
    followupFrameworks: n(cfg.followupFrameworks),
    toolsKB: n(cfg.toolsKB),
  };
  // deep round-trip must not drop anything (the app JSON-serializes on save)
  const rt = JSON.stringify(cfg);
  if (JSON.stringify(JSON.parse(rt)) !== rt) die("config is not round-trip stable — investigate");
  return counts;
}

// ─── normalize: stamp _rev, drop transient _dirty ─────────────────────────────────
function normalize(cfg, revArg) {
  const legacyRev = Number(cfg._rev) || 0;
  const rev = Number.isFinite(revArg) && revArg > 0 ? revArg : Math.max(legacyRev, 1);
  const out = { ...cfg, _rev: rev };
  delete out._dirty;
  return { data: out, rev };
}

// ─── emit SQL (dollar-quoted so no escaping of the JSON is needed) ─────────────────
function emitSql(data, rev, outPath) {
  const json = JSON.stringify(data);
  let tag = "cfg";
  while (json.includes(`$${tag}$`)) tag += "x"; // guarantee the delimiter is unique
  const q = `$${tag}$`;
  const sql =
    `-- Generated by scripts/import-legacy.mjs — seeds the single config row.\n` +
    `-- Idempotent: safe to re-run (upserts id=1). Pipe into the db container:\n` +
    `--   docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < ${outPath.split(/[\\/]/).pop()}\n\n` +
    `INSERT INTO config (id, data, rev) VALUES (1, ${q}${json}${q}::jsonb, ${rev})\n` +
    `ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, rev = EXCLUDED.rev;\n`;
  writeFileSync(outPath, sql, "utf8");
}

// ─── optional: write straight to Postgres ─────────────────────────────────────────
async function directUpsert(data, rev, force) {
  const url = process.env.DATABASE_URL;
  if (!url) die("--direct needs DATABASE_URL in the env");
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const cur = await client.query("SELECT rev, data FROM config WHERE id = 1");
    if (cur.rowCount) {
      const existing = cur.rows[0];
      const existingClients = Array.isArray(existing.data?.clients) ? existing.data.clients.length : 0;
      if (!force)
        die(
          `a config row already exists (rev ${existing.rev}, ${existingClients} clients). ` +
            `Re-run with --force to overwrite it.`,
        );
      console.log(`  overwriting existing row (rev ${existing.rev}, ${existingClients} clients)`);
    }
    await client.query(
      "INSERT INTO config (id, data, rev) VALUES (1, $1::jsonb, $2) " +
        "ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, rev = EXCLUDED.rev",
      [JSON.stringify(data), rev],
    );
    console.log(`  ✓ wrote config row (rev ${rev})`);
  } finally {
    await client.end();
  }
}

// ─── merge helper (only used by --push --merge) ────────────────────────────────────
// Port of the app's mergeConfigVal: union id'd arrays (neither side's rows dropped),
// prefer `a` (the incoming file) on scalar conflicts, longer array otherwise.
function mergeConfigVal(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) {
    const ided = (arr) => arr.length && arr.every((x) => x && typeof x === "object" && "id" in x);
    if (ided(a) && ided(b)) {
      const byId = new Map();
      b.forEach((x) => byId.set(x.id, x));
      a.forEach((x) => byId.set(x.id, byId.has(x.id) ? mergeConfigVal(x, byId.get(x.id)) : x));
      return [...byId.values()];
    }
    return a.length >= b.length ? a : b;
  }
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const out = { ...b };
    for (const k of Object.keys(a)) out[k] = k in b ? mergeConfigVal(a[k], b[k]) : a[k];
    return out;
  }
  return a === undefined ? b : a;
}

// ─── push straight onto a DEPLOYED server via its /api/outreach (clean CAS replace) ─────
async function pushConfig(endpoint, data, opts) {
  const key = process.env.OUTREACH_ADMIN_KEY;
  if (!key)
    die(
      "OUTREACH_ADMIN_KEY (the NEW server's admin key) is not set. Export it in your shell:\n" +
        "  export OUTREACH_ADMIN_KEY='<the new app's admin key>'",
    );
  const call = async (body) => {
    let res;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-key": key },
        body: JSON.stringify(body),
      });
    } catch (e) {
      die(`could not reach the server (${endpoint}): ${e?.message || e}`);
    }
    const j = await res.json().catch(() => ({ ok: false, error: `bad response (HTTP ${res.status})` }));
    if (!res.ok || j.ok === false) {
      const err = j.error || "HTTP " + res.status;
      const hint = /too large/i.test(err)
        ? "\n  → exceeds the server's size cap. Use the SQL seed instead (no cap):\n" +
          '    docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < seed-config.sql'
        : /unauthorized/i.test(err)
          ? "\n  → OUTREACH_ADMIN_KEY doesn't match the server's ADMIN_KEY."
          : "";
      die(`${body.action} failed: ${err}${hint}`);
    }
    return j;
  };

  const cur = await call({ action: "get_config" });
  const serverCfg = cur.config || null;
  const serverRev = Number(serverCfg?._rev) || 0;
  const serverClients = Array.isArray(serverCfg?.clients) ? serverCfg.clients.length : 0;
  console.log(`\nTarget server: ${endpoint}`);
  console.log(`  before: rev ${serverRev}, ${serverClients} client(s)`);

  let payload = { ...data };
  delete payload._dirty;
  if (opts.merge) {
    if (!serverCfg) console.log("  (--merge: server is empty — nothing to merge)");
    else payload = mergeConfigVal(payload, serverCfg);
  }
  const newClients = Array.isArray(payload.clients) ? payload.clients.length : 0;
  const bytes = JSON.stringify(payload).length;

  if (!opts.merge && !opts.yes && serverClients > 0) {
    die(
      `refusing to REPLACE ${serverClients} server client(s) with ${newClients} without confirmation.\n` +
        `  Re-run with --yes to replace, or --merge to keep both.`,
    );
  }

  // baseRev === serverRev → the CAS matches → the UPDATE overwrites the whole row (a true
  // replace, not the app's union-merge). Retry a few times if a concurrent writer races us.
  let r = await call({ action: "save_config", config: payload, baseRev: serverRev });
  let guard = 0;
  while (r.conflict && guard++ < 3) {
    const nrev = Number(r.rev) || 0;
    console.log(`  (server advanced to rev ${nrev} mid-push; retrying…)`);
    r = await call({ action: "save_config", config: payload, baseRev: nrev });
  }
  if (r.conflict) die("the server kept changing under us — retry once writes settle.");

  const after = await call({ action: "get_config" });
  const n = Array.isArray(after.config?.clients) ? after.config.clients.length : 0;
  console.log(`  after:  rev ${after.config?._rev}, ${n} client(s)  (${bytes} bytes sent)`);
  if (n === newClients) console.log(`  ✓ pushed — the server now holds ${n} client(s).`);
  else console.log(`  ⚠️ expected ${newClients} but the server reports ${n} — verify manually.`);
}

// ─── main ─────────────────────────────────────────────────────────────────────────
async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!a.pull && !a.file) die("choose a source: --pull (live) or --file <export.json>");
  if (a.pull && a.file) die("choose only one source: --pull OR --file");

  const cfg = a.pull ? await pullConfig(a.url || DEFAULT_URL) : await readConfigFile(a.file);
  const counts = validate(cfg);
  const { data, rev } = normalize(cfg, a.rev);

  console.log(`\nLegacy config acquired (${a.pull ? "live pull" : a.file}):`);
  for (const [k, v] of Object.entries(counts)) console.log(`  ${String(v).padStart(4)}  ${k}`);
  console.log(`  rev to stamp: ${rev} (legacy _rev was ${Number(cfg._rev) || 0})`);

  // Pushing to a live server is the remote path; don't also drop a stray SQL file unless the
  // caller explicitly asked for one (--out) or is writing to Postgres directly (--direct).
  const wantSql = !a.noSql && (!a.push || a.outExplicit);
  if (wantSql) {
    emitSql(data, rev, a.out);
    console.log(`\n✓ wrote ${a.out}`);
    console.log(`  apply on the server with:`);
    console.log(`    docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < ${a.out.split(/[\\/]/).pop()}`);
  }
  if (a.direct) {
    console.log(`\nWriting directly to Postgres (DATABASE_URL)…`);
    await directUpsert(data, rev, a.force);
  }
  if (a.push) {
    await pushConfig(a.push, data, { merge: a.merge, yes: a.yes });
  }
  console.log(`\nDone. Boot the app with a fresh browser (clear localStorage 'outreach_config_v2') and verify counts.\n`);
}

main().catch((e) => die(e?.stack || e?.message || String(e)));
