/**
 * POST /api/initiatives — create a new intake draft (task brief deliverable 3).
 *
 * Auth: session required (Bearer token or `jeeves_session` cookie), role
 * must be `requester` — enforced by `createDraft` receiving the resolved
 * session actor unchanged; requester name is looked up server-side too.
 *
 * Body:  { payload: IntakePayload }  — see lib/services/intake-payload-schema.ts
 * 200:   { initiativeId: string, slug: string, intakeVersionId: string }
 * 400:   { error: string, gaps?: InputGap[] }
 * 401:   { error: string }
 * 429:   { error: string, retryAfterSeconds?: number }
 */
import { getDb } from "@/lib/db/client";
import { createDraft } from "@/lib/services/initiative-service";
import { intakePayloadSchema } from "@/lib/services/intake-payload-schema";
import { runMutationGuard } from "@/lib/services/route-guard";
import { ACTOR_DIRECTORY, isPersonaKey } from "@/lib/services/actors";
import type { PersonaKey } from "@/lib/services/actors";

export async function POST(req: Request): Promise<Response> {
  const guard = await runMutationGuard(req, undefined);
  if (!guard.ok) {
    return Response.json({ error: guard.failure.message }, { status: guard.failure.status });
  }

  if (guard.actor.role !== "requester") {
    return Response.json({ error: "only requesters may create an intake draft" }, { status: 403 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const body = json as { payload?: unknown };
  const parsed = intakePayloadSchema.safeParse(body.payload);
  if (!parsed.success) {
    return Response.json({ error: "invalid intake payload", issues: parsed.error.issues }, { status: 400 });
  }

  const requesterName = isPersonaKey(guard.actor.id)
    ? ACTOR_DIRECTORY[guard.actor.id as PersonaKey].name
    : guard.actor.id;

  const db = getDb();
  const result = await createDraft(db, {
    payload: parsed.data,
    requesterActor: guard.actor,
    requesterName,
    workspaceId: guard.workspaceId,
  });

  return Response.json(result, { status: 200 });
}
