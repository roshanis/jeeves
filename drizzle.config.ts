import { defineConfig } from "drizzle-kit";
import { runtimeDatabaseUrl } from "./lib/db/runtime-config";

// A database URL (DATABASE_URL, or POSTGRES_URL from Vercel's integration; the
// same resolution as the runtime and scripts/migrate.ts) is required at drizzle-kit invocation time (migrations
// generation/push), not at Next.js build/runtime — see .env.example and
// plan.md §4 (Neon Postgres + Drizzle). Fail fast with a clear message
// rather than letting drizzle-kit produce an opaque error.
const databaseUrl = runtimeDatabaseUrl();
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL (or POSTGRES_URL) is not set. Copy .env.example to .env.local and set a PostgreSQL connection string before running drizzle-kit commands.",
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: databaseUrl,
  },
});
