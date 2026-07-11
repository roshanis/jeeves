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
};

export default nextConfig;
