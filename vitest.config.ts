import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Test environment: 'jsdom' rather than 'node'. Even though today's suite
// (smoke + ports type-tripwire tests) is DOM-free, plan.md §8 anticipates
// component-level tests (React Testing Library is already installed) and a
// jsdom environment is required for those. Paying the jsdom cost now avoids
// a config churn later; pure-logic tests run identically under jsdom.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "jsdom",
    include: [
      "tests/**/*.test.ts",
      "tests/**/*.test.tsx",
      "lib/**/*.test.ts",
      "scripts/**/*.test.ts",
      "app/**/*.test.ts",
      "app/**/*.test.tsx",
    ],
    exclude: ["tests/e2e/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["lib/**/*.ts", "lib/**/*.tsx", "scripts/**/*.ts", "app/api/**/*.ts"],
      exclude: ["lib/db/schema.ts"],
      // Baseline measured 2026-07-25 via `pnpm test -- --coverage
      // --no-file-parallelism` (722 tests, 67 files, all passing):
      //   statements 85.74% | branches 75.01% | functions 88.81% | lines 86.96%
      // Thresholds are set a margin below that baseline (plan.md §8 target of
      // 80% applies to lines/statements, which were already >=85%) to catch
      // real regressions while leaving room for another agent's in-flight
      // test additions to land without tripping CI on drift alone.
      thresholds: {
        statements: 80,
        lines: 80,
        functions: 83,
        branches: 70,
      },
    },
  },
});
