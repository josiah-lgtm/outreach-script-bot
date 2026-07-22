// OAuth 2.1 token endpoint: authorization_code + refresh_token grants.
//
// Public clients only (no client_secret), so PKCE is what actually authenticates
// the exchange: the code is bound to the S256 challenge presented at /authorize
// and will only be released to whoever holds the matching verifier.

import {
  consumeCode, issueTokens, peekRefreshToken, revokeRefreshToken, verifyPkce, loadClient, pruneExpired,
} from "@/server/mcp/oauth-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

function bad(error: string, description: string, status = 400): Response {
  return Response.json(
    { error, error_description: description },
    { status, headers: { ...CORS, "Cache-Control": "no-store" } },
  );
}

function issued(t: { access_token: string; refresh_token: string; expires_in: number; scope: string }): Response {
  return Response.json(
    { token_type: "Bearer", ...t },
    { headers: { ...CORS, "Cache-Control": "no-store", Pragma: "no-cache" } },
  );
}

/**
 * Accepts form-encoded (the spec) and JSON (some clients send it anyway).
 * Parses defensively: a wrong or missing Content-Type must produce a clean
 * `invalid_request` from the caller below, never a 500 from a throwing parser.
 */
async function readBody(req: Request): Promise<Record<string, string>> {
  const ct = (req.headers.get("content-type") || "").toLowerCase();
  const raw = await req.text().catch(() => "");
  if (!raw) return {};

  const flat = (obj: unknown): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries((obj ?? {}) as Record<string, unknown>)) out[k] = String(v ?? "");
    return out;
  };

  if (ct.includes("json") || raw.trimStart().startsWith("{")) {
    try { return flat(JSON.parse(raw)); } catch { /* fall through to form parsing */ }
  }
  try {
    const out: Record<string, string> = {};
    new URLSearchParams(raw).forEach((v, k) => { out[k] = v; });
    return out;
  } catch {
    return {};
  }
}

export async function POST(req: Request): Promise<Response> {
  const b = await readBody(req);
  const grant = b.grant_type ?? "";

  if (grant === "authorization_code") {
    const code = b.code ?? "";
    const verifier = b.code_verifier ?? "";
    const clientId = b.client_id ?? "";
    const redirectUri = b.redirect_uri ?? "";
    if (!code) return bad("invalid_request", "code is required.");
    if (!verifier) return bad("invalid_request", "code_verifier is required (PKCE).");

    const rec = await consumeCode(code);
    if (!rec) return bad("invalid_grant", "That authorization code is invalid, already used, or expired.");
    if (clientId && clientId !== rec.clientId) return bad("invalid_grant", "client_id does not match the code.");
    if (redirectUri && redirectUri !== rec.redirectUri) return bad("invalid_grant", "redirect_uri does not match the code.");
    if (!(await verifyPkce(verifier, rec.codeChallenge))) {
      return bad("invalid_grant", "code_verifier does not match the code_challenge.");
    }

    void pruneExpired(); // opportunistic, fire-and-forget
    return issued(await issueTokens(rec.clientId, rec.sub, rec.scope));
  }

  if (grant === "refresh_token") {
    const token = b.refresh_token ?? "";
    if (!token) return bad("invalid_request", "refresh_token is required.");
    // Validate everything BEFORE retiring the token — a rejected refresh must
    // leave the connector able to try again.
    const rec = await peekRefreshToken(token);
    if (!rec) return bad("invalid_grant", "That refresh token is invalid, already used, or expired.");
    if (b.client_id && b.client_id !== rec.clientId) return bad("invalid_grant", "client_id does not match the token.");
    if (!(await loadClient(rec.clientId))) return bad("invalid_grant", "The client for this token no longer exists.");

    // A refresh may narrow scope but never widen it.
    let scope = rec.scope;
    if (b.scope) {
      const held = new Set(rec.scope.split(/\s+/).filter(Boolean));
      const asked = b.scope.split(/\s+/).filter(Boolean);
      if (asked.some((s) => !held.has(s))) return bad("invalid_scope", "Cannot widen scope on refresh.");
      scope = asked.join(" ");
    }

    await revokeRefreshToken(token);
    return issued(await issueTokens(rec.clientId, rec.sub, scope));
  }

  return bad("unsupported_grant_type", `grant_type "${grant}" is not supported. Use authorization_code or refresh_token.`);
}
