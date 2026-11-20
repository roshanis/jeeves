import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Component suites use jsdom by default. Verified DOM-free suites opt into
// Node with a per-file environment directive; DB file parallelism remains
// disabled below because separate PGlite instances still contend.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "jsdom",
    // Mutation suites inject disposable PGlite databases and must explicitly
    // opt into DB-backed reads. Preview tests override this via vi.stubEnv.
    // JEEVES_MODE defaults to production when unset (lib/config/deployment-mode.ts),
    // so the suite, which exercises the demo, must say "demo" explicitly.
    env: { DATA_PROVIDER: "db", JEEVES_MODE: "demo" },
    // Node >= 25 ships a non-functional `localStorage` global that blocks
    // jsdom's implementation — see tests/setup/web-storage.ts.
    setupFiles: ["tests/setup/web-storage.ts"],
    // Run test FILES sequentially. Most suites spin up their own in-memory
    // PGlite database in beforeEach; running many files at once puts dozens
    // of WASM Postgres instances on the same cores, and the setup hooks
    // start timing out — the suite has repeatedly shown 1-4 spurious
    // `beforeEach` failures under default parallelism while every affected
    // file passes in isolation. That made `npm test` unreliable by default
    // and left `--no-file-parallelism` as tribal knowledge in the build log.
    // Encode it here so a plain `npm test` (and CI) is deterministic.
    fileParallelism: false,
    // PGlite's first-run WASM boot is slow on a cold/loaded machine; the
    // 10s default hook timeout is the thing that actually trips. Tests
    // themselves keep the default timeout.
    hookTimeout: 30_000,
    include: [
      "tests/**/*.test.ts",
      "tests/**/*.test.tsx",
      "lib/**/*.test.ts",
      "scripts/**/*.test.ts",
      "app/**/*.test.ts",
      "app/**/*.test.tsx",
    ],
    exclude: ["tests/postgres/**", "tests/e2e/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: [
        "lib/**/*.ts",
        "lib/**/*.tsx",
        "scripts/**/*.ts",
        "app/api/**/*.ts",
        // The production redirect/404 gate, boot-check wiring and the
        // viewer-scoped data provider: security-relevant, so counted.
        "proxy.ts",
        "instrumentation.ts",
        "app/_lib/**/*.ts",
      ],
      exclude: ["lib/db/schema.ts"],
      // Baseline measured 2026-11-20 with proxy.ts, instrumentation.ts and
      // app/_lib counted (282 test files, 3402 tests, 6843 statements):
      //   statements 90.19% | branches 84.63% | functions 92.40% | lines 92.43%
      // The thresholds below date from the 2026-07-25 baseline (67 files:
      // 85.74 / 75.01 / 88.81 / 86.96) and were deliberately not raised or
      // lowered; plan.md §8's 80% target applies to lines/statements. They stay
      // a margin below the baseline so another agent's in-flight test additions
      // can land without tripping CI on drift alone.
      thresholds: {
        statements: 80,
        lines: 80,
        functions: 83,
        branches: 70,
      },
    },
  },
});
