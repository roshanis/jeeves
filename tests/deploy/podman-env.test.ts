// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { reviewInvocationLimits, type AgentRuntimeConfig } from "@/lib/agents/runtime";

const read = (...p: string[]) => readFileSync(path.join(process.cwd(), ...p), "utf-8");
const compose = read("deploy", "podman", "compose.yaml");
const envExample = read("deploy", "podman", "env.example");
const guide = read("docs", "deploy-podman.md");

describe("Podman stack configuration", () => {
  it("does not describe or require a demo passcode", () => {
    expect(envExample).not.toContain("Gates the live");
    expect(envExample).not.toMatch(/^DEMO_PASSCODE=/m);
    expect(compose).not.toContain("${DEMO_PASSCODE:?");
    expect(guide).not.toMatch(/shared passcode/i);
    expect(guide).not.toContain("and DEMO_PASSCODE");
  });

  it("requires JEEVES_COOKIE_SECRET, the workspace-cookie signing key", () => {
    expect(compose).toContain("JEEVES_COOKIE_SECRET: ${JEEVES_COOKIE_SECRET:?");
    expect(envExample).toMatch(/^JEEVES_COOKIE_SECRET=/m);
    expect(envExample).toContain("openssl rand -hex 32");
  });
  it("migrates before the app starts", () => {
    // This line pins the volume name on both install paths: tests/deploy/podman-volume-names.test.ts.
    const quick = guide.slice(guide.indexOf("## 1. Quick start"), guide.indexOf("## 2."));
    expect(quick.indexOf("run --rm migrate")).toBeGreaterThan(-1);
    expect(quick.indexOf("run --rm migrate")).toBeLessThan(quick.indexOf("up -d"));
  });

  it("gives Quadlet operators a DATABASE_URL in jeeves.env", () => {
    // On this line env.example carries the line; the operator sets the same password in it.
    const quadlet = guide.slice(guide.indexOf("## 3."), guide.indexOf("## 4."));
    expect(envExample).toMatch(/^DATABASE_URL=postgres:\/\/jeeves_app:[^@\s]+@jeeves-db:5432\/jeeves$/m);
    expect(quadlet).toContain("jeeves_app password (JEEVES_APP_PASSWORD) into DATABASE_URL");
  });

  it("lets a production-mode install reach the stack's own database without TLS", () => {
    // Production refuses a database on another host without verified TLS
    // (lib/config/deployment-mode.ts). The db / jeeves-db container is on this
    // host's private network without TLS, so both install paths carry the
    // same-host opt-out the guide promises, beside the URL it vouches for.
    const app = compose.slice(compose.search(/^ {2}app:\s*$/m), compose.search(/^ {2}migrate:\s*$/m));
    expect(app).toMatch(/^\s+DATABASE_URL: postgres:\/\/[^\n]*@db:5432\/[^\n]*\n(?:\s+#[^\n]*\n)*\s+JEEVES_DB_ALLOW_UNVERIFIED: same-host\s*$/m);
    expect(envExample).toMatch(/^DATABASE_URL=[^\n]*@jeeves-db:5432\/jeeves\n(?:#[^\n]*\n)*JEEVES_DB_ALLOW_UNVERIFIED=same-host$/m);
    expect(read("deploy", "podman", "quadlet", "jeeves-app.container")).toMatch(/^#[^\n]*JEEVES_DB_ALLOW_UNVERIFIED/m);
    expect(guide).toContain("`JEEVES_DB_ALLOW_UNVERIFIED=same-host`");
  });

  describe("two database roles (decision d05)", () => {
    const section = (name: string, next: string) => compose.slice(compose.search(new RegExp(`^ {2}${name}:\\s*$`, "m")), compose.search(new RegExp(`^ {2}${next}:\\s*$`, "m")));
    const urlUser = (text: string, variable: string) => new RegExp(`${variable}: postgres://([^:\\s]+):`).exec(text)?.[1];
    const db = section("db", "app");
    const app = section("app", "migrate");
    const migrate = section("migrate", "seed");
    const seed = section("seed", "grants");
    const initScript = read("deploy", "podman", "initdb", "10-jeeves-roles.sh");

    it("runs the app as jeeves_app: not the bootstrap superuser, not the owner", () => {
      expect(urlUser(app, "DATABASE_URL")).toBe("jeeves_app");
      expect(app).not.toMatch(/POSTGRES_USER\}:/);
      expect(app).not.toContain("JEEVES_OWNER_PASSWORD");
      expect(app).not.toContain("POSTGRES_PASSWORD");
    });

    it("migrates, seeds and re-grants as the owner or the bootstrap role, never as the app", () => {
      expect(urlUser(migrate, "DATABASE_MIGRATION_URL")).toBe("jeeves_owner");
      expect(urlUser(migrate, "DATABASE_URL")).toBe("jeeves_owner");
      // The seed disables the audit triggers, which only an owner can.
      expect(urlUser(seed, "DATABASE_URL")).toBe("jeeves_owner");
    });

    it("uses the bootstrap superuser only in an init script that creates the two roles", () => {
      expect(db).toContain("/docker-entrypoint-initdb.d/10-jeeves-roles.sh");
      expect(db).toContain("jeeves-runtime-grants.sql");
      expect(db).toContain("JEEVES_OWNER_PASSWORD: ${JEEVES_OWNER_PASSWORD:?");
      expect(db).toContain("JEEVES_APP_PASSWORD: ${JEEVES_APP_PASSWORD:?");
      expect(initScript).toMatch(/CREATE ROLE jeeves_owner LOGIN NOSUPERUSER/);
      expect(initScript).toMatch(/CREATE ROLE jeeves_app LOGIN NOSUPERUSER/);
      expect(initScript).toContain("jeeves-runtime-grants.sql");
      expect(initScript).toContain("ON_ERROR_STOP=1");
      // Passwords go in as psql variables, never spliced into the SQL text.
      expect(initScript).toContain(":'owner_pw'");
      expect(initScript).toContain(":'app_pw'");
    });

    it("keeps the same-host opt-out on the app service", () => {
      expect(app).toContain("JEEVES_DB_ALLOW_UNVERIFIED: same-host");
    });

    it("mounts a grants file that exists, and the Quadlet db unit reads its own env file", () => {
      expect(read("deploy", "sql", "jeeves-runtime-grants.sql")).toContain("ALTER DEFAULT PRIVILEGES FOR ROLE jeeves_owner");
      const dbUnit = read("deploy", "podman", "quadlet", "jeeves-db.container");
      expect(dbUnit).toContain("EnvironmentFile=%h/.config/containers/systemd/jeeves-db.env");
      expect(dbUnit).toContain("/docker-entrypoint-initdb.d/10-jeeves-roles.sh");
      expect(read("deploy", "podman", "quadlet", "jeeves-app.container")).not.toContain("jeeves-db.env");
    });

    it("tells operators how an existing volume gets the roles", () => {
      expect(guide).toMatch(/existing volume/i);
      expect(guide).toContain("run --rm grants");
    });
  });

  it("documents a stop timeout that outlasts the longest draft run", () => {
    const longestRunSeconds = reviewInvocationLimits({ deepReviewEnabled: true } as AgentRuntimeConfig).timeoutMs / 1000;
    const composeStop = Number(/podman compose stop -t (\d+)/.exec(guide)?.[1]);
    const quadletStop = Number(/StopTimeout=(\d+)/.exec(guide)?.[1]);
    expect(composeStop).toBeGreaterThan(longestRunSeconds);
    expect(quadletStop).toBeGreaterThan(longestRunSeconds);
  });
});
