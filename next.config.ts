import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // These pull in native binaries / optional deps that Turbopack cannot bundle
  // for the Edge/ESM graph; keep them as real require()s at runtime instead.
  serverExternalPackages: ['@lancedb/lancedb', 'unzipper'],
};

export default nextConfig;
