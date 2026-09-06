import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A verification build must never write into the folder a running dev server is reading.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // Next rewrites AGENTS.md and CLAUDE.md on every dev start. This repo keeps its own,
  // and the generated copy carries punctuation the house style bans.
  agentRules: false,
};

export default nextConfig;
