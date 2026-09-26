/**
 * GET /api/public-intake — the operator's queue of real inbound requests.
 *
 * Gated by OPERATOR_TOKEN (`Authorization: Bearer <token>`), deliberately NOT
 * by persona role. The passwordless playground gives any visitor any persona
 * in one click — Program Office and Admin included — so a role-gated queue
 * would show every stranger's request (name, email, what they typed) to every
 * other stranger. The operator token is a server-side secret held only by
 * whoever runs the site.
 *
 * Lists only submissions made through the "Send a real request" path (public
 * sessions, `public-` workspaces). Playground role-play never appears here.
 *
 * 200:   PublicSubmissionRow[]
 * 401:   missing or wrong operator token (persona sessions included)
 * 404:   no operator token configured — the queue is off, not merely locked
 * 429:   too many failed attempts from this client
 */
import { getDb } from "@/lib/db/client";
import { listPublicSubmissions } from "@/lib/services/public-intake-service";
import {
  checkOperatorAttempt,
  clientKeyFor,
  configuredOperatorToken,
  isOperatorAuthorized,
} from "@/lib/services/route-guard";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(req: Request): Promise<Response> {
  const expected = configuredOperatorToken();
  if (!expected) {
    return Response.json({ error: "not found" }, { status: 404, headers: NO_STORE });
  }

  if (!isOperatorAuthorized(req.headers.get("authorization"), expected)) {
    // Only failures spend the bucket, so a correct operator is never locked
    // out by their own refreshes.
    const attempt = await checkOperatorAttempt(clientKeyFor(req));
    if (!attempt.allowed) {
      return Response.json(
        { error: "too many attempts — try again later" },
        { status: 429, headers: { ...NO_STORE, "Retry-After": String(attempt.retryAfterSeconds) } },
      );
    }
    return Response.json({ error: "operator token required" }, { status: 401, headers: NO_STORE });
  }

  return Response.json(await listPublicSubmissions(getDb()), { status: 200, headers: NO_STORE });
}
