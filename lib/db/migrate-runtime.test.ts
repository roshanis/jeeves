import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ config: undefined as unknown, end: vi.fn(), migrated: vi.fn(),
  calls: [] as string[], drizzleClient: undefined as unknown, client: undefined as unknown }));
vi.mock("pg", () => ({ Pool: class {
  constructor(config: unknown) { state.config = config; }
  on() { return this; }
  connect = async () => {
    const client = {
      query: async (text: string) => { state.calls.push(text); return { rows: [] }; },
      release: () => { state.calls.push("release"); },
    };
    state.client = client;
    return client;
  };
  end = state.end;
} }));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: vi.fn((opts: { client: unknown }) => ({ mocked: true, client: (state.drizzleClient = opts.client),
  execute: async () => ({ rows: JSON.parse(readFileSync("./drizzle/meta/_journal.json", "utf8")).entries
    .map((e: { when: number }) => ({ created_at: e.when })) }) })) }));
vi.mock("drizzle-orm/node-postgres/migrator", () => ({ migrate: state.migrated }));
vi.mock("@neondatabase/serverless", () => ({
  neonConfig: {},
  Pool: class {
    on() { return this; }
    query = async (text: string) => { state.calls.push(`pool:${text}`); return { rows: [] }; };
    connect = async () => {
      const client = {
        query: async (text: string) => { state.calls.push(text); return { rows: [] }; },
        release: () => { state.calls.push("release"); },
      };
      state.client = client;
      return client;
    };
    end = state.end;
  },
}));
vi.mock("drizzle-orm/neon-serverless", () => ({ drizzle: vi.fn((opts: { client: unknown }) => ({ mocked: true, client: (state.drizzleClient = opts.client),
  execute: async () => ({ rows: JSON.parse(readFileSync("./drizzle/meta/_journal.json", "utf8")).entries
    .map((e: { when: number }) => ({ created_at: e.when })) }) })) }));
vi.mock("drizzle-orm/neon-serverless/migrator", () => ({ migrate: state.migrated }));

import { runMigrations } from "./migrate";

const envKeys = ["DATABASE_URL", "POSTGRES_URL", "DATABASE_MIGRATION_URL", "DATABASE_SSL_CA", "JEEVES_DB_DRIVER"] as const;
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of envKeys) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  state.config = undefined;
  state.end.mockReset();
  state.migrated.mockReset();
  state.calls = [];
  state.drizzleClient = undefined;
  state.client = undefined;
});

describe("runMigrations", () => {
  it("uses the dedicated direct URL, applies with node-postgres, and closes its pool", async () => {
    process.env.POSTGRES_URL = "postgresql://u:p@aws-0-example.pooler.supabase.com:6543/postgres";
    process.env.DATABASE_MIGRATION_URL = "postgresql://u:p@db.example.supabase.co:5432/postgres";

    await runMigrations();

    expect(state.config).toMatchObject({ max: 1, connectionString: process.env.DATABASE_MIGRATION_URL,
      ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 10_000 });
    expect(state.migrated).toHaveBeenCalledTimes(1);
    expect(state.end).toHaveBeenCalledTimes(1);
  });

  it("holds an advisory lock on the one client drizzle migrates through, and unlocks it", async () => {
    process.env.DATABASE_MIGRATION_URL = "postgresql://u:p@db.example.supabase.co:5432/postgres";
    state.migrated.mockImplementation(async () => { state.calls.push("migrate"); });

    await runMigrations();

    expect(state.calls).toEqual([expect.stringMatching(/pg_advisory_lock/), "migrate", expect.stringMatching(/pg_advisory_unlock/), "release"]);
    expect(state.drizzleClient).toBe(state.client);
  });

  it("unlocks and releases even when the migration throws", async () => {
    process.env.DATABASE_MIGRATION_URL = "postgresql://u:p@db.example.supabase.co:5432/postgres";
    state.migrated.mockRejectedValue(new Error("boom"));

    await expect(runMigrations()).rejects.toThrow("boom");

    expect(state.calls).toEqual([expect.stringMatching(/pg_advisory_lock/), expect.stringMatching(/pg_advisory_unlock/), "release"]);
    expect(state.end).toHaveBeenCalledTimes(1);
  });

  it("rejects transaction pooling before opening a migration pool", async () => {
    process.env.POSTGRES_URL = "postgresql://u:p@aws-0-example.pooler.supabase.com:6543/postgres";
    delete process.env.DATABASE_MIGRATION_URL;

    await expect(runMigrations()).rejects.toThrow(/DATABASE_MIGRATION_URL/);
    expect(state.config).toBeUndefined();
  });

  it("locks, migrates, unlocks and releases on one client for a direct Neon URL", async () => {
    process.env.DATABASE_URL = "postgresql://u:p@ep-cool-123.eu-central-1.aws.neon.tech/neondb";
    delete process.env.DATABASE_MIGRATION_URL;
    state.migrated.mockImplementation(async () => { state.calls.push("migrate"); });

    await runMigrations();

    expect(state.calls).toEqual([expect.stringMatching(/pg_advisory_lock/), "migrate", expect.stringMatching(/pg_advisory_unlock/), "release"]);
    expect(state.drizzleClient).toBe(state.client);
    expect(state.end).toHaveBeenCalledTimes(1);
  });

  it("takes no advisory lock through a Neon pooled (-pooler) endpoint", async () => {
    process.env.DATABASE_URL = "postgresql://u:p@ep-cool-123-pooler.eu-central-1.aws.neon.tech/neondb";
    delete process.env.DATABASE_MIGRATION_URL;
    state.migrated.mockImplementation(async () => { state.calls.push("migrate"); });

    await runMigrations();

    expect(state.calls).toEqual(["migrate"]);
    expect(state.calls.join()).not.toMatch(/advisory/);
    expect(state.end).toHaveBeenCalledTimes(1);
  });
  it("recognises a pooled host written with a percent-encoded dash or upper case", async () => {
    process.env.DATABASE_URL = "postgresql://u:p@EP-COOL-123%2Dpooler.eu-central-1.aws.neon.tech/neondb";
    delete process.env.DATABASE_MIGRATION_URL;
    state.migrated.mockImplementation(async () => { state.calls.push("migrate"); });

    await runMigrations();

    expect(state.calls).toEqual(["migrate"]);
  });
});
