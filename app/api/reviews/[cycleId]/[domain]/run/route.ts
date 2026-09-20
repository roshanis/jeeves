/** Reviewer execution shares the fan-out claim, deadline, and reservation policy. */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { draftBudgetPolicy } from "@/lib/workflow/draft-execution-policy";
import { ReviewIntegrityError } from "@/lib/services/review-integrity";
import { getDb } from "@/lib/db/client";
import {
  ConflictError,
  IllegalTransitionError,
  NotFoundError,
  ValidationError,
  runReviewAgent,
} from "@/lib/services/initiative-service";
import { runMutationGuard } from "@/lib/services/route-guard";
import type { Domain } from "@/lib/domain/types";

const DOMAINS = [
  "legal",
  "procurement",
  "tech-architecture",
  "responsible-ai",
  "security",
  "privacy-hipaa",
  "clinical-safety",
  "data-governance",
] as const;

const bodySchema = z.object({ expectedRevision: z.number().int().nonnegative().optional() });

export async function POST(
  req: Request,
  context: { params: Promise<{ cycleId: string; domain: string }> },
): Promise<Response> {
  const guard = await runMutationGuard(req, undefined);
  if (!guard.ok) {
    return Response.json({ error: guard.failure.message }, { status: guard.failure.status });
  }

  const { cycleId, domain } = await context.params;
  if (!(DOMAINS as readonly string[]).includes(domain)) {
    return Response.json({ error: "unknown domain" }, { status: 400 });
  }

  // Older clients send no body; any provided revision is still checked atomically.
  let json: unknown;
  try { const text = await req.text(); json = text ? JSON.parse(text) : {}; }
  catch { return Response.json({ error: "invalid draft request" }, { status: 400 }); }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return Response.json({ error: "invalid draft request" }, { status: 400 });
  const db = getDb();
  try {
    const result = await runReviewAgent(db, cycleId, domain as Domain, guard.actor, guard.workspaceId, undefined, {
      ...parsed.data, budget: draftBudgetPolicy(), signal: req.signal,
    });
    if (result.errorKind === "budget-exhausted") return Response.json(result, { status: 429 });
    return Response.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof ConflictError) return Response.json({ error: err.message }, { status: 409 });
    if (err instanceof IllegalTransitionError) {
      return Response.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof NotFoundError) {
      return Response.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof ValidationError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof ReviewIntegrityError) {
      return Response.json({ error: err.message }, { status: err.kind === "not_found" ? 404 : 409 });
    }
    return Response.json({ error: "Draft execution could not be completed. Refresh its status before retrying.", requestId: randomUUID() }, { status: 500 });
  }
}
