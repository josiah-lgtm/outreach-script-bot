// OAuth 2.1 authorization endpoint.
//
// GET  renders a self-contained sign-in page (no client bundle, no styling
//      dependency on the app — this renders inside a host's popup window).
// POST verifies the credentials, issues a single-use authorization code bound to
//      the client's PKCE challenge, and redirects back to the host.
//
// Sign in with a team login (Admin → Settings → Team logins) or with the shared
// admin key. The "allow changes" checkbox is what decides whether the issued
// token carries outreach:write — an unchecked box yields a read-only connector.

import { verifyTeamCredentials } from "@/server/auth";
import { issueCode, loadClient, SCOPES, safeEqual } from "@/server/mcp/oauth-store";
import { esc } from "@/lib/text-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AuthParams {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  method: string;
  scope: string;
  resource: string;
}

function readParams(u: URL): AuthParams {
  return {
    clientId: u.searchParams.get("client_id") ?? "",
    redirectUri: u.searchParams.get("redirect_uri") ?? "",
    state: u.searchParams.get("state") ?? "",
    codeChallenge: u.searchParams.get("code_challenge") ?? "",
    method: u.searchParams.get("code_challenge_method") ?? "",
    scope: u.searchParams.get("scope") ?? "",
    resource: u.searchParams.get("resource") ?? "",
  };
}

/**
 * Validate everything we must NOT redirect errors for (an unverified redirect_uri
 * would turn this endpoint into an open redirector). Returns an error string to
 * render as a page, or null when it is safe to redirect errors back to the client.
 */
async function validate(p: AuthParams): Promise<string | null> {
  if (!p.clientId) return "Missing client_id.";
  const client = await loadClient(p.clientId);
  if (!client) return "Unknown client_id. The application needs to register itself before authorizing.";
  if (!p.redirectUri) return "Missing redirect_uri.";
  if (!client.redirect_uris.includes(p.redirectUri)) {
    return "redirect_uri does not match any URI this client registered.";
  }
  if (p.method !== "S256") return "code_challenge_method must be S256.";
  if (!p.codeChallenge || p.codeChallenge.length < 43) return "A valid PKCE code_challenge is required.";
  return null;
}

