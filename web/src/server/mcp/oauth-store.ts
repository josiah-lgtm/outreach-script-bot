// Storage + crypto for the MCP OAuth 2.1 authorization server.
//
// Claude and ChatGPT both connect to a remote MCP server by discovering OAuth
// metadata, dynamically registering themselves as a public client, and running an
// authorization-code + PKCE flow. None of that needs a new table: registered
// clients, one-time codes and tokens are small documents in the existing `kv`
// table, keyed by a SHA-256 of the secret so a database dump never yields a
// usable credential.
//
//   kv['mcp:client:<client_id>']  registered client
//   kv['mcp:code:<sha256>']       authorization code (60s, single use)
//   kv['mcp:at:<sha256>']         access token
//   kv['mcp:rt:<sha256>']         refresh token

import { kvGet, kvSet, kvDel, kvKeys } from "../db";

export const SCOPES = ["outreach:read", "outreach:write"] as const;
export type Scope = (typeof SCOPES)[number];
export const DEFAULT_SCOPE = "outreach:read outreach:write";

const CODE_TTL_MS = 60_000;
export const ACCESS_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const REFRESH_TTL_MS = 365 * 24 * 60 * 60 * 1000; // 1 year

export interface RegisteredClient {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: "none";
  scope: string;
  created_at: number;
}

export interface AuthCode {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  scope: string;
  sub: string;
  resource?: string;
  exp: number;
}

export interface TokenRecord {
  clientId: string;
  sub: string;
  scope: string;
  exp: number;
  kind: "access" | "refresh";
}

// ─── crypto helpers ──────────────────────────────────────────────────────────

const b64url = (buf: ArrayBuffer): string =>
  Buffer.from(new Uint8Array(buf)).toString("base64url");

export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)).buffer);
}

export async function sha256b64url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return b64url(digest);
}

/** Constant-time-ish string compare (both sides are fixed-length digests here). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ─── clients ─────────────────────────────────────────────────────────────────

export async function saveClient(c: RegisteredClient): Promise<void> {
  await kvSet(`mcp:client:${c.client_id}`, c);
}

export async function loadClient(clientId: string): Promise<RegisteredClient | null> {
  if (!clientId || !/^[A-Za-z0-9_-]{1,128}$/.test(clientId)) return null;
  return await kvGet<RegisteredClient>(`mcp:client:${clientId}`);
}

// ─── authorization codes ─────────────────────────────────────────────────────

export async function issueCode(data: Omit<AuthCode, "exp">): Promise<string> {
  const code = randomToken(32);
  await kvSet(`mcp:code:${await sha256b64url(code)}`, { ...data, exp: Date.now() + CODE_TTL_MS });
  return code;
}

/** Single-use: the record is deleted whether or not it validates. */
export async function consumeCode(code: string): Promise<AuthCode | null> {
  const key = `mcp:code:${await sha256b64url(code)}`;
  const rec = await kvGet<AuthCode>(key);
  await kvDel(key);
  if (!rec) return null;
  if (rec.exp < Date.now()) return null;
  return rec;
}

// ─── tokens ──────────────────────────────────────────────────────────────────

export async function issueTokens(
  clientId: string,
  sub: string,
  scope: string,
): Promise<{ access_token: string; refresh_token: string; expires_in: number; scope: string }> {
  const access = randomToken(32);
  const refresh = randomToken(32);
  const now = Date.now();
  await kvSet(`mcp:at:${await sha256b64url(access)}`, {
    clientId, sub, scope, kind: "access", exp: now + ACCESS_TTL_MS,
  } satisfies TokenRecord);
  await kvSet(`mcp:rt:${await sha256b64url(refresh)}`, {
    clientId, sub, scope, kind: "refresh", exp: now + REFRESH_TTL_MS,
  } satisfies TokenRecord);
  return {
    access_token: access,
    refresh_token: refresh,
    expires_in: Math.floor(ACCESS_TTL_MS / 1000),
    scope,
  };
}

export async function loadAccessToken(token: string): Promise<TokenRecord | null> {
  if (!token) return null;
  const rec = await kvGet<TokenRecord>(`mcp:at:${await sha256b64url(token)}`);
  if (!rec) return null;
  if (rec.exp < Date.now()) {
    await kvDel(`mcp:at:${await sha256b64url(token)}`);
    return null;
  }
  return rec;
}

/**
 * Look at a refresh token WITHOUT consuming it.
 *
 * Consumption is deliberately a separate step: a request that fails validation
 * (wrong client_id, an attempt to widen scope) must not burn the token, or one
 * malformed refresh would permanently disconnect the connector and force the
 * user to re-authorize. Authorization CODES are the opposite — see consumeCode,
 * which deletes first so a wrong verifier can't be brute-forced.
 */
export async function peekRefreshToken(token: string): Promise<TokenRecord | null> {
  if (!token) return null;
  const rec = await kvGet<TokenRecord>(`mcp:rt:${await sha256b64url(token)}`);
  if (!rec) return null;
  if (rec.exp < Date.now()) {
    await kvDel(`mcp:rt:${await sha256b64url(token)}`);
    return null;
  }
  return rec;
}

/** Rotation: retire a refresh token once its exchange has fully validated. */
export async function revokeRefreshToken(token: string): Promise<void> {
  if (!token) return;
  await kvDel(`mcp:rt:${await sha256b64url(token)}`);
}

/**
 * Best-effort sweep of expired grants. Called opportunistically from the token
 * endpoint (the volumes here are tiny — a handful of connectors per install).
 */
export async function pruneExpired(): Promise<number> {
  let removed = 0;
  try {
    const now = Date.now();
    for (const prefix of ["mcp:code:", "mcp:at:", "mcp:rt:"]) {
      const keys = await kvKeys(prefix);
      for (const k of keys) {
        const rec = await kvGet<{ exp?: number }>(k);
        if (rec && typeof rec.exp === "number" && rec.exp < now) {
          await kvDel(k);
          removed++;
        }
      }
    }
  } catch { /* best effort */ }
  return removed;
}

// ─── PKCE ────────────────────────────────────────────────────────────────────

export async function verifyPkce(verifier: string, challenge: string): Promise<boolean> {
  if (!verifier || !challenge) return false;
  if (verifier.length < 43 || verifier.length > 128) return false;
  return safeEqual(await sha256b64url(verifier), challenge);
}
