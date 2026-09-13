/**
 * GET /api/public-intake — the queue of passcode-free submissions.
 *
 * Program Office and Admin only. This is the one place public submissions
 * become visible, and it is deliberately NOT part of the server-rendered
 * console: those pages scope reads by the workspace cookie, which carries no
 * role, so putting the queue there would have shown every stranger's
 * submission to every other stranger. The session token does carry a role,
 * so the queue is read through it.
 *
 * 200:   PublicSubmissionRow[]
 * 401:   no session
 * 403:   a session without the Program Office / Admin role
 */
import { getDb } from "@/lib/db/client";
import { listPublicSubmissions } from "@/lib/services/public-intake-service";
import { extractSessionToken, resolveSession } from "@/lib/services/route-guard";

const QUEUE_READER_ROLES: ReadonlySet<string> = new Set(["program", "admin"]);

export async function GET(req: Request): Promise<Response> {
  const session = await resolveSession(extractSessionToken(req));
  if (!session.actor) {
    return Response.json({ error: "invalid or missing session" }, { status: 401 });
  }
  if (!QUEUE_READER_ROLES.has(session.actor.role)) {
    return Response.json(
      { error: "only the program office may read the public intake queue" },
      { status: 403 },
    );
  }

  return Response.json(await listPublicSubmissions(getDb()), { status: 200 });
}
