/**
 * `npm run smoke:production`: boot a REAL production-mode server against a
 * disposable Postgres database and check the HTTP behaviour on the wire.
 *
 * Why it exists: a bug shipped unnoticed because nothing ever started a
 * production-mode server (proxy.ts returned a relative Location, Next's proxy
 * adapter rejected it, and every signed-out page answered 500). Unit tests call
 * the proxy function; only a running server shows what a scanner or load
 * balancer sees.
 *
 * SAFETY: this stamps its database `production`, and that stamp is immutable.
 * It therefore needs SMOKE_DATABASE_URL (no fallback to DATABASE_URL) naming a
 * database called jeeves_smoke_<something>, and refuses anything else. Once
 * the server is healthy it writes one canary row (see seedCanary) and removes
 * it when the checks end. A run that was interrupted leaves its row behind,
 * and the next run clears it before it starts the server. Two runs against
 * one database must therefore not overlap.
 *
 *   SMOKE_DATABASE_URL=postgres://user:pass@127.0.0.1:5432/jeeves_smoke_local \
 *     npm run smoke:production
 *
 * Needs a finished build (it never builds; for the standalone server it copies
 * .next/static into the standalone folder, as the Containerfile does).
 * SMOKE_PORT (default 3217) picks the port; SMOKE_SERVER=standalone|next-start
 * forces the server command.
 *
 * SMOKE_DEMO_LOCKED=1 is for a build made with JEEVES_DEMO_ENABLED=0 (what a
 * production image is built with). Such a build has demo mode compiled out, so
 * the server is started WITH JEEVES_MODE=demo and every production check must
 * still pass: that is the proof the flag cannot open the demo doors.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cpSync, existsSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONSOLE_HOME,
  CONSOLE_PATH_PREFIXES,
  MARKETING_PATH_PREFIXES,
  SIGN_IN_PATH,
} from "../lib/config/production-routes";
import { SESSION_COOKIE_NAME } from "../lib/security/session-cookie-name";
import { isMain } from "./is-main";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// Safety guard
// ---------------------------------------------------------------------------

const DISPOSABLE_DB_NAME = /^jeeves_smoke_[a-z0-9_]+$/;

/**
 * Returns the URL, or throws. The message deliberately names neither the URL
 * nor any part of it: a rejected URL may well be a real database's credentials.
 */
export function assertDisposableDatabaseUrl(url: string | undefined): string {
  const refusal = new Error(
    "SMOKE_DATABASE_URL must be a postgres:// or postgresql:// URL whose database is named " +
      "jeeves_smoke_<lowercase letters, digits or underscores>. The smoke test stamps its database " +
      "'production' for good, so it only runs against a throwaway one. Create it with " +
      "CREATE DATABASE jeeves_smoke_local; and point SMOKE_DATABASE_URL at it.",
  );
  if (!url) throw refusal;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw refusal;
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") throw refusal;
  let name: string;
  try {
    name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  } catch {
    throw refusal;
  }
  if (!DISPOSABLE_DB_NAME.test(name)) throw refusal;
  return url;
}

// ---------------------------------------------------------------------------
// Server environment
// ---------------------------------------------------------------------------

/**
 * Built from scratch, never from process.env: a stray JEEVES_MODE=demo,
 * DATA_PROVIDER=mock or OPERATOR_TOKEN in the developer's shell must not change
 * what is being tested.
 */
export function buildServerEnv(opts: { databaseUrl: string; port: number; cookieSecret: string }): Record<string, string> {
  const env: Record<string, string> = { PATH: process.env.PATH ?? "" };
  if (process.env.HOME) env.HOME = process.env.HOME;
  return {
    ...env,
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    PORT: String(opts.port),
    HOSTNAME: "127.0.0.1",
    DATABASE_URL: opts.databaseUrl,
    JEEVES_COOKIE_SECRET: opts.cookieSecret,
    APP_BASE_URL: "https://jeeves.example.com",
    JEEVES_TENANT_ID: "smoke-tenant",
    // Loopback, no proxy in front: nothing appends to X-Forwarded-For.
    JEEVES_TRUSTED_PROXY_HOPS: "0",
  };
}

