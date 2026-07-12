/**
 * POST /api/session — passcode -> demo session token (task brief deliverable 3).
 *
 * Body:  { passcode: string, personaKey: string }
 * 200:   { token: string, workspaceId: string, expiresAt: number }
 * 401:   { error: string }  (wrong passcode, misconfigured passcode, or
 *                            unknown personaKey — never distinguished in the
 *                            response, to avoid leaking which part failed)
 * 400:   { error: string }  (malformed body)
 *
 * This route intentionally does NOT go through `runMutationGuard` (there is
 * no session yet to check) — it is the one mutating endpoint that is
 * reachable pre-session, gated by the passcode itself instead.
 */
import { z } from "zod";
import { checkSessionAttempt, clientKeyFor, issueDemoSession } from "@/lib/services/route-guard";

// Per-browser workspace cookie (M2.5 inc.2b). Read-scoping ONLY — it is not
// an auth credential (mutations still require the Bearer token), so it opens
// no CSRF surface. Set on first login and REUSED on later logins so every
// persona acting in one browser shares the same demo workspace (the champion
// loop spans requester -> reviewer -> approver logins).
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
  return match ? decodeURIComponent(match.slice(WORKSPACE_COOKIE.length + 1)) : null;
}

function workspaceCookieHeader(workspaceId: string): string {
  const parts = [
    `${WORKSPACE_COOKIE}=${encodeURIComponent(workspaceId)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${WORKSPACE_COOKIE_MAX_AGE}`,
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

const bodySchema = z.object({
  passcode: z.string().min(1).max(200),
  personaKey: z.string().min(1).max(100),
});

export async function POST(req: Request): Promise<Response> {
  // Security review finding #1: brute-force gate — this route sits
  // pre-session, outside runMutationGuard. Limiter lives in route-guard so
  // resetGuardStateForTests() clears it between tests.
  const attempt = checkSessionAttempt(clientKeyFor(req));
  if (!attempt.allowed) {
    return Response.json(
      { error: "too many attempts — try again later" },
      { status: 429, headers: { "Retry-After": String(attempt.retryAfterSeconds) } },
    );
  }

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

  const existingWorkspaceId = readWorkspaceCookie(req);

  const expected = process.env.DEMO_PASSCODE ?? "";
  const result = await issueDemoSession(
    parsed.data.passcode,
    expected,
    parsed.data.personaKey,
    existingWorkspaceId,
  );
  if (!result) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  // Set (or refresh) the per-browser workspace cookie so subsequent logins in
  // this browser reuse the same workspace.
  return Response.json(result, {
    status: 200,
    headers: { "Set-Cookie": workspaceCookieHeader(result.workspaceId) },
  });
}
