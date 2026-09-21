// @vitest-environment node
import { describe, expect, it } from "vitest";
import { selectDriver } from "./driver-select";

/**
 * Driver selection.
 *
 * `getDb()` used to pick the Neon serverless driver for ANY `DATABASE_URL`.
 * That driver speaks to Neon's WebSocket proxy, not the Postgres wire
 * protocol, so pointing it at a plain Postgres server fails — verified
 * against a real PostgreSQL 16 with
 * `postgres://postgres:***@127.0.0.1:5432/jeeves`:
 *
 *     DrizzleQueryError: Failed query: select 1 as ok
 *       cause: ErrorEvent - connect ECONNREFUSED 127.0.0.1:443
 *
 * Note the port: it ignored `:5432` and dialled 443. Every container deploy
 * with a `postgres:16` sidecar — the obvious architecture, and the one the
 * Podman files in this repo use — would have hit exactly that, with an error
 * pointing at a port nobody configured.
 *
 * Selection therefore keys off the host, so Vercel + Neon keeps the driver it
 * has today and everything else gets node-postgres (which is the better
 * choice in a long-lived container anyway: a real pool, no proxy hop).
 */
describe("selectDriver", () => {
  it("uses PGlite when no DATABASE_URL is set", () => {
    expect(selectDriver(undefined, undefined)).toBe("pglite");
    expect(selectDriver("", undefined)).toBe("pglite");
  });

  it("uses the Neon serverless driver for Neon hosts", () => {
    expect(
      selectDriver("postgres://u:p@ep-cool-name-123.eu-central-1.aws.neon.tech/jeeves", undefined),
    ).toBe("neon");
    // Pooled endpoints carry a -pooler suffix on the same domain.
    expect(
      selectDriver("postgres://u:p@ep-x-123-pooler.us-east-2.aws.neon.tech/db?sslmode=require", undefined),
    ).toBe("neon");
  });

  it("uses node-postgres for a plain Postgres host — the container case", () => {
    expect(selectDriver("postgres://postgres:test@db:5432/jeeves", undefined)).toBe("pg");
    expect(selectDriver("postgres://postgres:test@127.0.0.1:5432/jeeves", undefined)).toBe("pg");
    expect(selectDriver("postgresql://u:p@my-rds.amazonaws.com:5432/jeeves", undefined)).toBe("pg");
  });

  it("honours an explicit override in both directions", () => {
    expect(selectDriver("postgres://postgres:test@db:5432/jeeves", "neon")).toBe("neon");
    expect(selectDriver("postgres://u:p@ep-x.aws.neon.tech/db", "pg")).toBe("pg");
  });

  it("ignores an unrecognised override rather than guessing", () => {
    expect(selectDriver("postgres://postgres:test@db:5432/jeeves", "banana")).toBe("pg");
  });

  it("still requires a URL even when the driver is forced", () => {
    // Forcing a driver with nothing to connect to must not pretend otherwise.
    expect(selectDriver(undefined, "pg")).toBe("pglite");
    expect(selectDriver(undefined, "neon")).toBe("pglite");
  });

  it("falls back to node-postgres for a URL it cannot parse", () => {
    // Unparseable means "not demonstrably Neon", and node-postgres is the
    // driver that can at least surface a real connection error.
    expect(selectDriver("not-a-url", undefined)).toBe("pg");
  });

  it("does not treat a lookalike host as Neon", () => {
    // Substring matching would make this Neon; it is not.
    expect(selectDriver("postgres://u:p@neon.tech.evil.example.com/db", undefined)).toBe("pg");
    expect(selectDriver("postgres://u:p@myneon.tech/db", undefined)).toBe("pg");
  });
});
