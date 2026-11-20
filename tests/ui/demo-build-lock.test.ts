/**
 * A build with JEEVES_DEMO_ENABLED=0 (the production image) must not carry the
 * persona roster or the fictional company in client code. The bundle itself is
 * checked by scripts/check-demo-free-bundle.cjs after a real build; these cases
 * pin the module-level switches that make the bundler able to drop the data,
 * and that a demo-capable build is unchanged.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const { forbiddenStrings } = createRequire(import.meta.url)("../../scripts/check-demo-free-bundle.cjs") as {
  forbiddenStrings: (source: string) => string[];
};
const FORBIDDEN = forbiddenStrings(readFileSync("lib/demo/personas.ts", "utf8"));
const leaks = (value: unknown) => FORBIDDEN.filter((needle) => JSON.stringify(value).includes(needle));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function load(locked: boolean) {
  vi.resetModules();
  vi.stubEnv("JEEVES_DEMO_ENABLED", locked ? "0" : undefined);
  const personas = await import("@/lib/client/personas");
  const copy = await import("@/lib/client/demo-copy");
  const role = await import("@/components/jeeves/role-context");
  const banner = await import("@/lib/demo-banner");
  return { personas, copy, role, banner };
}

describe("demo-disabled build", () => {
  it("carries no persona or company string in the client modules' data", async () => {
    const { personas, copy, role, banner } = await load(true);
    expect(leaks({ p: personas.LIVE_PERSONAS, d: personas.REVIEWER_DOMAIN, k: personas.DEMO_ENTRY_PERSONA_KEY, c: copy, r: role.ROLE_PERSONAS, b: banner.DEMO_BANNER_TEXT })).toEqual([]);
  });

  it("still gives the console a role for each role key, so the layout renders", async () => {
    const { personas } = await load(true);
    expect(personas.LIVE_PERSONAS.map((p) => p.role).sort()).toEqual(["admin", "approver", "program", "requester", "reviewer"]);
    expect(personas.findPersona(personas.DEFAULT_PERSONA_KEY)?.role).toBe("program");
  });
});

describe("demo-capable build", () => {
  it("keeps the 13 personas, the demo entry persona and the company name", async () => {
    const { personas, copy } = await load(false);
    expect(personas.LIVE_PERSONAS).toHaveLength(13);
    expect(personas.DEMO_ENTRY_PERSONA_KEY).toBe("priya-raman");
    expect(personas.DEFAULT_PERSONA_KEY).toBe("nia-okafor");
    expect(copy.DEMO_COMPANY).toBe("Meridian Health");
  });
});
