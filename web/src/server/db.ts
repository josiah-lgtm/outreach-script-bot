// Postgres data layer for the self-hosted backend.
//
// Replaces the old Supabase-Storage object access (config.json, users.json,
// usage.json, secrets.json, login-attempts.json). The config document keeps the
// SAME shape the client expects — a JSON object carrying `_rev` inside it — while
// a dedicated `rev` column powers an ATOMIC compare-and-swap (SELECT … FOR UPDATE),
// which is strictly safer than the old read-then-write against Storage.

import { Pool, type PoolClient } from "pg";

// One pool per process. `globalThis` guard survives Next.js dev hot-reloads so we
// don't leak a new pool on every change.
const g = globalThis as unknown as { __pgPool?: Pool };
function pool(): Pool {
  if (!g.__pgPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    g.__pgPool = new Pool({ connectionString, max: 10 });
  }
  return g.__pgPool;
}

// ─── Config (single jsonb document + CAS) ──────────────────────────────────────

// Mirrors the old configLoad(): returns the stored document (with `_rev` inside),
// or null when nothing has been saved yet. Throws on a transient DB error so the
// caller can return 502 — never silently treats an error as "empty".
export async function getConfig(): Promise<Record<string, unknown> | null> {
  const r = await pool().query<{ data: Record<string, unknown> }>(
    "SELECT data FROM config WHERE id = 1",
  );
  return r.rowCount ? r.rows[0].data : null;
}

export type SaveResult =
  | { ok: true; rev: number }
  | { ok: false; conflict: true; config: unknown; rev: number };

// Atomic compare-and-swap. `baseRev` is the `_rev` the client last loaded (it always
// sends a number, 0 when it has never synced; `null` = legacy last-write-wins client).
// We lock the row (FOR UPDATE) so two concurrent saves can't both pass the check.
// On a rev mismatch we return the current server copy so the client can merge.
// The stored document always carries `_rev` === the `rev` column.
export async function casSaveConfig(
  config: Record<string, unknown>,
  baseRev: number | null,
): Promise<SaveResult> {
  const client: PoolClient = await pool().connect();
  try {
    await client.query("BEGIN");
    const cur = await client.query<{ data: Record<string, unknown>; rev: number }>(
      "SELECT data, rev FROM config WHERE id = 1 FOR UPDATE",
    );

    if (cur.rowCount === 0) {
      // First save ever — there is no stored copy to conflict with.
      const newRev = 1;
      const data = { ...config, _rev: newRev };
      await client.query("INSERT INTO config (id, data, rev) VALUES (1, $1::jsonb, $2)", [
        JSON.stringify(data),
        newRev,
      ]);
      await client.query("COMMIT");
      return { ok: true, rev: newRev };
    }

    const storedRev = cur.rows[0].rev;
    if (baseRev !== null && storedRev !== baseRev) {
      await client.query("ROLLBACK");
      return { ok: false, conflict: true, config: cur.rows[0].data, rev: storedRev };
    }

    const newRev = storedRev + 1;
    const data = { ...config, _rev: newRev };
    await client.query("UPDATE config SET data = $1::jsonb, rev = $2 WHERE id = 1", [
      JSON.stringify(data),
      newRev,
    ]);
    await client.query("COMMIT");
    return { ok: true, rev: newRev };
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* ignore */ }
    throw e;
  } finally {
    client.release();
  }
}

// ─── Small server-side docs (users / usage / secrets / login-attempts) ──────────

export async function kvGet<T = unknown>(key: string): Promise<T | null> {
  const r = await pool().query<{ value: T }>("SELECT value FROM kv WHERE key = $1", [key]);
  return r.rowCount ? r.rows[0].value : null;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await pool().query(
    "INSERT INTO kv (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    [key, JSON.stringify(value)],
  );
}
