/**
 * Control-exception collection endpoint (M4).
 *
 * GET  /api/exceptions            — public read-only list (optionally ?status=)
 * POST /api/exceptions            — request a new exception (session required).
 *   Body: { effectiveControlId: string, reason: string }
 *   200: { id, controlId, status: "requested", expiresAt }
 *   401/429/400 as other mutating routes; 404 unknown control.
 */
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { runMutationGuard } from "@/lib/services/route-guard";
import {
  listExceptions,
  requestException,
  type ExceptionStatus,
} from "@/lib/services/exception-service";
import { NotFoundError, ValidationError, IllegalTransitionError } from "@/lib/services/initiative-service";

const REASON_MAX = 2_000;

const bodySchema = z.object({
  effectiveControlId: z.string().min(1).max(200),
  reason: z.string().min(1).max(REASON_MAX),
});

const STATUSES: ExceptionStatus[] = ["requested", "approved", "rejected", "revoked", "expired"];

export async function GET(req: Request): Promise<Response> {
  const statusParam = new URL(req.url).searchParams.get("status");
  const status = statusParam && (STATUSES as string[]).includes(statusParam)
    ? (statusParam as ExceptionStatus)
    : undefined;
  const exceptions = await listExceptions(getDb(), status);
  return Response.json({ exceptions }, { status: 200 });
}

export async function POST(req: Request): Promise<Response> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    json = {};
  }
  const bodyText: Record<string, string> =
    typeof (json as { reason?: unknown })?.reason === "string"
      ? { reason: (json as { reason: string }).reason }
      : {};

  const guard = await runMutationGuard(req, bodyText, {
    inputLimits: [{ field: "reason", maxChars: REASON_MAX }],
    inputTotalCap: REASON_MAX,
  });
  if (!guard.ok) {
    return Response.json({ error: guard.failure.message }, { status: guard.failure.status });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "invalid request body" }, { status: 400 });
  }

  try {
    const result = await requestException(getDb(), parsed.data.effectiveControlId, guard.actor, parsed.data.reason);
    return Response.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof IllegalTransitionError) return Response.json({ error: err.message }, { status: 403 });
    if (err instanceof NotFoundError) return Response.json({ error: err.message }, { status: 404 });
    if (err instanceof ValidationError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
