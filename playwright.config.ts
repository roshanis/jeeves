import { defineConfig, devices } from "@playwright/test";

// webServer runs a PRODUCTION server (`db:seed && build && start`), not
// `next dev`. This is load-bearing for the live-demo loop, not just a
// performance preference: under the Turbopack dev server, app pages and
// /api/** route handlers get SEPARATE server module graphs, so the pages'
// PGlite handle (lib/db/client.ts getDb() memoizes per module instance)
// never sees rows the API instance wrote — a live-created initiative 404s
// on its own detail page. `next start` shares one module graph (verified
// empirically: create via API -> detail page 200), so reads and writes are
// coherent.
//
// Env layering inside the command:
// - `npm run db:seed` migrates + deterministically re-seeds ./.pglite
//   (scripts/seed.ts wipes + reinserts), so every run starts from the same
//   12 seeded initiatives.
// - `DATA_PROVIDER=mock npm run build` forces the MOCK provider during
//   prerendering: static pages (/ /audit /controls /reviews) freeze the
//   baseline mock snapshot (exactly what the read-only tests assert), and
//   the 17 parallel prerender workers never open PGlite concurrently.
// - `npm run start` runs with DATA_PROVIDER=db (webServer.env below), so
//   the DYNAMIC routes — /initiatives/[slug] and every /api/** handler —
//   read/write the seeded PGlite store coherently. (Consequence: a
//   live-created initiative renders on its dynamic detail page but does
//   not appear on the statically-frozen home board — acceptable for e2e.)
//
// Fixed port 3117 (not the Next.js default 3000): this machine routinely runs
// other, unrelated dev servers on ports ~3000-3010, and this suite must not
// collide with them or need to kill/reuse a process it didn't start.
//
// Live-demo loop support:
// - DEMO_PASSCODE lets POST /api/session succeed inside the webServer; the
//   live-loop e2e test additionally self-skips unless the RUNNER's own env
//   has DEMO_PASSCODE set (run `DEMO_PASSCODE=e2e-test-pass npm run
//   test:e2e` to include it).
// - No OPENAI_API_KEY is set, so lib/agents getAgentPort() selects the
//   deterministic offline mock adapter for draft runs (its documented
//   default).
//
// fullyParallel is OFF: the live-loop test mutates the shared server
// database (creates a 13th initiative), and the read-only tests assert
// exact seeded counts. Serial in-file order keeps the mutating test last,
// deterministically.
const PORT = 3117;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
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
    command: "npm run db:seed && DATA_PROVIDER=mock npm run build && npm run start",
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 240_000,
    env: {
      PORT: String(PORT),
      DEMO_PASSCODE: "e2e-test-pass",
      DATA_PROVIDER: "db",
    },
  },
});
