/** Public demo entry and persona switching. Every action still needs a
 * server-issued, workspace-bound session. No visitor password is required. */
import { z } from "zod";
import { demoDoorClosed, demoDoorFallbacks } from "@/lib/config/demo-doors";
import { checkReadOnlyMode, checkSessionAttempt, clientKeyFor, guardFailureResponse, issueDemoSession, extractSessionToken, resolveSession, revokeSession, runMutationGuard } from "@/lib/services/route-guard";
import { isPersonaKey, resolveActor } from "@/lib/services/actors";
import { safeDriverCode } from "@/lib/db/driver-error";
import { isSameOriginRequest } from "@/lib/security/same-origin";
import { BodyReadError, PRE_SESSION_BODY_MAX_BYTES, readJsonBody } from "@/lib/http/read-json-body";
import {
  WORKSPACE_COOKIE_MAX_AGE_SECONDS,
  resolveWorkspaceCookieSecret,
  signWorkspaceId,
  verifyWorkspaceCookie,
} from "@/lib/security/workspace-cookie";
import { databaseNotReady } from "@/lib/http/database-gate";

// Per-browser workspace cookie (M2.5 inc.2b). A bearer capability for one
// playground workspace, valid for its Max-Age (see workspace-cookie.ts): it
// lets its holder enter that workspace, but mutations still require the
// Bearer token, which a browser never attaches on its own, so a forged
// cross-site request cannot mutate anything. The cookie is SameSite=Lax, so it IS sent on top-level
// cross-site GET navigations: keep every GET that reads it side-effect free,
// and keep SameSite/HttpOnly as they are. Set on first login and REUSED on
// later logins so every persona acting in one browser shares the same demo
// workspace (the champion loop spans requester -> reviewer -> approver
// logins).
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
const WORKSPACE_COOKIE_MAX_AGE = WORKSPACE_COOKIE_MAX_AGE_SECONDS;

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

function storageUnavailable(error: unknown): Response {
  const requestId = crypto.randomUUID();
  const causeCode = safeDriverCode(error) ?? "UNKNOWN";
  console.error("Demo session storage unavailable", { requestId, causeCode });
  return Response.json(
    { error: "Demo session storage is temporarily unavailable. Please try again later.", code: "DEMO_STORAGE_UNAVAILABLE", requestId },
    { status: 503 },
  );
}

// Production has no persona sessions: 404 first, before the body is parsed or
// any limiter or database is touched (lib/config/demo-doors.ts). POST and
// DELETE each answer it themselves.
export const { GET, HEAD, PUT, PATCH, OPTIONS } = demoDoorFallbacks("POST", "DELETE");

export async function POST(req: Request): Promise<Response> {
  const closed = demoDoorClosed();
  if (closed) return closed;
  // A cross-site form can POST here (req.json() ignores Content-Type) and replace the victim's workspace cookie.
  if (!isSameOriginRequest(req)) return Response.json({ error: "cross-origin requests are not permitted" }, { status: 403 });
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "content-type must be application/json" }, { status: 415 });
  }

  const unavailable = databaseNotReady();
  if (unavailable) return unavailable;

  const readOnlyFailure = checkReadOnlyMode();
  if (readOnlyFailure) {
    return Response.json({ error: readOnlyFailure.message }, { status: readOnlyFailure.status });
  }

  // Parse and validate the public input before any database-backed guards.
  let json: unknown;
  try {
    json = await readJsonBody(req, PRE_SESSION_BODY_MAX_BYTES);
  } catch (error) {
    if (error instanceof BodyReadError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "invalid request body" }, { status: 400 });
  }

  // Demo personas only. `public:` keys resolve in resolveActor because real-
  // request sessions store them, but they are minted solely by
  // /api/public-session — accepting one here would let a caller choose their
  // own actor id and bypass that route's rate limit.
  if (!isPersonaKey(parsed.data.personaKey) || !resolveActor(parsed.data.personaKey)) {
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
    attempt = await checkSessionAttempt(clientKeyFor(req), Boolean(parent?.actor && parent.workspaceId && parent.actor.role !== "public"));
    // A public parent is never a workspace donor (below), so it mints a fresh workspace and pays the anonymous rate.
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

  // Authenticated workspace wins over a browser continuity hint — except a
  // real-request (`public`) session, which is never a workspace donor. Its
  // workspace holds requests sent to the site's operators; a persona switched
  // into from it must land in a playground workspace, or the visitor could
  // approve their own real request and every sample they made afterwards
  // would appear in the operator's queue.
  const donor = parent?.actor?.role === "public" ? null : parent?.workspaceId;
  const existingWorkspaceId = donor ?? verifyWorkspaceCookie(readWorkspaceCookie(req), secret);

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

/** Exit: delete exactly the presented token's row. A persona session only (the guard refuses `public`), same session and rate limit as every mutation. */
export async function DELETE(req: Request): Promise<Response> {
  const closed = demoDoorClosed();
  if (closed) return closed;
  if (!isSameOriginRequest(req)) return Response.json({ error: "cross-origin requests are not permitted" }, { status: 403 });
  const unavailable = databaseNotReady();
  if (unavailable) return unavailable;
  const guard = await runMutationGuard(req, undefined);
  if (!guard.ok) return guardFailureResponse(guard.failure);
  const token = extractSessionToken(req);
  if (token) await revokeSession(token);
  return new Response(null, { status: 204 });
}