// ---------------------------------------------------------------------------
// Wire checks
// ---------------------------------------------------------------------------

export interface SmokeCheck {
  name: string;
  method: "GET" | "POST";
  path: string;
  headers?: Record<string, string>;
  body?: string;
  expect: {
    /** Omit to leave the status unasserted (only the other expectations apply). */
    status?: number;
    /** Exact raw Location header value. */
    location?: string;
    /** Cache-Control must contain "no-store". */
    noStore?: boolean;
    bodyIncludes?: string[];
    bodyExcludes?: string[];
    emptyBody?: boolean;
    /** Header must be present and equal (string) or match (RegExp). */
    headers?: Record<string, string | RegExp>;
  };
}

export interface Observed {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** Problems found in a response; an empty list means the check passed. */
export function evaluateCheck(check: SmokeCheck, observed: Observed): string[] {
  const problems: string[] = [];
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(observed.headers)) headers[k.toLowerCase()] = v;
  const want = check.expect;

  if (want.status !== undefined && observed.status !== want.status) {
    problems.push(`status ${observed.status}, expected ${want.status}`);
  }
  if (want.location !== undefined && headers["location"] !== want.location) {
    problems.push(`location ${headers["location"] === undefined ? "missing" : JSON.stringify(headers["location"])}, expected ${JSON.stringify(want.location)}`);
  }
  if (want.noStore && !(headers["cache-control"] ?? "").includes("no-store")) {
    problems.push(`cache-control lacks no-store (${JSON.stringify(headers["cache-control"] ?? null)})`);
  }
  for (const needle of want.bodyIncludes ?? []) {
    if (!observed.body.includes(needle)) problems.push(`body does not include ${JSON.stringify(needle)}`);
  }
  for (const needle of want.bodyExcludes ?? []) {
    if (observed.body.includes(needle)) problems.push(`body includes forbidden ${JSON.stringify(needle)}`);
  }
  if (want.emptyBody && observed.body.length > 0) problems.push(`body should be empty, got ${observed.body.length} bytes`);
  for (const [name, expected] of Object.entries(want.headers ?? {})) {
    const actual = headers[name.toLowerCase()];
    if (actual === undefined) problems.push(`header ${name} missing`);
    else if (typeof expected === "string" ? actual !== expected : !expected.test(actual)) {
      problems.push(`header ${name} is ${JSON.stringify(actual)}, expected ${String(expected)}`);
    }
  }
  // next.config.ts turns the framework banner off.
  if ("x-powered-by" in headers) problems.push(`x-powered-by header present (${headers["x-powered-by"]})`);
  return problems;
}

const JSON_POST = { "content-type": "application/json" };
const DEMO_DOORS = ["/api/session", "/api/public-session", "/api/public-intake", "/api/cron/monitor", "/api/monitor/run"];

