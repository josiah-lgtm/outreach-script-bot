// The MCP endpoint — same origin as the app, at <baseUrl>/mcp.
//
// Streamable HTTP transport, stateless mode:
//   POST /mcp    one JSON-RPC request (or a batch) → one JSON response
//   GET  /mcp    405 — this server never opens a server-initiated SSE stream
//   DELETE /mcp  204 — nothing to tear down (no sessions)
//
// Both Claude (custom connectors) and ChatGPT (developer-mode connectors) speak
// this. Auth is a bearer token: either an OAuth access token issued by this app,
// or the shared ADMIN_KEY for CLI clients. An unauthenticated request gets a 401
// carrying the RFC 9728 `WWW-Authenticate` challenge, which is what makes those
// hosts start the OAuth discovery + registration dance instead of giving up.

import { authenticate, unauthorized, baseUrl } from "@/server/mcp/auth";
import {
  handleRpc, SUPPORTED_PROTOCOL_VERSIONS, LATEST_PROTOCOL_VERSION,
  type RpcRequest, type RpcResponse,
} from "@/server/mcp/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Self-hosted Node server: no serverless ceiling, but build_icp + generate can
// legitimately run for minutes with web search enabled.
export const maxDuration = 300;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-admin-key, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID",
  "Access-Control-Expose-Headers": "WWW-Authenticate, MCP-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

function jsonResponse(body: unknown, status: number, protocolVersion: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "MCP-Protocol-Version": protocolVersion },
  });
}

function rpcError(id: unknown, code: number, message: string, status: number, protocolVersion: string): Response {
  return jsonResponse({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, status, protocolVersion);
}

/** The version the client pinned via header, else the latest we support. */
function negotiate(req: Request): string {
  const asked = (req.headers.get("mcp-protocol-version") || "").trim();
  return SUPPORTED_PROTOCOL_VERSIONS.includes(asked) ? asked : LATEST_PROTOCOL_VERSION;
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(req: Request): Promise<Response> {
  // No server-initiated stream: the spec allows a server to decline the SSE
  // channel with 405, and every stateless tool call here is request/response.
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32000, message: "This MCP server is stateless — POST JSON-RPC requests to this endpoint. No server-initiated SSE stream is offered." },
    }),
    {
      status: 405,
      headers: { ...CORS, "Content-Type": "application/json", Allow: "POST, DELETE, OPTIONS", "MCP-Protocol-Version": negotiate(req) },
    },
  );
}

export async function DELETE(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(req: Request): Promise<Response> {
  const protocolVersion = negotiate(req);

  const principal = await authenticate(req);
  if (!principal) return unauthorized(req);

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return rpcError(null, -32700, "Parse error: request body is not valid JSON", 400, protocolVersion);
  }

  const opts = { principal, baseUrl: baseUrl(req), protocolVersion };

  // A batch is answered with an array of the responses to the requests in it;
  // notifications contribute nothing, so an all-notification batch gets 202.
  if (Array.isArray(payload)) {
    if (!payload.length) {
      return rpcError(null, -32600, "Invalid Request: empty batch", 400, protocolVersion);
    }
    const results: RpcResponse[] = [];
    for (const msg of payload) {
      const r = await handleRpc(msg, opts);
      if (r) results.push(r);
    }
    if (!results.length) return new Response(null, { status: 202, headers: CORS });
    return jsonResponse(results, 200, protocolVersion);
  }

  const response = await handleRpc(payload as RpcRequest, opts);
  if (!response) return new Response(null, { status: 202, headers: CORS });
  return jsonResponse(response, 200, protocolVersion);
}
