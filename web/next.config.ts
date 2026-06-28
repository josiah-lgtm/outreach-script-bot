import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-hosted in Docker: emit a minimal standalone server bundle.
  output: "standalone",
};

export default nextConfig;
