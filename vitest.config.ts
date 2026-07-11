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
    ],
    exclude: ["tests/e2e/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["lib/**/*.ts", "lib/**/*.tsx", "scripts/**/*.ts", "app/api/**/*.ts"],
      exclude: ["lib/db/schema.ts"],
      // Thresholds are not enforced yet (plan.md §8 target of >80% on lib/
      // logic applies once real domain logic lands) — coverage is configured
      // and available for CI wiring later.
    },
  },
});