/** Built from the real route constants, so a page added later is covered automatically. */
export function buildSmokeChecks(canary?: string): SmokeCheck[] {
  const checks: SmokeCheck[] = [];

  // A. Redirects. The raw Location must be relative: Next rewrites a same-host
  // redirect that way, and an absolute one would leak the host the process
  // believes it has.
  const redirect = (name: string, path: string, location: string, headers?: Record<string, string>): void => {
    checks.push({ name, method: "GET", path, headers, expect: { status: 307, location, noStore: true } });
  };
  redirect("GET / redirects to the console home", "/", CONSOLE_HOME);
  for (const prefix of CONSOLE_PATH_PREFIXES) redirect(`GET ${prefix} signed out redirects to sign-in`, prefix, SIGN_IN_PATH);
  redirect("GET /initiatives/new?x=1 signed out redirects to sign-in", "/initiatives/new?x=1", SIGN_IN_PATH);
  redirect("foreign Host header is not echoed in the redirect", "/inbox", SIGN_IN_PATH, { Host: "attacker.example" });
  checks.push({
    name: "garbage cookie leaks no data",
    method: "GET",
    path: "/inbox",
    headers: { cookie: `${SESSION_COOKIE_NAME}=garbage` },
    // The proxy only checks that a credential is PRESENT, so this request reaches
    // the page, which today answers with a streamed redirect inside a 200. Pin that
    // (it couples to Next's redirect digest format): a 5xx or a rendered console
    // must fail. The canary row (see seedCanary) must never show.
    expect: { status: 200, bodyIncludes: ["NEXT_REDIRECT;replace;/sign-in"], bodyExcludes: ["Meridian", "Synthetic data", ...(canary ? [canary] : [])] },
  });

  // B. Marketing pages do not exist in production.
  for (const prefix of [...MARKETING_PATH_PREFIXES, "/frameworks/nist-ai-rmf"]) {
    checks.push({ name: `GET ${prefix} is 404`, method: "GET", path: prefix, expect: { status: 404, noStore: true, emptyBody: true } });
  }

  // C. Sign-in page.
  checks.push({
    name: "GET /sign-in renders the SSO notice with security headers",
    method: "GET",
    path: "/sign-in",
    expect: {
      status: 200,
      bodyIncludes: ["Single sign-on is not yet configured"],
      bodyExcludes: ["Meridian", "Synthetic", "persona", "playground", ...(canary ? [canary] : [])],
      headers: {
        "content-security-policy": /frame-ancestors 'none'/,
        "x-frame-options": "DENY",
        "x-content-type-options": "nosniff",
        "strict-transport-security": /max-age=\d+/,
      },
    },
  });

  // D. Demo doors are closed.
  for (const door of DEMO_DOORS) {
    checks.push({ name: `GET ${door} is closed`, method: "GET", path: door, expect: { status: 404, noStore: true, emptyBody: true } });
    checks.push({
      name: `POST ${door} is closed`,
      method: "POST",
      path: door,
      headers: JSON_POST,
      body: "{}",
      expect: { status: 404, noStore: true, emptyBody: true },
    });
  }
  checks.push({
    name: "GET /operator is closed",
    method: "GET",
    path: "/operator",
    expect: { status: 404, bodyExcludes: ["Real requests", "operator-token-input"] },
  });

  // E. Reads are gated.
  for (const p of ["/api/exceptions", "/api/monitor/incidents", "/initiatives/x/detail-data"]) {
    checks.push({
      name: `GET ${p} is 401 without a session`,
      method: "GET",
      path: p,
      expect: { status: 401, noStore: true, bodyIncludes: ["invalid or missing session"] },
    });
  }
  checks.push({
    name: "POST /api/initiatives is 401 without a session",
    method: "POST",
    path: "/api/initiatives",
    headers: JSON_POST,
    body: "{}",
    expect: { status: 401, bodyIncludes: ["invalid or missing session"] },
  });

  // F. Crawlers.
  checks.push({
    name: "GET /robots.txt disallows everything",
    method: "GET",
    path: "/robots.txt",
    expect: { status: 200, bodyIncludes: ["Disallow: /"], bodyExcludes: ["Sitemap:", "Allow: /"] },
  });
  checks.push({ name: "GET /sitemap.xml lists no URLs", method: "GET", path: "/sitemap.xml", expect: { status: 200, bodyExcludes: ["<url>"] } });

  // G. Health.
  checks.push({
    name: "GET /api/health is ok",
    method: "GET",
    path: "/api/health",
    expect: { status: 200, noStore: true, bodyIncludes: ['"status":"ok"', '"database":"ok"'] },
  });

  // H. Unknown path.
  checks.push({ name: "unknown path is 404", method: "GET", path: "/this-page-does-not-exist", expect: { status: 404, bodyExcludes: ["the public site"] } });

  return checks;
}

// ---------------------------------------------------------------------------
// Boot refusals
// ---------------------------------------------------------------------------

export interface BootRefusalCase {
  name: string;
  /** Returns the good server environment with this case's fault applied. */
  modify: (env: Record<string, string>) => Record<string, string>;
  /** Text the refusal output must contain. */
  expectText: string;
}

const DEMO_MODE_REFUSAL = "demo mode on a production-stamped database";

