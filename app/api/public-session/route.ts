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
 * 429:   { error }  (per-client mint ceiling — the rate at which one caller
 *                    can acquire identities, and so write rows)
 */
import { clientKeyFor, issuePublicSession } from "@/lib/services/route-guard";

export async function POST(req: Request): Promise<Response> {
  const result = await issuePublicSession(clientKeyFor(req));

  if ("rateLimited" in result) {
    return Response.json(
      { error: "too many requests — try again shortly" },
      { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } },
    );
  }

  return Response.json(result, { status: 200 });
}
