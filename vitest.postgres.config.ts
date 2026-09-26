import path from "node:path";
import { defineConfig } from "vitest/config";

// Deliberately separate from npm test: this opt-in suite requires a freshly
// initialized, task-owned local Postgres cluster, never DATABASE_URL.
if (!process.env.JEEVES_REVIEW_TEST_PG_SOCKET) {
  throw new Error("Postgres integrity tests require an explicit disposable JEEVES_REVIEW_TEST_PG_SOCKET");
}

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
  test: {
    environment: "node",
    include: ["tests/postgres/review-integrity.test.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
