import { defineConfig, devices } from "@playwright/test";

// webServer runs `npm run dev` rather than `npm run build && npm run start`.
// Tradeoff: dev mode is slower per-request (on-demand compilation) but far
// faster to boot for a still-placeholder golden-path suite, and matches how
// engineers will run this locally while iterating on plan.md §2 storyline
// steps 1->6. Once the golden path is implemented and this suite runs in CI,
// switch to a production build (`next build && next start`) for a
// representative, faster-per-request run — tracked as a follow-up, not done
// here since the test itself is still `test.skip`.
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
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
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
