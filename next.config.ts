import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Conserva las instrucciones propias del proyecto sin bloques generados por `next dev`.
  agentRules: false,
};

export default nextConfig;
