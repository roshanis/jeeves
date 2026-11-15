/**
 * POST /api/public-session — a passcode-free session for public intake.
 *
 * This is the ONE unauthenticated write entry point in the app, and it is
 * deliberately a separate door rather than a loosened `runMutationGuard`:
 * everything else keeps the gate it always had.
 *
 * The session it mints carries the `public` role, which is NOT `requester`.
 * That distinction is the whole safety argument — `requester` already
 * unlocks POST /api/chat/intake and the 8-domain draft-run, both of which
 * spend the shared OpenAI budget, so a public session carrying it would let
 * anonymous callers spend money. `public` is denied by every existing
 * `role !== "requester"` check and holds only what the three intake routes
 * grant it explicitly. app/api/__tests__/public-submission.test.ts is the
 * lock on that.
 *
 * Body:  (none)
 * 200:   { token, workspaceId, expiresAt }
 * 403/415: { error }  (foreign Origin, or a declared non-JSON body)
 * 404:   { error }  (no operator queue configured — nobody could read what
 *                    a visitor sends, so the door stays closed)
 * 429:   { error }  (per-client mint ceiling — the rate at which one caller
 *                    can acquire identities, and so write rows)
 * 404:   production mode — no `public` session can exist there, and the door
 *        answers before every other check (403/415 included), the rate
 *        limiter and the database.
 */
import { demoDoorClosed, demoDoorFallbacks } from "@/lib/config/demo-doors";
import { isSameOriginRequest } from "@/lib/security/same-origin";
import { clientKeyFor, configuredOperatorToken, issuePublicSession } from "@/lib/services/route-guard";
import { databaseNotReady } from "@/lib/http/database-gate";

export const { GET, HEAD, PUT, PATCH, DELETE, OPTIONS } = demoDoorFallbacks("POST");

export async function POST(req: Request): Promise<Response> {
  // Production closes the door before any other check, so it answers 404 to every caller.
  const closed = demoDoorClosed();
  if (closed) return closed;
  // The body is empty, so a request with no Content-Type is fine; a declared form or text type is a cross-site form post.
  if (!isSameOriginRequest(req)) return Response.json({ error: "cross-origin requests are not permitted" }, { status: 403 });
  const contentType = req.headers.get("content-type");
  if (contentType && !contentType.toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "content-type must be application/json" }, { status: 415 });
  }

  const unavailable = databaseNotReady();
  if (unavailable) return unavailable;
  if (!configuredOperatorToken()) {
    return Response.json({ error: "not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  const result = await issuePublicSession(clientKeyFor(req));

  if ("rateLimited" in result) {
    return Response.json(
      { error: "too many requests — try again shortly" },
      { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } },
    );
  }

  return Response.json(result, { status: 200 });
}