export const bootRefusalCases: BootRefusalCase[] = [
  {
    name: "missing cookie secret",
    modify: (env) => {
      const rest = { ...env };
      delete rest.JEEVES_COOKIE_SECRET;
      return rest;
    },
    expectText: "JEEVES_COOKIE_SECRET is required",
  },
  {
    name: DEMO_MODE_REFUSAL,
    modify: (env) => ({ ...env, JEEVES_MODE: "demo" }),
    expectText: 'stamped "production"',
  },
  {
    name: "mock data provider",
    modify: (env) => ({ ...env, DATA_PROVIDER: "mock" }),
    expectText: "DATA_PROVIDER=mock is not allowed",
  },
  {
    name: "plain http base URL",
    modify: (env) => ({ ...env, APP_BASE_URL: "http://jeeves.example.com" }),
    expectText: "APP_BASE_URL must be an https origin",
  },
];

/**
 * A demo-locked build (JEEVES_DEMO_ENABLED=0) never enters demo mode, so it has
 * nothing to refuse when JEEVES_MODE=demo is set: that case is replaced by
 * runtimeEnvFor() starting the real server with the flag set.
 */
export function bootRefusalCasesFor(demoLocked: boolean): BootRefusalCase[] {
  return demoLocked ? bootRefusalCases.filter((c) => c.name !== DEMO_MODE_REFUSAL) : bootRefusalCases;
}

/** The environment the checked server runs with: the good one, plus JEEVES_MODE=demo on a locked build. */
export function runtimeEnvFor(good: Record<string, string>, demoLocked: boolean): Record<string, string> {
  return demoLocked ? { ...good, JEEVES_MODE: "demo" } : good;
}

// ---------------------------------------------------------------------------
// Output hygiene
// ---------------------------------------------------------------------------

/**
 * What must never appear in output: the database URL, and its password both as
 * written in the URL and decoded (a driver error may quote either form).
 */
export function databaseSecrets(databaseUrl: string): string[] {
  const secrets = [databaseUrl];
  try {
    const raw = new URL(databaseUrl).password;
    if (raw) {
      secrets.push(raw);
      const decoded = decodeURIComponent(raw);
      if (decoded !== raw) secrets.push(decoded);
    }
  } catch {
    // Not a URL (or a malformed escape): the string itself is the only secret.
  }
  return secrets;
}

/** Replaces each secret, and the password inside a secret URL, with [redacted]. */
export function redact(text: string, secrets: string[]): string {
  let out = text;
  for (const piece of secrets.flatMap(databaseSecrets)) {
    if (piece) out = out.split(piece).join("[redacted]");
  }
  return out;
}

