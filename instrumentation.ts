// Next.js instrumentation hook: register() runs once when a server instance
// starts. It is where production refuses to boot with an invalid
// configuration (lib/config/boot-checks.ts).
//
// Two situations must NOT run the checks:
//  - `next build` (NEXT_PHASE === "phase-production-build"). The Containerfile,
//    Vercel and the e2e build all build with DATA_PROVIDER=mock and no
//    database, and the builder has no JEEVES_MODE, which now means production.
//    A config check there would fail every build.
//  - the edge runtime, which has no Node APIs; the checks run on "nodejs" only.
//
// The checks live in a dynamically imported module so this file stays
// edge-safe: Next compiles it for both runtimes and drops the guarded import
// from the edge bundle.
import type { BootCheckDeps } from "./lib/config/boot-checks";

/**
 * `deps` exists for tests (an injectable exit and logger); Next.js calls
 * register() with no arguments.
 */
export async function register(deps?: BootCheckDeps): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { runBootChecks } = await import("./lib/config/boot-checks");
  await runBootChecks(deps);
}
