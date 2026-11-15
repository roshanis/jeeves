// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The backup commands in docs/deploy-podman.md name one volume. Compose
 * prefixes an unpinned volume with the project name (podman_jeeves-pgdata) and
 * the Quadlet unit used to call it jeeves-db, so the documented export failed
 * with "no such volume" on both paths. Both stacks pin the same name.
 */
const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("Postgres volume name is the same on every install path", () => {
  it("compose pins the volume name instead of taking the project prefix", () => {
    expect(read("deploy/podman/compose.yaml")).toMatch(/^volumes:\n {2}jeeves-pgdata:\n(?: {4}#.*\n)* {4}name: jeeves-pgdata\s*$/m);
  });

  it("the Quadlet volume unit uses the same name", () => {
    expect(read("deploy/podman/quadlet/jeeves-db.volume")).toMatch(/^VolumeName=jeeves-pgdata$/m);
  });

  it("the backup docs name that volume and never the old Quadlet name", () => {
    const docs = read("docs/deploy-podman.md");
    expect(docs).toMatch(/podman volume export jeeves-pgdata/);
    expect(docs).toMatch(/podman volume import jeeves-pgdata/);
    expect(read("deploy/podman/quadlet/jeeves-db.volume")).not.toMatch(/export jeeves-db\b/);
  });

  it("the docs give a Quadlet pg_dump and an explicit restore procedure", () => {
    const docs = read("docs/deploy-podman.md");
    expect(docs).toMatch(/podman exec jeeves-db pg_dump/);
    expect(docs).toMatch(/Restore/);
    expect(docs).toMatch(/\/api\/health/);
  });
});
