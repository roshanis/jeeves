import { getDb } from "@/lib/db/client";
import { intakePayloadSchema } from "@/lib/services/intake-payload-schema";
import { ConflictError, IllegalTransitionError, NotFoundError, getIntakeDraft, updateIntakeDraft } from "@/lib/services/initiative-service";
import { extractSessionToken, resolveSession, runMutationGuard } from "@/lib/services/route-guard";
import { INTAKE_AUTHOR_ROLES } from "@/lib/services/intake-author-roles";

function failure(error: unknown): Response {
  if (error instanceof NotFoundError) return Response.json({ error: error.message }, { status: 404 });
  if (error instanceof IllegalTransitionError) return Response.json({ error: error.message }, { status: 403 });
  if (error instanceof ConflictError) return Response.json({ error: error.message }, { status: 409 });
  throw error;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await resolveSession(extractSessionToken(req));
  if (!session.actor) return Response.json({ error: "invalid or missing session" }, { status: 401 });
  if (!INTAKE_AUTHOR_ROLES.has(session.actor.role)) return Response.json({ error: "only requesters may edit an intake draft" }, { status: 403 });
  try { return Response.json(await getIntakeDraft(getDb(), (await params).id, session.actor, session.workspaceId)); }
  catch (error) { return failure(error); }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const guard = await runMutationGuard(req, undefined, { allowPublic: true });
  if (!guard.ok) return Response.json({ error: guard.failure.message }, { status: guard.failure.status });
  if (!INTAKE_AUTHOR_ROLES.has(guard.actor.role)) return Response.json({ error: "only requesters may edit an intake draft" }, { status: 403 });
  let body: unknown;
  try {
    const raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > 64_000) return Response.json({ error: "request body exceeds 64000 bytes" }, { status: 413 });
    body = JSON.parse(raw);
  } catch { return Response.json({ error: "invalid JSON body" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "invalid request body" }, { status: 400 });
  const candidate = body as { payload?: unknown; expectedVersion?: unknown };
  const parsed = intakePayloadSchema.safeParse(candidate.payload);
  if (!parsed.success || !Number.isInteger(candidate.expectedVersion) || (candidate.expectedVersion as number) < 1) {
    return Response.json({ error: "invalid intake draft update", issues: parsed.success ? undefined : parsed.error.issues }, { status: 400 });
  }
  try { return Response.json(await updateIntakeDraft(getDb(), { initiativeId: (await params).id, payload: parsed.data, expectedVersion: candidate.expectedVersion as number, actor: guard.actor, workspaceId: guard.workspaceId })); }
  catch (error) { return failure(error); }
}
