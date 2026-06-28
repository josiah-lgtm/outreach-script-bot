// The single client→server POST helper. Verbatim port of legacy index.html:1006/1264-1278,
// retargeted from the external Supabase function to the app's own same-origin route.
// IMPORTANT: a save_config conflict comes back as HTTP 200 {ok:true,conflict:true,...} —
// api() must NOT throw on it; the caller inspects r.conflict.

import { withSystemFilter } from "./systemFilter";
import { getAdminKey } from "./adminKey";

const OUTREACH_URL = process.env.NEXT_PUBLIC_OUTREACH_URL || "/api/outreach";

// deno-lint-ignore no-explicit-any
export async function api(body: any): Promise<any> {
  body = withSystemFilter(body);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const adminKey = getAdminKey();
  if (adminKey) headers["x-admin-key"] = adminKey;
  let res: Response;
  try {
    res = await fetch(OUTREACH_URL, { method: "POST", headers, body: JSON.stringify(body) });
  } catch (e) {
    throw new Error("Could not reach the server (network/blocked/too large). " + ((e as Error)?.message || ""));
  }
  const data = await res.json().catch(() => ({ ok: false, error: "bad response" }));
  if (!res.ok || data.ok === false) throw new Error(data.error || ("HTTP " + res.status));
  return data;
}
