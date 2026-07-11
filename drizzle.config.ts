import { defineConfig } from "drizzle-kit";

// DATABASE_URL is required at drizzle-kit invocation time (migrations
// generation/push), not at Next.js build/runtime — see .env.example and
// plan.md §4 (Neon Postgres + Drizzle). Fail fast with a clear message
// rather than letting drizzle-kit produce an opaque error.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env.local and set a real Neon connection string before running drizzle-kit commands.",
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
