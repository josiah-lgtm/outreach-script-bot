// RFC 7591 — OAuth 2.0 Dynamic Client Registration.
//
// Claude and ChatGPT register themselves here the first time someone adds this
// connector; there is no console for an admin to pre-create a client in. Public
// clients only: no secret is issued, and PKCE is mandatory at the token endpoint,
// so an unauthenticated registration endpoint does not by itself grant anything —
// a registered client still cannot get a token without a human completing the
// authorize step.

import { saveClient, randomToken, DEFAULT_SCOPE, type RegisteredClient } from "@/server/mcp/oauth-store";

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
  return Response.json({ error, error_description: description }, { status, headers: CORS });
}

/** Only http(s) absolute URLs; loopback http is allowed for local dev clients. */
function validRedirect(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.protocol === "https:") return true;
    if (u.protocol === "http:") return ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
    return false;
  } catch {
    return false;
  }
}

export async function POST(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return bad("invalid_client_metadata", "Body must be JSON.");
  }

  const redirect_uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : [];
  if (!redirect_uris.length) {
    return bad("invalid_redirect_uri", "At least one redirect_uri is required.");
  }
  const invalid = redirect_uris.filter((u) => !validRedirect(u));
  if (invalid.length) {
    return bad("invalid_redirect_uri", `Not an allowed redirect URI (https, or http on loopback): ${invalid.join(", ")}`);
  }

  const client: RegisteredClient = {
    client_id: randomToken(16),
    client_name: String(body.client_name ?? "MCP client").slice(0, 120),
    redirect_uris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    scope: typeof body.scope === "string" && body.scope.trim() ? body.scope.trim() : DEFAULT_SCOPE,
    created_at: Date.now(),
  };
  await saveClient(client);

  return Response.json(
    {
      client_id: client.client_id,
      client_name: client.client_name,
      redirect_uris: client.redirect_uris,
      grant_types: client.grant_types,
      response_types: client.response_types,
      token_endpoint_auth_method: client.token_endpoint_auth_method,
      scope: client.scope,
      client_id_issued_at: Math.floor(client.created_at / 1000),
    },
    { status: 201, headers: CORS },
  );
}