/** SMOKE_PORT, or 3217. A typo must fail here, not as an unreadable spawn error. */
export function parsePort(value: string | undefined): number {
  if (value === undefined) return 3217;
  const port = Number(value);
  if (!/^\d+$/.test(value) || port < 1 || port > 65_535) {
    throw new Error("SMOKE_PORT must be a whole number between 1 and 65535");
  }
  return port;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface ServerCommand {
  label: string;
  /** True for the standalone server, which needs .next/static copied beside it. */
  standalone: boolean;
  args: string[];
  cwd: string;
}

export function serverCommand(port: number, force: string | undefined): ServerCommand {
  const standalone = path.join(REPO_ROOT, ".next/standalone/server.js");
  const useStandalone = force === "standalone" || (force !== "next-start" && existsSync(standalone));
  if (useStandalone) {
    if (!existsSync(standalone)) throw new Error(".next/standalone/server.js is missing; SMOKE_SERVER=next-start can run without it");
    // What deploy/podman/Containerfile runs (it chdirs to its own directory itself).
    return { label: "standalone (node .next/standalone/server.js)", standalone: true, args: [standalone], cwd: REPO_ROOT };
  }
  return {
    label: "next-start (node node_modules/next/dist/bin/next start)",
    standalone: false,
    args: [path.join(REPO_ROOT, "node_modules/next/dist/bin/next"), "start", "-p", String(port), "-H", "127.0.0.1"],
    cwd: REPO_ROOT,
  };
}

/** Where the standalone server looks for static assets; the Containerfile copies .next/static here. */
export function standaloneStaticTarget(): string {
  return path.join(REPO_ROOT, ".next/standalone/.next/static");
}

/** The first /_next/static script or stylesheet URL in a page, or null. */
export function extractStaticAssetUrl(html: string): string | null {
  return /\/_next\/static\/[^"'\s<>]+\.(?:js|css)(?:\?[^"'\s<>]*)?/.exec(html)?.[0] ?? null;
}

function spawnServer(cmd: ServerCommand, env: Record<string, string>): { child: ChildProcess; output: () => string } {
  // The node binary is spawned directly (never through npm/npx), so signalling
  // the child stops the server itself.
  const child = spawn(process.execPath, cmd.args, { cwd: cmd.cwd, env: env as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout?.on("data", (d: Buffer) => (out += d.toString()));
  child.stderr?.on("data", (d: Buffer) => (out += d.toString()));
  return { child, output: () => out };
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
  await exited;
  clearTimeout(timer);
}

/** True when something already accepts connections on 127.0.0.1:`port`. */
export function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

function request(port: number, check: Pick<SmokeCheck, "method" | "path" | "headers" | "body">): Promise<Observed> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, method: check.method, path: check.path, headers: check.headers, timeout: 15_000 },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) headers[k] = Array.isArray(v) ? v.join(", ") : v;
          resolve({ status: res.statusCode ?? 0, headers, body: Buffer.concat(chunks).toString("utf8") });
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("request timed out after 15 s")));
    req.on("error", reject);
    if (check.body !== undefined) req.write(check.body);
    req.end();
  });
}

/** Default bound for a node script the smoke run waits on (the migration). */
const RUN_TIMEOUT_MS = 120_000;

/**
 * Runs a node script and waits until its output is closed. A run that outlives
 * `timeoutMs` is stopped and reported as `timedOut`, so a hung migration fails
 * the smoke run with a reason instead of holding the job until its own limit.
 */
export function runToCompletion(
  args: string[],
  env: Record<string, string>,
  timeoutMs = RUN_TIMEOUT_MS,
): Promise<{ code: number | null; output: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: REPO_ROOT, env: env as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      void stopChild(child);
    }, timeoutMs);
    child.stdout.on("data", (d: Buffer) => (output += d.toString()));
    child.stderr.on("data", (d: Buffer) => (output += d.toString()));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output, timedOut });
    });
  });
}

function baseEnv(): Record<string, string> {
  const env: Record<string, string> = { PATH: process.env.PATH ?? "" };
  if (process.env.HOME) env.HOME = process.env.HOME;
  return env;
}

// ---------------------------------------------------------------------------
// Smoke database: the canary row and the stamp
// ---------------------------------------------------------------------------

