// Bearer-token gate for /mcp.
//
// Two credentials are accepted, in this order:
//
//  1. An OAuth access token issued by this app's own authorization server. This is
//     the path Claude and ChatGPT take: they hit /mcp unauthenticated, get a 401
//     carrying `WWW-Authenticate: Bearer resource_metadata=…`, discover the
//     metadata, register themselves (RFC 7591) and run authorization-code + PKCE.
//
//  2. The shared ADMIN_KEY, as `Authorization: Bearer <key>` or `x-admin-key`.
//     This is the escape hatch for CLI clients (Claude Code, curl, scripts) that
//     can set a header, and for local development. Disable it by setting
//     MCP_ALLOW_ADMIN_KEY=false once every consumer is on OAuth.
//
// A 401 from here MUST carry the WWW-Authenticate challenge — that header is the
// entire discovery trigger for both hosts. Without it they show "connection
// failed" instead of opening the sign-in popup.

import { loadAccessToken } from "./oauth-store";
import { safeEqual } from "./oauth-store";

export interface Principal {
  /** Who: an email for OAuth grants, "admin-key" for the shared-key path. */
  sub: string;
  scopes: string[];
  via: "oauth" | "admin-key";
  clientId?: string;
}

export function canWrite(p: Principal): boolean {
  return p.scopes.includes("outreach:write");
}

/**
 * Public origin of this deployment. The app sits behind nginx, so the request's
 * own Host/X-Forwarded-* headers are the source of truth unless pinned by env.
 */
export function baseUrl(req: Request): string {
  const pinned = process.env.MCP_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL;
  if (pinned) return pinned.replace(/\/+$/, "");
  const h = req.headers;
  const proto = (h.get("x-forwarded-proto") || "").split(",")[0].trim()
    || new URL(req.url).protocol.replace(":", "")
    || "https";
  const host = (h.get("x-forwarded-host") || h.get("host") || new URL(req.url).host).split(",")[0].trim();
  return `${proto}://${host}`;
}

export function resourceUrl(req: Request): string {
  return `${baseUrl(req)}/mcp`;
}

function adminKeyAllowed(): boolean {
  return String(process.env.MCP_ALLOW_ADMIN_KEY ?? "true").toLowerCase() !== "false";
}

function bearerOf(req: Request): string {
  const raw = req.headers.get("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return m ? m[1].trim() : "";
}

/** Resolve the caller, or null when the request carries no valid credential. */
export async function authenticate(req: Request): Promise<Principal | null> {
  const adminKey = process.env.ADMIN_KEY || "";
  const presented = bearerOf(req);
  const headerKey = (req.headers.get("x-admin-key") || "").trim();

  if (adminKeyAllowed() && adminKey) {
    if (headerKey && safeEqual(headerKey, adminKey)) {
      return { sub: "admin-key", scopes: ["outreach:read", "outreach:write"], via: "admin-key" };
    }
    if (presented && safeEqual(presented, adminKey)) {
      return { sub: "admin-key", scopes: ["outreach:read", "outreach:write"], via: "admin-key" };
    }
  }

  if (presented) {
    try {
      const rec = await loadAccessToken(presented);
      if (rec) {
        return {
          sub: rec.sub,
          scopes: rec.scope.split(/\s+/).filter(Boolean),
          via: "oauth",
          clientId: rec.clientId,
        };
      }
    } catch { /* DB hiccup — fall through to 401 */ }
  }

  return null;
}

/** RFC 9728 challenge: this is what makes a host start the OAuth dance. */
export function unauthorized(req: Request, description = "Authentication required"): Response {
  const metadata = `${baseUrl(req)}/.well-known/oauth-protected-resource`;
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32001, message: description },
      id: null,
    }),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": `Bearer realm="outreach-script-bot", resource_metadata="${metadata}", error="invalid_token", error_description="${description}"`,
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Expose-Headers": "WWW-Authenticate, MCP-Protocol-Version",
      },
    },
  );
}
