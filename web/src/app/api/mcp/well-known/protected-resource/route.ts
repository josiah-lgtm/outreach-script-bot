// RFC 9728 — OAuth 2.0 Protected Resource Metadata.
// Served at /.well-known/oauth-protected-resource (and the /mcp-suffixed variant)
// via rewrites in next.config.ts, because Next's file router ignores dot-prefixed
// directories.
//
// This is the document a host fetches after our 401's WWW-Authenticate header
// points at it; it tells them which authorization server to talk to.

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
      resource: `${base}/mcp`,
      authorization_servers: [base],
      scopes_supported: [...SCOPES],
      bearer_methods_supported: ["header"],
      resource_name: "Outreach Script Bot",
      resource_documentation: `${base}/mcp/docs`,
    },
    { headers: { ...CORS, "Cache-Control": "public, max-age=300" } },
  );
}
