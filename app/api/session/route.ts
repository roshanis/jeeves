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

  const expected = process.env.DEMO_PASSCODE ?? "";
  const result = await issueDemoSession(parsed.data.passcode, expected, parsed.data.personaKey);
  if (!result) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  return Response.json(result, { status: 200 });
}
