// Team logins (email + password → the shared admin key) + brute-force throttle.
// Users and the login-attempt ledger live in Postgres kv (was users.json / login-attempts.json).
// Port of legacy index.ts:336-386, 476-483, 907-933, 1306-1334.

import { kvGet, kvSet } from "./db";
import { json } from "./shared";

interface TeamUser { email: string; name: string; salt: string; hash: string; createdAt: string }

async function usersLoad(): Promise<TeamUser[]> {
  const d = await kvGet<{ users?: TeamUser[] }>("users");
  return Array.isArray(d?.users) ? d!.users : [];
}
async function usersSave(users: TeamUser[]): Promise<void> {
  await kvSet("users", { users });
}

// ─── Login brute-force throttle (per IP + per email) ─────────────────────────
interface LoginAttempt { n: number; first: number }
const LOGIN_WINDOW_MS = 15 * 60_000; // rolling 15-minute window
const LOGIN_MAX = 8;                 // failures per key per window before lockout
async function loginAttemptsLoad(): Promise<Record<string, LoginAttempt>> {
  try {
    const d = await kvGet<Record<string, LoginAttempt>>("login-attempts");
    if (d && typeof d === "object") return d;
  } catch { /* ignore */ }
  return {};
}
async function loginAttemptsSave(d: Record<string, LoginAttempt>): Promise<void> {
  try { await kvSet("login-attempts", d); } catch { /* best effort */ }
}
function loginClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") || "";
  return (xff.split(",")[0] || "").trim() || req.headers.get("cf-connecting-ip") || "unknown";
}

const hexBytes = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function hashPassword(password: string, saltHex: string): Promise<string> {
  const salt = new Uint8Array((saltHex.match(/.{2}/g) ?? []).map((h) => parseInt(h, 16)));
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" }, keyMaterial, 256);
  return hexBytes(bits);
}

// The only unauthenticated action: exchanges valid team credentials for the shared admin key.
export async function handleLogin(body: Record<string, unknown>, req: Request): Promise<Response> {
  const adminKey = process.env.ADMIN_KEY;
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!email || !password) return json({ ok: false, error: "email and password required" }, 400);
  const ip = loginClientIp(req);
  const now = Date.now();
  const keyIp = "ip:" + ip, keyEmail = "em:" + email;
  const attempts = await loginAttemptsLoad();
  for (const k of Object.keys(attempts)) { if (now - attempts[k].first > LOGIN_WINDOW_MS) delete attempts[k]; }
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
  if (attempts[keyIp] || attempts[keyEmail]) { delete attempts[keyIp]; delete attempts[keyEmail]; await loginAttemptsSave(attempts); }
  return json({ ok: true, adminKey, name: u.name, email: u.email });
}

export async function usersList(): Promise<Response> {
  const users = await usersLoad();
  return json({ ok: true, users: users.map((u) => ({ email: u.email, name: u.name, createdAt: u.createdAt })) });
}

export async function usersAdd(body: Record<string, unknown>): Promise<Response> {
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

export async function usersRemove(body: Record<string, unknown>): Promise<Response> {
  const email = String(body.email ?? "").trim().toLowerCase();
  const users = await usersLoad();
  const next = users.filter((u) => u.email.toLowerCase() !== email);
  if (next.length === users.length) return json({ ok: false, error: "no such user" }, 404);
  await usersSave(next);
  return json({ ok: true });
}
