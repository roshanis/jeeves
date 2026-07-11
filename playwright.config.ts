import { defineConfig, devices } from "@playwright/test";

// webServer runs `npm run dev` rather than `npm run build && npm run start`.
// Tradeoff: dev mode is slower per-request (on-demand compilation) but far
// faster to boot, and matches how engineers will run this locally while
// iterating. Once this suite runs in CI, consider switching to a production
// build (`next build && next start`) for a representative, faster-per-request
// run — tracked as a follow-up, not required for this self-contained suite.
//
// Fixed port 3117 (not the Next.js default 3000): this machine routinely runs
// other, unrelated dev servers on ports ~3000-3010, and this suite must not
// collide with them or need to kill/reuse a process it didn't start.
const PORT = 3117;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { PORT: String(PORT) },
  },
});
