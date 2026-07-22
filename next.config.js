/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Agent SDK spawns the bundled Claude Code binary as a subprocess; keep it
  // external so Next's bundler doesn't try to trace/inline the native package.
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk"],
};

module.exports = nextConfig;
