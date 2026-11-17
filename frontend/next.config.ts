import type { NextConfig } from "next";

// Baseline browser hardening on every route. No CSP yet: the app loads
// Google Fonts and runs inline styles from some components, so a strict
// policy needs its own pass rather than a guess here.
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  // 127.0.0.1 isn't automatically trusted alongside localhost -- without
  // this, the dev server silently blocks HMR/dev-runtime requests from it,
  // React never hydrates, and every form falls back to a native (GET,
  // credentials-in-the-URL) submit with no visible error.
  allowedDevOrigins: ["127.0.0.1"],
  poweredByHeader: false,
  // Self-contained server bundle for the production Docker image
  // (Dockerfile.prod runs `node server.js` from .next/standalone).
  output: "standalone",
  // The production Docker build sets NEXT_SKIP_TYPECHECK=1 so small servers
  // don't run out of memory; type errors are caught by frontend CI instead.
  typescript: { ignoreBuildErrors: process.env.NEXT_SKIP_TYPECHECK === "1" },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
