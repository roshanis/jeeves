import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ config: undefined as unknown, end: vi.fn(), migrated: vi.fn() }));
vi.mock("pg", () => ({ Pool: class {
  constructor(config: unknown) { state.config = config; }
  on() { return this; }
  end = state.end;
} }));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: vi.fn(() => ({ mocked: true })) }));
vi.mock("drizzle-orm/node-postgres/migrator", () => ({ migrate: state.migrated }));

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

  it("rejects transaction pooling before opening a migration pool", async () => {
    process.env.POSTGRES_URL = "postgresql://u:p@aws-0-example.pooler.supabase.com:6543/postgres";
    delete process.env.DATABASE_MIGRATION_URL;

    await expect(runMigrations()).rejects.toThrow(/DATABASE_MIGRATION_URL/);
    expect(state.config).toBeUndefined();
  });
});
