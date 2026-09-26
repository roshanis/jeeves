import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { E2E_COOKIE_SECRET } from "./tests/e2e/constants";

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
// - `npm run db:seed` migrates + deterministically seeds a newly-created,
//   disposable OS-temp PGlite directory
//   (scripts/seed.ts wipes + reinserts), so every run starts from the same
//   12 seeded initiatives.
// - `DATA_PROVIDER=mock npm run build` keeps prerendering isolated from the
//   mutable database. `npm run start` then receives DATA_PROVIDER=db through
//   webServer.env, so dynamic case-file pages and API handlers share the
//   seeded PGlite store used by the live workflow.
//
// Fixed port 3117 (not the Next.js default 3000): this machine routinely runs
// other, unrelated dev servers on ports ~3000-3010, and this suite must not
// collide with them or need to kill/reuse a process it didn't start.
//
// Live-demo loop support:
// - an independent test-only cookie secret preserves visitor workspaces;
//   the visitor flow never supplies a password.
// - OPENAI_API_KEY and both database URL aliases are blanked so ambient env
//   files cannot switch the suite to an external provider or database.
//   lib/agents getAgentPort() therefore selects the
//   deterministic offline mock adapter for draft runs (its documented
//   default).
//
// fullyParallel is OFF: the live-loop test mutates the shared server
// database (creates a 13th initiative), and the read-only tests assert
// exact seeded counts. Serial in-file order keeps the mutating test last,
// deterministically.
const PORT = 3117;
const disposablePgliteDir = mkdtempSync(join(tmpdir(), "jeeves-playwright-"));

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
    command: "npm run db:seed && DATA_PROVIDER=mock npm run build -- --webpack && npm run start",
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 240_000,
    env: {
      PORT: String(PORT),
      DATABASE_URL: "",
      POSTGRES_URL: "",
      DATABASE_MIGRATION_URL: "",
      VERCEL: "",
      OPENAI_API_KEY: "",
      DEMO_PASSCODE: "",
      JEEVES_COOKIE_SECRET: E2E_COOKIE_SECRET,
      JEEVES_PGLITE_DIR: disposablePgliteDir,
      DATA_PROVIDER: "db",
    },
  },
});
