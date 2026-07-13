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

  // The /agents/[id] detail page reads the agent instruction files (the real
  // system prompts) off disk at runtime. Force-include the whole agents/
  // corpus in that route's serverless-function bundle so the reads resolve in
  // a traced/serverless deploy (not just when process.cwd() happens to be the
  // repo root under `next dev`/`next start`).
  outputFileTracingIncludes: {
    "/agents/[id]": ["./agents/**/*.md"],
  },

  // Baseline security response headers, applied to every route. Includes a
  // Content-Security-Policy that pins every fetchable resource to same-origin
  // (blocks external script/style/font/img/connect, framing, object/embed,
  // base-uri hijack, and cross-origin form posts). `script-src`/`style-src`
  // retain 'unsafe-inline' as a documented pragmatic tradeoff: Next's own
  // hydration bootstrap and Recharts inject inline scripts/styles without a
  // nonce, and this demo has no nonce/hash rollout — so a full strict-dynamic
  // CSP remains the follow-up, but this still eliminates the external-injection
  // surface a missing CSP leaves open.
  async headers() {
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "worker-src 'self' blob:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; ");
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
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