/** What the database steps need from a client. node-postgres and PGlite both have it. */
export interface SmokeSql {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

const CANARY_PREFIX = "smoke-canary-";

/**
 * One initiative with no workspace and a random title. That is what a read with
 * no viewer returns, so a response that leaks past the gate shows it. Without
 * it the smoke database is empty, and a check that looks for demo wording in an
 * empty database cannot fail.
 *
 * The production boot check refuses exactly such a row as demo data
 * (lib/config/installation-check.ts). It is therefore written only once the
 * server is up, and removed again before the run ends (see withCanary).
 */
export async function seedCanary(db: SmokeSql, canary: string): Promise<void> {
  await db.query(
    "INSERT INTO initiatives (id, slug, title, requester, state, created_at, updated_at) VALUES ($1, $1, $1, 'smoke', 'intake_draft', now(), now())",
    [canary],
  );
}

/** Removes every canary: this run's, and that of a run which was interrupted before it could. */
export async function removeCanaries(db: SmokeSql): Promise<void> {
  await db.query("DELETE FROM initiatives WHERE starts_with(id, $1)", [CANARY_PREFIX]);
}

/** Runs `checks` with the canary in the database, and removes it whatever happens. */
export async function withCanary(db: SmokeSql, canary: string, checks: () => Promise<void>): Promise<void> {
  await seedCanary(db, canary);
  try {
    await checks();
  } finally {
    await removeCanaries(db);
  }
}

/**
 * Stamps the migrated smoke database `production`, or keeps the stamp of an
 * earlier run, and refuses a database that is stamped demo.
 *
 * It then clears the canary of a run that was interrupted: the server would
 * refuse to start on it. That comes after the stamp check, so a database that
 * is refused is left as it was.
 */
export async function prepareSmokeDatabase(db: SmokeSql, installId: string): Promise<void> {
  await db.query("INSERT INTO installation (deploy_mode, install_id) VALUES ('production', $1) ON CONFLICT (id) DO NOTHING", [installId]);
  const { rows } = await db.query("SELECT deploy_mode FROM installation");
  if (rows.length !== 1 || (rows[0] as { deploy_mode: string }).deploy_mode !== "production") {
    throw new Error("this database is stamped demo; use a fresh jeeves_smoke_* database");
  }
  await removeCanaries(db);
}

/** Opens a connection to the smoke database for `run` and closes it whatever happens. */
async function withSmokeDatabase<T>(databaseUrl: string, run: (db: SmokeSql) => Promise<T>): Promise<T> {
  const { Client } = await import("pg");
  const client = new Client({ connectionString: databaseUrl });
  // The connection is idle while the wire checks run. If the server drops it then, a client
  // without a listener raises an uncaught exception, and the server under test is never stopped.
  // With one, the next query on this client rejects, and the run fails in the ordinary way.
  client.on("error", () => {});
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

async function migrateAndStamp(databaseUrl: string): Promise<void> {
  const tsx = path.join(REPO_ROOT, "node_modules/tsx/dist/cli.mjs");
  const migrate = await runToCompletion([tsx, "scripts/migrate.ts"], { ...baseEnv(), DATABASE_URL: databaseUrl });
  if (migrate.timedOut) throw new Error(`migration did not finish within ${RUN_TIMEOUT_MS / 1000} s:\n${redact(migrate.output, [databaseUrl])}`);
  if (migrate.code !== 0) throw new Error(`migration failed:\n${redact(migrate.output, [databaseUrl])}`);

  await withSmokeDatabase(databaseUrl, (db) => prepareSmokeDatabase(db, `smoke-${randomBytes(4).toString("hex")}`));
}

async function runBootRefusal(c: BootRefusalCase, cmd: ServerCommand, good: Record<string, string>, secrets: string[]): Promise<string[]> {
  const { child, output } = spawnServer(cmd, c.modify(good));
  const exit = await new Promise<number | null | "timeout">((resolve) => {
    child.once("close", (code) => resolve(code));
    setTimeout(() => resolve("timeout"), 30_000).unref();
  });
  const text = output();
  const problems: string[] = [];
  if (exit === "timeout") {
    problems.push("still running after 30 s (did not refuse to boot)");
    await stopChild(child);
  } else if (exit !== 1) problems.push(`exit code ${exit}, expected 1`);
  if (!text.includes(c.expectText)) problems.push(`output lacks ${JSON.stringify(c.expectText)}`);
  if (secrets.some((secret) => text.includes(secret))) problems.push("output contains a database credential");
  if (problems.length) problems.push(`output was: ${redact(text, secrets).trim().slice(0, 600)}`);
  return problems;
}

async function waitForHealth(port: number, child: ChildProcess): Promise<boolean> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) return false;
    try {
      if ((await request(port, { method: "GET", path: "/api/health" })).status === 200) return true;
    } catch {
      // Not listening yet.
    }
    await sleep(250);
  }
  return false;
}