function page(title: string, body: string, status = 200): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Outreach Script Bot</title>
<style>
  :root { color-scheme: light dark; --bg:#0f1115; --card:#171a21; --border:#272b35; --text:#e8eaee; --muted:#9aa1ad; --accent:#5b8cff; }
  @media (prefers-color-scheme: light) { :root { --bg:#f6f7f9; --card:#fff; --border:#e2e5ea; --text:#171a21; --muted:#606875; } }
  * { box-sizing:border-box }
  body { margin:0; min-height:100vh; display:grid; place-items:center; padding:24px;
         background:var(--bg); color:var(--text);
         font:15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif }
  .card { width:100%; max-width:420px; background:var(--card); border:1px solid var(--border);
          border-radius:14px; padding:28px }
  h1 { margin:0 0 6px; font-size:19px }
  p.sub { margin:0 0 20px; color:var(--muted); font-size:13.5px }
  label { display:block; font-size:12.5px; font-weight:600; margin:14px 0 6px; color:var(--muted) }
  input[type=text],input[type=email],input[type=password] {
    width:100%; padding:10px 12px; border:1px solid var(--border); border-radius:9px;
    background:var(--bg); color:var(--text); font-size:14px }
  input:focus { outline:2px solid var(--accent); outline-offset:1px; border-color:transparent }
  .row { display:flex; gap:9px; align-items:flex-start; margin:18px 0 4px }
  .row input { margin-top:3px }
  .row span { font-size:13px; color:var(--muted) }
  button { width:100%; margin-top:20px; padding:11px; border:0; border-radius:9px;
           background:var(--accent); color:#fff; font-size:14.5px; font-weight:600; cursor:pointer }
  button:hover { filter:brightness(1.08) }
  .err { background:#3a1d22; border:1px solid #6b2b34; color:#ffb4bd; padding:10px 12px;
         border-radius:9px; font-size:13.5px; margin-bottom:16px }
  @media (prefers-color-scheme: light) { .err { background:#fdeced; border-color:#f5c2c7; color:#8a1c28 } }
  .or { text-align:center; color:var(--muted); font-size:12px; margin:16px 0 0 }
  .app { display:flex; align-items:center; gap:8px; margin-bottom:18px; padding:10px 12px;
         border:1px solid var(--border); border-radius:9px; font-size:13.5px }
  .dot { width:8px; height:8px; border-radius:50%; background:var(--accent); flex:0 0 auto }
</style></head><body><div class="card">${body}</div></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}

function form(p: AuthParams, clientName: string, error?: string): Response {
  const hidden = Object.entries({
    client_id: p.clientId, redirect_uri: p.redirectUri, state: p.state,
    code_challenge: p.codeChallenge, code_challenge_method: p.method,
    scope: p.scope, resource: p.resource,
  })
    .map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v)}">`)
    .join("");

  return page(
    "Connect",
    `<h1>Connect to Outreach Script Bot</h1>
<p class="sub">Sign in to let this application read and change your outreach data.</p>
<div class="app"><span class="dot"></span><b>${esc(clientName)}</b>&nbsp;is requesting access</div>
${error ? `<div class="err">${esc(error)}</div>` : ""}
<form method="POST">
  ${hidden}
  <label for="email">Team email</label>
  <input id="email" name="email" type="email" autocomplete="username" placeholder="you@agency.com">
  <label for="password">Password</label>
  <input id="password" name="password" type="password" autocomplete="current-password">
  <p class="or">or sign in with the shared admin key instead</p>
  <label for="adminKey">Admin key</label>
  <input id="adminKey" name="adminKey" type="password" autocomplete="off" placeholder="leave blank if using email">
  <div class="row">
    <input id="allowWrite" name="allowWrite" type="checkbox" value="1" checked>
    <span><b>Allow changes.</b> Uncheck for read-only access — the connector can then look at clients, ICPs, scripts and logic, but cannot edit or generate anything that saves.</span>
  </div>
  <button type="submit">Approve access</button>
</form>`,
    error ? 400 : 200,
  );
}

export async function GET(req: Request): Promise<Response> {
  const p = readParams(new URL(req.url));
  const problem = await validate(p);
  if (problem) return page("Cannot authorize", `<h1>Cannot authorize</h1><div class="err">${esc(problem)}</div>`, 400);
  const client = await loadClient(p.clientId);
  return form(p, client?.client_name ?? "An application");
}

export async function POST(req: Request): Promise<Response> {
  const body = await req.formData();
  const get = (k: string) => String(body.get(k) ?? "");
  const p: AuthParams = {
    clientId: get("client_id"), redirectUri: get("redirect_uri"), state: get("state"),
    codeChallenge: get("code_challenge"), method: get("code_challenge_method"),
    scope: get("scope"), resource: get("resource"),
  };
  const problem = await validate(p);
  if (problem) return page("Cannot authorize", `<h1>Cannot authorize</h1><div class="err">${esc(problem)}</div>`, 400);
  const client = await loadClient(p.clientId);
  const clientName = client?.client_name ?? "An application";

  // ── authenticate the human ──
  const email = get("email").trim();
  const password = get("password");
  const adminKey = get("adminKey").trim();
  let sub = "";

  if (adminKey) {
    const expected = process.env.ADMIN_KEY || "";
    if (!expected || !safeEqual(adminKey, expected)) {
      return form(p, clientName, "That admin key is not correct.");
    }
    sub = "admin-key";
  } else if (email || password) {
    const r = await verifyTeamCredentials(email, password, req);
    if (!r.ok) return form(p, clientName, r.error);
    sub = r.email;
  } else {
    return form(p, clientName, "Enter your team email and password, or the shared admin key.");
  }

  // ── scope ──
  // Never grant more than the client asked for, and never more than we define.
  const requested = p.scope.split(/\s+/).filter(Boolean);
  const allowWrite = get("allowWrite") === "1";
  let granted = (requested.length ? requested : [...SCOPES]).filter((s) => (SCOPES as readonly string[]).includes(s));
  if (!granted.length) granted = [...SCOPES];
  if (!allowWrite) granted = granted.filter((s) => s !== "outreach:write");
  if (!granted.includes("outreach:read")) granted.push("outreach:read");

  const code = await issueCode({
    clientId: p.clientId,
    redirectUri: p.redirectUri,
    codeChallenge: p.codeChallenge,
    codeChallengeMethod: "S256",
    scope: granted.join(" "),
    sub,
    resource: p.resource || undefined,
  });

  const back = new URL(p.redirectUri);
  back.searchParams.set("code", code);
  if (p.state) back.searchParams.set("state", p.state);
  return Response.redirect(back.toString(), 303);
}
