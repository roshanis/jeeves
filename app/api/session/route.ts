/** Public demo entry and persona switching. Every action still needs a
 * server-issued, workspace-bound session. No visitor password is required. */
import { z } from "zod";
import { checkReadOnlyMode, checkSessionAttempt, clientKeyFor, issueDemoSession, extractSessionToken, resolveSession } from "@/lib/services/route-guard";
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

export async function POST(req: Request): Promise<Response> {
  const readOnlyFailure = checkReadOnlyMode();
  if (readOnlyFailure) {
    return Response.json({ error: readOnlyFailure.message }, { status: readOnlyFailure.status });
  }

  // Validate any supplied parent session before applying its switch allowance.
  const token = extractSessionToken(req);
  const parent = token ? await resolveSession(token) : null;
  const attempt = await checkSessionAttempt(clientKeyFor(req), Boolean(parent?.actor && parent.workspaceId));
  if (!attempt.allowed) {
    return Response.json(
      { error: "too many attempts — try again later" },
      { status: 429, headers: { "Retry-After": String(attempt.retryAfterSeconds) } },
    );
  }

  if (token && (!parent?.actor || !parent.workspaceId)) {
    return Response.json({ error: "session expired or invalid" }, { status: 401 });
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

  const secret = resolveWorkspaceCookieSecret();
  if (!secret) {
    return Response.json({ error: "Demo workspace is not configured. Please try again later.", code: "DEMO_NOT_CONFIGURED" }, { status: 503 });
  }
  // Authenticated workspace wins over a browser continuity hint.
  const existingWorkspaceId = parent?.workspaceId ?? verifyWorkspaceCookie(readWorkspaceCookie(req), secret);

  const result = await issueDemoSession(
    parsed.data.personaKey,
    existingWorkspaceId,
  );
  if (!result) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const headers = { "Set-Cookie": workspaceCookieHeader(result.workspaceId, secret) };
  return Response.json(result, { status: 200, headers });
}
