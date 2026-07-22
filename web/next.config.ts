import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-hosted in Docker: emit a minimal standalone server bundle.
  output: "standalone",

  // OAuth discovery documents must live under /.well-known, but Next's file
  // router ignores dot-prefixed directories, so the handlers live under
  // /api/mcp/well-known/* and are surfaced here.
  //
  // Both the bare and the /mcp-suffixed paths are served: RFC 9728 lets a client
  // insert the resource path into the well-known URI, and Claude and ChatGPT
  // probe different variants. openid-configuration is included because some
  // hosts try OIDC discovery before falling back to RFC 8414.
  async rewrites() {
    return [
      { source: "/.well-known/oauth-protected-resource", destination: "/api/mcp/well-known/protected-resource" },
      { source: "/.well-known/oauth-protected-resource/mcp", destination: "/api/mcp/well-known/protected-resource" },
      { source: "/.well-known/oauth-authorization-server", destination: "/api/mcp/well-known/authorization-server" },
      { source: "/.well-known/oauth-authorization-server/mcp", destination: "/api/mcp/well-known/authorization-server" },
      { source: "/.well-known/openid-configuration", destination: "/api/mcp/well-known/authorization-server" },
      { source: "/.well-known/openid-configuration/mcp", destination: "/api/mcp/well-known/authorization-server" },
    ];
  },
};

export default nextConfig;
