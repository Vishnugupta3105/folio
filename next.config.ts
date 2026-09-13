import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next 16 runs Turbopack by default. No custom bundler config is needed —
  // pdf.js is loaded dynamically and its worker is served from /public.
  // Pinned so Next never infers a workspace root from a stray parent lockfile.
  turbopack: { root: import.meta.dirname },
  experimental: { serverActions: { bodySizeLimit: "60mb" } },
};

export default nextConfig;
