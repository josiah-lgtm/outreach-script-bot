// RFC 8414 — OAuth 2.0 Authorization Server Metadata.
// Served at /.well-known/oauth-authorization-server (+ the /mcp variant, and
// /.well-known/openid-configuration for hosts that probe OIDC first) via
// rewrites in next.config.ts.
//
// PKCE with S256 is advertised as the only challenge method and there is no
// client secret: MCP hosts are public clients.

import { baseUrl } from "@/server/mcp/auth";
import { SCOPES } from "@/server/mcp/oauth-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version",
};

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

export function GET(req: Request): Response {
  const base = baseUrl(req);
  return Response.json(
    {
      issuer: base,
      authorization_endpoint: `${base}/mcp/oauth/authorize`,
      token_endpoint: `${base}/mcp/oauth/token`,
      registration_endpoint: `${base}/mcp/oauth/register`,
      scopes_supported: [...SCOPES],
      response_types_supported: ["code"],
      response_modes_supported: ["query"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
      service_documentation: `${base}/mcp/docs`,
    },
    { headers: { ...CORS, "Cache-Control": "public, max-age=300" } },
  );
}
