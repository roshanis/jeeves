// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The Quadlet app unit takes its whole environment from jeeves.env, a copy of
 * deploy/podman/env.example. Compose assembles DATABASE_URL itself; Quadlet
 * cannot, so the template must carry it, and the doc steps must seed the data.
 */
const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("Quadlet install: jeeves.env template and steps", () => {
  const env = read("deploy/podman/env.example");
  const unit = read("deploy/podman/quadlet/jeeves-app.container");
  const docs = read("docs/deploy-podman.md");

  it("env.example defines every variable the app unit says jeeves.env must define", () => {
    const comment = /jeeves\.env[^\n]*\n(?:#[^\n]*\n)*/.exec(unit)![0];
    const required = ["DATABASE_URL", "JEEVES_COOKIE_SECRET"].filter((v) => comment.includes(v));
    expect(required).toContain("DATABASE_URL");
    for (const name of required) expect(env, name).toMatch(new RegExp(`^#?\\s*${name}=`, "m"));
    expect(env).toMatch(/^DATABASE_URL=postgres:\/\/jeeves_app:[^@\s]+@jeeves-db:5432\/jeeves$/m);
  });

  it("env.example no longer describes DEMO_PASSCODE as an access gate", () => {
    expect(env).not.toMatch(/Gates the live/);
  });

  it("the Quadlet steps seed the fresh database with the migrator image", () => {
    const section = docs.slice(docs.indexOf("## 3. systemd (Quadlet)"), docs.indexOf("## 4."));
    expect(section).toMatch(/DATABASE_URL/);
    expect(section).toMatch(/localhost\/jeeves-migrator:latest npm run db:seed/);
    expect(section).toMatch(/fresh database/i);
  });
});
