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
//   Flags:
//     --pull                 fetch config via get_config (OUTREACH_ADMIN_KEY env)
//     --file <path>          read config from an exported JSON file instead
//     --url <endpoint>       override the edge-function URL (default: the legacy one)
//     --rev <n>              rev to stamp (default: legacy _rev, else 1)
//     --out <path>           SQL output path (default: scripts/seed-config.sql)
//     --direct               also upsert into Postgres via DATABASE_URL
//     --force                allow --direct to overwrite an existing config row
//     --no-sql               skip writing the .sql file (use with --direct)

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
    else if (t === "--no-sql") a.noSql = true;
    else if (t === "--file") a.file = argv[++i];
    else if (t === "--url") a.url = argv[++i];
    else if (t === "--rev") a.rev = Number(argv[++i]);
    else if (t === "--out") a.out = resolve(process.cwd(), argv[++i]);
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

  if (!a.noSql) {
    emitSql(data, rev, a.out);
    console.log(`\n✓ wrote ${a.out}`);
    console.log(`  apply on the server with:`);
    console.log(`    docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < ${a.out.split(/[\\/]/).pop()}`);
  }
  if (a.direct) {
    console.log(`\nWriting directly to Postgres (DATABASE_URL)…`);
    await directUpsert(data, rev, a.force);
  }
  console.log(`\nDone. Boot the app with a fresh browser (clear localStorage 'outreach_config_v2') and verify counts.\n`);
}

main().catch((e) => die(e?.stack || e?.message || String(e)));
