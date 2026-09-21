/** Public demo entry and persona switching. Every action still needs a
 * server-issued, workspace-bound session. No visitor password is required. */
import { z } from "zod";
import { checkSessionAttempt, clientKeyFor, issueDemoSession, extractSessionToken, resolveSession } from "@/lib/services/route-guard";
import { resolveActor } from "@/lib/services/actors";
import {
  resolveWorkspaceCookieSecret,
  signWorkspaceId,
  verifyWorkspaceCookie,
} from "@/lib/security/workspace-cookie";

// Per-browser workspace cookie (M2.5 inc.2b). Read-scoping ONLY — it is not
// an auth credential (mutations still require the Bearer token), so it opens
// no CSRF surface. Set on first login and REUSED on later logins so every
// persona acting in one browser shares the same demo workspace (the champion
// loop spans requester -> reviewer -> approver logins).
//
// Security-hardening pass (external-review finding #1 continuation): the
// value is now SIGNED (lib/security/workspace-cookie.ts) — `issueDemoSession`
// used to trust the raw incoming cookie unconditionally, letting an attacker
// "adopt" any workspace (and, once workspace checks gate mutations, mutate
// it) just by setting the cookie. An invalid/unsigned/legacy/tampered cookie
// -> treated as absent (fresh workspace), never an error.
//
// The cookie is read from the incoming Request and written via a Set-Cookie
// header (rather than next/headers `cookies()`) so this handler works both in
// the Next runtime AND when unit tests invoke POST() directly with no request
// scope.
const WORKSPACE_COOKIE = "jeeves_workspace";
const WORKSPACE_COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function readWorkspaceCookie(req: Request): string | null {
  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) return null;
  const match = cookieHeader
    .split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${WORKSPACE_COOKIE}=`));
  try { return match ? decodeURIComponent(match.slice(WORKSPACE_COOKIE.length + 1)) : null; }
  catch { return null; }
}

function workspaceCookieHeader(workspaceId: string, secret: string): string {
  const signed = signWorkspaceId(workspaceId, secret);
  const parts = [
    `${WORKSPACE_COOKIE}=${encodeURIComponent(signed)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${WORKSPACE_COOKIE_MAX_AGE}`,
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

const bodySchema = z.object({
  personaKey: z.string().min(1).max(100),
});

const SAFE_DRIVER_CODES = new Set([
  "EROFS", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND",
  "08000", "08003", "08006", "53300", "57P01",
  "42P01", "42703", "28P01", "28000", "42501", "3D000",
  "CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "ERR_TLS_CERT_ALTNAME_INVALID",
  "SELF_SIGNED_CERT_IN_CHAIN", "CERT_REJECTED",
]);

function storageUnavailable(error: unknown): Response {
  const requestId = crypto.randomUUID();
  const outer = error && typeof error === "object" ? error as { code?: unknown; cause?: unknown } : {};
  const inner = outer.cause && typeof outer.cause === "object" ? outer.cause as { code?: unknown } : {};
  const rawCode = typeof outer.code === "string" ? outer.code : inner.code;
  const causeCode = typeof rawCode === "string" && SAFE_DRIVER_CODES.has(rawCode) ? rawCode : "UNKNOWN";
  console.error("Demo session storage unavailable", { requestId, causeCode });
  return Response.json(
    { error: "Demo session storage is temporarily unavailable. Please try again later.", code: "DEMO_STORAGE_UNAVAILABLE", requestId },
    { status: 503 },
  );
}

export async function POST(req: Request): Promise<Response> {
  // Parse and validate the public input before any database-backed guards.
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "invalid request body" }, { status: 400 });
  }

  if (!resolveActor(parsed.data.personaKey)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const secret = resolveWorkspaceCookieSecret();
  if (!secret) {
    return Response.json({ error: "Demo workspace is not configured. Please try again later.", code: "DEMO_NOT_CONFIGURED" }, { status: 503 });
  }

  let token: string | null;
  try {
    token = extractSessionToken(req);
  } catch {
    return Response.json({ error: "session expired or invalid" }, { status: 401 });
  }

  // These guards use persistent session and rate-limit state.
  let parent;
  let attempt;
  try {
    parent = token ? await resolveSession(token) : null;
    attempt = await checkSessionAttempt(clientKeyFor(req), Boolean(parent?.actor && parent.workspaceId));
  } catch (error) {
    return storageUnavailable(error);
  }
  if (!attempt.allowed) {
    return Response.json(
      { error: "too many attempts — try again later" },
      { status: 429, headers: { "Retry-After": String(attempt.retryAfterSeconds) } },
    );
  }

  if (token && (!parent?.actor || !parent.workspaceId)) {
    return Response.json({ error: "session expired or invalid" }, { status: 401 });
  }

  // Authenticated workspace wins over a browser continuity hint.
  const existingWorkspaceId = parent?.workspaceId ?? verifyWorkspaceCookie(readWorkspaceCookie(req), secret);

  let result;
  try {
    result = await issueDemoSession(parsed.data.personaKey, existingWorkspaceId);
  } catch (error) {
    return storageUnavailable(error);
  }
  if (!result) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const headers = { "Set-Cookie": workspaceCookieHeader(result.workspaceId, secret) };
  return Response.json(result, { status: 200, headers });
}
