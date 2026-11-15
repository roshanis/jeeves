// @vitest-environment node
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");

describe("README claims about .env.example (docs-F13)", () => {
  it("does not call .env.example the full variable list", () => {
    expect(read("README.md")).not.toMatch(/full variable list/i);
  });
  it("only names extra env vars that the code reads", () => {
    const line = read("README.md").split("\n").find((l) => /not an exhaustive list/.test(l)) ?? "";
    const names = [...line.matchAll(/`([A-Z][A-Z0-9_]{3,})`/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      let hits = "";
      try {
        hits = execFileSync("git", ["grep", "-l", "-w", name, "--", "app", "lib", "scripts", ".env.example"], { encoding: "utf8" });
      } catch {
        hits = "";
      }
      expect(hits, `${name} is not referenced by the code`).not.toBe("");
    }
  });
});

describe("docs/production-readiness.md (docs-F16)", () => {
  const doc = read("docs/production-readiness.md");
  it("mentions the passcode only to say it is gone", () => {
    const stale = doc.split("\n").filter((l) => /passcode/i.test(l) && !/no passcode|former|retired|removed/i.test(l));
    expect(stale).toEqual([]);
  });
  it("hard-codes no test or migration counts", () => {
    expect(doc).not.toMatch(/\b\d+ (unit tests|migrations)\b/);
  });
  it("does not point at a public/ directory that does not exist", () => {
    expect(doc).not.toMatch(/`public\/` still holds/);
  });
});

describe("docs/ARCHITECTURE.md (docs-F17)", () => {
  const doc = read("docs/ARCHITECTURE.md");
  it("cites only lib/ and app/ paths that exist", () => {
    const paths = [...doc.matchAll(/`((?:lib|app)\/[A-Za-z0-9_./\[\]()@-]+?)`/g)].map((m) => m[1]).filter((p) => !p.includes("*"));
    const missing = [...new Set(paths)].filter((p) => !existsSync(p.replace(/\/$/, "")));
    expect(missing).toEqual([]);
  });
  it("does not say rate limiting is in-memory or per-instance", () => {
    expect(doc).not.toMatch(/rate limiting (remains|is) in-memory/i);
  });
  it("does not name symbols that no longer exist", () => {
    expect(doc).not.toMatch(/runWithConcurrencyLimit|draftWithRetry|DEMO_PASSCODE/);
  });
  it("counts thirteen lifecycle states, not twelve", () => {
    expect(doc).not.toMatch(/twelve[- ]state/i);
  });
});

describe("the QC gate is documented (docs-F18)", () => {
  it("demo-script.md has a QC step run by the Program Office persona", () => {
    const doc = read("docs/demo-script.md");
    expect(doc).toMatch(/QC/);
    expect(doc).toMatch(/Nia Okafor/);
  });
  it("README.md describes QC between intake and triage", () => {
    expect(read("README.md")).toMatch(/\bQC\b/);
  });
  it("deploy.md champion loop includes QC and drafts 8 reviews", () => {
    const doc = read("docs/deploy.md");
    expect(doc).toMatch(/\bQC\b/);
    expect(doc).not.toMatch(/4 drafted reviews/);
  });
  it("ARCHITECTURE.md describes the QC gate", () => {
    expect(read("docs/ARCHITECTURE.md")).toMatch(/QC gate/);
  });
});

describe("audit-log protection claims match the migrations (docs-F21)", () => {
  const migrations = readdirSync("drizzle").filter((f) => f.endsWith(".sql")).map((f) => read(`drizzle/${f}`)).join("\n");
  it("README does not claim revoked privileges unless a migration revokes them", () => {
    if (!/^\s*REVOKE\s/im.test(migrations)) expect(read("README.md")).not.toMatch(/revoked privileges/i);
  });
  it("production-readiness lists the owner/runtime role split as a prerequisite", () => {
    const doc = read("docs/production-readiness.md");
    expect(doc).toMatch(/runtime role/i);
    expect(doc).not.toMatch(/regardless of which role issues the\s+statement/);
  });
});

describe("data disclaimers cover the real-request door (docs-F23)", () => {
  it("README does not claim no real PII anywhere", () => {
    expect(read("README.md")).not.toMatch(/No real PHI, PII, or production data is used/);
  });
  it("deploy.md does not claim all data is synthetic and names the contact data", () => {
    const doc = read("docs/deploy.md");
    expect(doc).not.toMatch(/all data is synthetic/);
    expect(doc).not.toMatch(/everything is synthetic, so it is\s+moot/);
    expect(doc).toMatch(/real-request door/i);
  });
  it("ARCHITECTURE.md qualifies the no-real-data claim", () => {
    expect(read("docs/ARCHITECTURE.md")).not.toMatch(/no real PHI,\s+PII, or production data exists anywhere/);
  });
});

describe("docs/deploy.md section 4 backups (docs-F28)", () => {
  const doc = read("docs/deploy.md");
  const section = doc.slice(doc.indexOf("## 4. Backups and restore"), doc.indexOf("## 5. Staging"));
  it("covers RDS and Supabase, not only Neon", () => {
    expect(section).toMatch(/RDS/);
    expect(section).toMatch(/Supabase/);
  });
  it("says to restore into a new database because of the append-only triggers", () => {
    expect(section).toMatch(/new database/);
    expect(section).toMatch(/drops and recreates every\s+table/);
    // TRUNCATE is named exactly when a migration guards it: the production-mode line's 0014 does.
    const migrations = readdirSync("drizzle").filter((f) => f.endsWith(".sql")).map((f) => read(`drizzle/${f}`)).join("\n");
    if (/BEFORE\s+TRUNCATE/i.test(migrations)) expect(section).toMatch(/rejects `UPDATE`, `DELETE` and[\s\S]{0,40}`TRUNCATE`/);
    else expect(section).not.toMatch(/TRUNCATE/);
    expect(section).toMatch(/Restore to a New Project/i);
  });
  it("checks the migration journal and health after a restore", () => {
    expect(section).toMatch(/__drizzle_migrations/);
    expect(section).toMatch(/\/api\/health/);
  });
});

describe("README drift (docs-F31)", () => {
  const readme = read("README.md");
  it("hard-codes no Playwright or unit-test counts", () => {
    expect(readme).not.toMatch(/\b8 Playwright/);
    expect(readme).not.toMatch(/several hundred/i);
  });
  it("lists Agents in the left-nav sentence", () => {
    const i = readme.indexOf("a left-nav ops shell");
    expect(readme.slice(i, i + 250)).toMatch(/Agents/);
  });
  it("says node-postgres serves non-Neon hosts, not neon-serverless 'in production'", () => {
    expect(readme).not.toMatch(/neon-serverless`? driver in\s+production/);
    expect(readme).toMatch(/node-postgres/);
  });
  it("names Node 22 instead of pointing at a package.json range that does not exist", () => {
    expect(readme).not.toMatch(/see `package\.json`\/`next` 16/);
    expect(readme).toMatch(/Node\.js 22/);
  });
  it("does not give Luna completeness checks or triage narration", () => {
    expect(readme).not.toMatch(/triage narration/);
    // Luna's duties are the text up to the first em dash; the model id holds dots, so a [^.] span never reached it.
    const lunaDuties = /\*\*Luna\*\*[^—]*/.exec(readme)?.[0] ?? "";
    expect(lunaDuties).toContain("intake turns");
    expect(lunaDuties).not.toContain("completeness");
  });
  it(".env.example gives Luna the same two calls as the agents-sdk adapter", () => {
    // lib/agents/openai-agents-adapter.ts: intakeInterview and auditorAnswer use Luna; nothing else does.
    const text = read(".env.example").replace(/\n#\s*/g, " ");
    const comment = /Luna handles[^;]*;/.exec(text)?.[0] ?? "";
    expect(comment).toMatch(/intake turns/);
    expect(comment).toMatch(/audit answers/);
    expect(comment).not.toMatch(/completeness|triage/);
  });
  it("lists the lib directories and scripts that exist", () => {
    for (const p of ["  demo/ ", "  evidence/ ", "  reviews/ ", "  telemetry/ ", "  deployments/ ", "  format/ ", "  http/ ", "  marketing/ ", "\nagents/ ", "\ndeploy/ ", "migrate.ts", "reset-demo.ts"]) {
      expect(readme, p).toContain(p);
    }
  });
  it("ends with the License section", () => {
    expect(readme.trimEnd().endsWith("each of which carries its own terms.")).toBe(true);
  });
});

describe("docs/deploy-podman.md image healthcheck (deploy-F16)", () => {
  it("says an OCI-format build drops the image HEALTHCHECK and names --format docker", () => {
    const doc = read("docs/deploy-podman.md");
    expect(doc).toMatch(/--format docker/);
    expect(doc).toMatch(/HEALTHCHECK/);
  });
});

describe("docs/intake-spec.md REQUIRED-FOR-TIER gate (d01)", () => {
  const spec = read("docs/intake-spec.md");
  it("no longer describes the old review-creation or draft-state behaviour", () => {
    expect(spec).not.toMatch(/prevents `ReviewCycle` creation/);
    expect(spec).not.toMatch(/blocking `ReviewCycle` creation/);
    expect(spec).not.toMatch(/keeps the initiative in `intake-draft` state/);
  });
  it("says a failing rule blocks passing QC, with the typed code", () => {
    expect(spec).toMatch(/INTAKE_TIER_GAPS/);
    expect(spec).toMatch(/blocks passing QC/);
  });
});
