import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships WASM/data assets that break when bundled by
  // Turbopack/webpack (its internal file loading receives a bundler URL
  // where Node expects a filesystem path: "The 'path' argument must be of
  // type string ... Received an instance of URL"). Loading it as a native
  // Node package from node_modules — the fix PGlite's own docs recommend
  // for Next.js — keeps `getDb()`'s local .pglite store working under
  // `next dev`/`next start`, which the live-demo mode (mutating /api/**
  // routes) and the DATA_PROVIDER=db read path both depend on when no
  // DATABASE_URL is set.
  serverExternalPackages: ["@electric-sql/pglite"],

  // Baseline security response headers, applied to every route. This is a
  // deliberately conservative set: no Content-Security-Policy here. A
  // strict CSP is the right long-term follow-up but risks breaking
  // Recharts and Next's own inline styles/scripts in this demo without a
  // careful nonce/hash rollout — tracked as a documented follow-up rather
  // than shipped half-configured.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Disallow framing entirely — this app has no embed use case.
          { key: "X-Frame-Options", value: "DENY" },
          // Stop browsers from MIME-sniffing responses away from the
          // declared Content-Type.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Send full origin on same-origin/HTTPS-downgrade-safe
          // navigations, but only the origin (no path) cross-origin.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Force HTTPS for 2 years, including subdomains, and allow
          // preload-list submission.
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          // Deny access to sensor/location APIs this app never uses.
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          // Disable speculative DNS prefetching of linked origins.
          { key: "X-DNS-Prefetch-Control", value: "off" },
        ],
      },
    ];
  },
};

export default nextConfig;
