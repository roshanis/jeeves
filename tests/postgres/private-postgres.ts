import { realpath } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import * as schema from "../../lib/db/schema";

/** Connect only to an explicitly named disposable Unix-socket cluster. */
export async function openPrivatePostgres() {
  const socket = process.env.JEEVES_REVIEW_TEST_PG_SOCKET;
  const database = process.env.JEEVES_REVIEW_TEST_PG_DATABASE;
  const user = process.env.JEEVES_REVIEW_TEST_PG_USER;
  if (
    process.env.JEEVES_REVIEW_TEST_PG_MARKER !== "disposable-review-integrity" ||
    !socket || !path.isAbsolute(socket) ||
    !database || !/^jeeves_review_integrity_[a-z0-9_]{8,40}$/.test(database) ||
    !user || !/^[a-zA-Z0-9_-]+$/.test(user)
  ) {
    throw new Error("Refusing Postgres test connection: explicit disposable marker, socket, database and user are required");
  }
  const socketPath = await realpath(socket);
  const clusterRoot = path.dirname(socketPath);
  if (path.basename(socketPath) !== "socket" || !/^jeeves-review-pg-[a-zA-Z0-9_-]+$/.test(path.basename(clusterRoot))) {
    throw new Error("Refusing Postgres test connection: socket must be in a task-owned jeeves-review-pg-*/socket directory");
  }
  const dataDirectory = await realpath(path.join(clusterRoot, "data"));
  const config = {
    host: socketPath,
    port: 5432,
    database,
    user,
    password: () => "", // A truthy callback prevents pg inheriting PGPASSWORD.
    options: "-c search_path=public,pg_catalog", // Do not inherit PGOPTIONS.
    ssl: false as const,
    sslnegotiation: "postgres" as const,
    max: 1,
    connectionTimeoutMillis: 3_000,
    statement_timeout: 12_000,
    lock_timeout: 10_000,
    idle_in_transaction_session_timeout: 15_000,
  };
  const control = new Pool({ ...config, application_name: "jeeves-review-test-control" });
  const poolA = new Pool({ ...config, application_name: "jeeves-review-test-a" });
  const poolB = new Pool({ ...config, application_name: "jeeves-review-test-b" });
  const close = async () => {
    await Promise.all([poolA.end(), poolB.end(), control.end()]);
  };
  try {
    const { rows: [identity] } = await control.query<{
      database: string; data_directory: string; listen_addresses: string; address: string | null;
    }>(`select current_database() as database,
              current_setting('data_directory') as data_directory,
              current_setting('listen_addresses') as listen_addresses,
              inet_server_addr() as address`);
    if (
      !identity || identity.database !== database || identity.address !== null ||
      identity.listen_addresses !== "" || await realpath(identity.data_directory) !== dataDirectory
    ) {
      throw new Error("Refusing Postgres test mutation: server is not the explicit socket-only disposable cluster");
    }
    const existing = await control.query(
      "select 1 from information_schema.tables where table_schema not in ('pg_catalog', 'information_schema') limit 1",
    );
    if (existing.rowCount !== 0) {
      throw new Error("Refusing Postgres test migration: disposable database must be empty; create a fresh test database");
    }
    const dbA = drizzle({ client: poolA, schema });
    const dbB = drizzle({ client: poolB, schema });
    await migrate(dbA, { migrationsFolder: "./drizzle" });
    const [a, b] = await Promise.all([
      poolA.query<{ pid: number }>("select pg_backend_pid() as pid"),
      poolB.query<{ pid: number }>("select pg_backend_pid() as pid"),
    ]);
    const pidA = a.rows[0]!.pid;
    const pidB = b.rows[0]!.pid;
    if (pidA === pidB) throw new Error("Postgres race tests require two independent application backends");
    return { control, poolA, poolB, dbA, dbB, pidA, pidB, close };
  } catch (error) {
    await close();
    throw error;
  }
}

export type PrivatePostgres = Awaited<ReturnType<typeof openPrivatePostgres>>;

/** Resolve on an observed database lock, never because a delay elapsed. */
export async function waitForDatabaseBlock(db: PrivatePostgres, blockedPid: number, blockerPid: number | number[]) {
  const expectedBlockers = Array.isArray(blockerPid) ? blockerPid : [blockerPid];
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const { rows } = await db.control.query<{ blockers: number[] }>(
      "select pg_blocking_pids($1) as blockers", [blockedPid],
    );
    if (rows[0]?.blockers.some((pid) => expectedBlockers.includes(pid))) return;
    // Yield to the pending client requests; the assertion depends on
    // pg_blocking_pids, not on when this event-loop turn runs.
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(`Expected backend ${blockedPid} to wait on backend ${expectedBlockers.join(" or ")}`);
}

export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

/** A safety deadline prevents a broken lock/claim implementation hanging CI. */
export async function withDeadline<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Integrity test barrier was not reached")), 7_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
