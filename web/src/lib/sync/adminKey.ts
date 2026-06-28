// Admin-key handling. Port of legacy index.html:1008-1032. The key is a per-user
// runtime credential held in module scope (read synchronously by api()) + localStorage —
// NOT a build-time secret. cleanKey lives in text-utils (shared with the login form).

import { cleanKey } from "../text-utils";

export function safeStorageGet(key: string): string {
  try { return localStorage.getItem(key) || ""; } catch { return ""; }
}
export function safeStorageSet(key: string, value: string): boolean {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}

let adminKey = "";
let keyFromLink = false;

export function getAdminKey(): string { return adminKey; }
export function setAdminKey(k: string): void { adminKey = cleanKey(k); }
export function isKeyFromLink(): boolean { return keyFromLink; }

// Run once on boot (browser only): capture ?admin=… into localStorage and scrub it from
// the URL so it can't be bookmarked/shared, else fall back to the stored key.
export function initAdminKey(): void {
  if (typeof window === "undefined") return;
  try {
    const u = new URL(location.href);
    const qk = cleanKey(u.searchParams.get("admin"));
    if (qk) {
      adminKey = qk; safeStorageSet("offer_admin_key", qk); keyFromLink = true;
      u.searchParams.delete("admin");
      history.replaceState(null, "", u.pathname + (u.searchParams.toString() ? "?" + u.searchParams.toString() : ""));
    }
  } catch { /* ignore */ }
  if (!adminKey) adminKey = cleanKey(safeStorageGet("offer_admin_key"));
}

export { cleanKey };