async function main(): Promise<void> {
  let databaseUrl: string;
  try {
    databaseUrl = assertDisposableDatabaseUrl(process.env.SMOKE_DATABASE_URL);
  } catch (err) {
    console.error(err instanceof Error ? err.message : "invalid SMOKE_DATABASE_URL");
    process.exitCode = 2;
    return;
  }
  let port: number;
  try {
    port = parsePort(process.env.SMOKE_PORT);
  } catch (err) {
    console.error(err instanceof Error ? err.message : "invalid SMOKE_PORT");
    process.exitCode = 2;
    return;
  }
  if (!existsSync(path.join(REPO_ROOT, ".next/BUILD_ID"))) {
    console.error("No production build found. Run: DATA_PROVIDER=mock JEEVES_MODE=demo npm run build");
    process.exitCode = 2;
    return;
  }

  if (await portInUse(port)) {
    console.error(`Port ${port} is in use: a server is already listening there. Stop it or set SMOKE_PORT.`);
    process.exitCode = 2;
    return;
  }

  const secrets = databaseSecrets(databaseUrl);
  const cmd = serverCommand(port, process.env.SMOKE_SERVER);
  const demoLocked = process.env.SMOKE_DEMO_LOCKED === "1";
  console.log(`Server: ${cmd.label}, port ${port}`);
  console.log(
    demoLocked
      ? "Build: demo-locked (JEEVES_DEMO_ENABLED=0). The server runs WITH JEEVES_MODE=demo and must still behave as production."
      : "Build: demo-capable. The server runs without JEEVES_MODE.",
  );

  if (cmd.standalone) cpSync(path.join(REPO_ROOT, ".next/static"), standaloneStaticTarget(), { recursive: true });

  console.log("Migrating and stamping the smoke database...");
  await migrateAndStamp(databaseUrl);

  const good = buildServerEnv({ databaseUrl, port, cookieSecret: randomBytes(32).toString("hex") });
  let failed = 0;
  let passed = 0;
  const record = (ok: boolean, name: string, detail: string[] = []): void => {
    if (ok) passed++;
    else failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
    for (const line of detail) console.log(`      ${line}`);
  };

  for (const c of bootRefusalCasesFor(demoLocked)) {
    const problems = await runBootRefusal(c, cmd, good, secrets);
    record(problems.length === 0, `boot refusal: ${c.name}`, problems);
  }

  const { child, output } = spawnServer(cmd, runtimeEnvFor(good, demoLocked));
  try {
    if (!(await waitForHealth(port, child))) {
      // On a locked run this is also what a build that is NOT locked looks like:
      // it enters demo mode and refuses the production-stamped database.
      console.error(`Server did not become healthy. Output:\n${redact(output(), secrets)}`);
      process.exitCode = 1;
      return;
    }
    // The server has passed its boot check on a database without the canary. Only now is it written.
    const canary = `${CANARY_PREFIX}${randomBytes(4).toString("hex")}`;
    await withSmokeDatabase(databaseUrl, (db) =>
      withCanary(db, canary, async () => {
        for (const check of buildSmokeChecks(canary)) {
          try {
            const observed = await request(port, check);
            const problems = evaluateCheck(check, observed);
            record(problems.length === 0, check.name, problems.length ? [...problems, `observed status ${observed.status}, location ${observed.headers.location ?? "none"}`] : []);
          } catch (err) {
            record(false, check.name, [`request failed: ${err instanceof Error ? err.message : "unknown error"}`]);
          }
        }
        const name = "GET /sign-in links a static asset that is served";
        try {
          const page = await request(port, { method: "GET", path: SIGN_IN_PATH });
          const asset = extractStaticAssetUrl(page.body);
          if (!asset) {
            record(false, name, ["no /_next/static script or stylesheet found in the /sign-in HTML"]);
          } else {
            const res = await request(port, { method: "GET", path: asset });
            const type = res.headers["content-type"] ?? "";
            const served = res.status === 200 && /javascript|css/.test(type);
            record(served, name, served ? [] : [`${asset}: status ${res.status}, content-type ${type || "none"}`]);
          }
        } catch (err) {
          record(false, name, [`request failed: ${err instanceof Error ? err.message : "unknown error"}`]);
        }
      }),
    );
  } finally {
    await stopChild(child);
  }

  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

if (isMain(import.meta.url, process.argv[1])) {
  main().catch((err) => {
    console.error(`Smoke test failed: ${err instanceof Error ? err.message : "unknown error"}`);
    process.exitCode = 1;
  });
}
