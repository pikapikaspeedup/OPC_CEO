import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // API routes are now local — no rewrites needed
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
