// Login / logout. Port of legacy index.html:6907-6938, rebuilt as controlled handlers
// (no getElementById). Same localStorage keys (offer_admin_key, outreach_user) and the
// same `login` action contract → returns the shared admin key.

import { api } from "./api";
import { setAdminKey, safeStorageSet, safeStorageGet, cleanKey } from "./adminKey";

export type TeamUser = { email: string; name: string };

export async function doLogin(
  email: string,
  password: string,
): Promise<{ ok: true; user: TeamUser } | { ok: false; error: string }> {
  try {
    const r = await api({ action: "login", email: String(email || "").trim().toLowerCase(), password: String(password || "") });
    const key = cleanKey(r.adminKey);
    if (!key) return { ok: false, error: "Server did not return an admin key." };
    setAdminKey(key);
    safeStorageSet("offer_admin_key", key);
    const user: TeamUser = { email: r.email || email, name: r.name || "" };
    safeStorageSet("outreach_user", JSON.stringify(user));
    return { ok: true, user };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || "Login failed" };
  }
}

export function loginWithKey(key: string): boolean {
  const k = cleanKey(key);
  if (!k) return false;
  setAdminKey(k);
  safeStorageSet("offer_admin_key", k);
  return true;
}

export function signOut(): void {
  setAdminKey("");
  try {
    localStorage.removeItem("offer_admin_key");
    localStorage.removeItem("outreach_user");
  } catch { /* ignore */ }
}

export function storedUser(): TeamUser | null {
  try {
    const s = safeStorageGet("outreach_user");
    return s ? (JSON.parse(s) as TeamUser) : null;
  } catch {
    return null;
  }
}
