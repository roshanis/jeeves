/**
 * POST /api/chat/intake — conversational intake interviewer chat (M2 —
 * plan.md §13 Breadth; agents/intake/instructions.md). The conversational
 * alternative to the M1 structured intake form (docs/intake-spec.md),
 * producing the same `IntakePayload` shape by conversation instead of form
 * fields.
 *
 * Session-gated for the requester persona specifically (task brief: "Session-
 * gated (requester)"). `runMutationGuard` itself has no role-restriction
 * mechanism — it returns `actor: Actor` and leaves role-checking to the
 * caller (the same "guard first, then role-check in the route/service
 * layer" pattern app/api/admin/threshold/route.ts's underlying
 * admin-service.ts uses, checking `actor.role !== "admin"` after the shared
 * guard). Here we check `actor.role !== "requester"` after the guard and
 * 403 otherwise.
 *
 * Body:  { conversation: {role: "user"|"assistant", content: string}[], partialPayload: object }
 * 200:   { reply: string, updatedPayload: object, gaps: CompletenessGap[], done: boolean }
 * 401:   { error: string }  (no/invalid session)
 * 403:   { error: string }  (non-requester persona)
 * 429:   { error: string }  (rate limit or demo token budget exhausted)
 * 400:   { error: string }  (malformed body / input-size cap exceeded)
 * 502/504/499: as app/api/chat/auditor/route.ts's PortFailure mapping.
 */
import { z } from "zod";
import { getAgentPort } from "@/lib/agents";
import type { PortFailure } from "@/lib/agents/ports";
import { evaluateCompleteness } from "@/lib/intake/completeness";
import type { IntakePayload } from "@/lib/intake/types";
import { runMutationGuard } from "@/lib/services/route-guard";

const MAX_MESSAGES = 50;
const MAX_MESSAGE_CHARS = 4000;

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(MAX_MESSAGE_CHARS),
});

const bodySchema = z.object({
  conversation: z.array(messageSchema).max(MAX_MESSAGES),
  partialPayload: z.record(z.string(), z.unknown()),
});

/** Rough token estimate for one intake-interview turn — sizes the budget reservation only. */
const ESTIMATED_TOKENS = 600;
const AGENT_TIMEOUT_MS = 10_000;

function statusForFailure(error: PortFailure): number {
  switch (error.kind) {
    case "validation":
      return 400;
    case "provider":
      return 502;
    case "timeout":
      return 504;
    case "cancelled":
      // Same judgment call as app/api/chat/auditor/route.ts: 499, not 500 —
      // a cancelled invocation reflects a caller-initiated abort, never a
      // server-side bug.
      return 499;
    case "budget-exhausted":
      // Defensive only — budget is already reserved via runMutationGuard
      // before the agent is ever called.
      return 429;
  }
}

/**
 * The port only returns a PARTIAL payload (nulls for unanswered fields) —
 * `evaluateCompleteness` (lib/intake/completeness.ts) is written against the
 * full `IntakePayload` shape but every one of its rule checks already
 * tolerates `null`/empty-array field values (that IS the completeness model:
 * a null field simply fails its rule and becomes a gap). So the port's
 * returned payload, once merged onto a fully-shaped-but-empty scaffold, can
 * be treated as an `IntakePayload` directly for evaluation purposes without
 * inventing any values — this function only fills in the shape's structural
 * skeleton (empty sections) where the port omitted a whole section, never a
 * field-level value.
 */
function coerceToIntakePayload(portPayload: Readonly<Record<string, unknown>>): IntakePayload {
  const empty: IntakePayload = {
    basics: {
      title: "",
      sponsorOrg: "",
      requesterName: "",
      requesterEmail: "",
      businessProblem: "",
    },
    useCase: { primaryUsers: "", decisionInformed: "", expectedVolume: null },
    data: {
      dataSources: [],
      phiCategories: [],
      phiCategoriesOtherText: null,
      retentionIntent: null,
      retentionIntentNote: null,
      trainingVsInference: null,
    },
    modelVendor: { buildOrBuy: null, vendorName: null, hosting: null, modelType: null },
    populationImpact: { affectedPopulations: [], expectedBenefits: null, expectedHarms: null },
    deployment: { integrationPoints: [], rolloutPlan: null },
    overlay: {
      touchesPHI: null,
      memberFacing: null,
      careCoverageInfluence: null,
      vendorHosted: null,
      humanInTheLoop: null,
      individualImpact: null,
    },
    evidenceAttachments: [],
  };

  return {
    basics: { ...empty.basics, ...(portPayload.basics as object | undefined) },
    useCase: { ...empty.useCase, ...(portPayload.useCase as object | undefined) },
    data: { ...empty.data, ...(portPayload.data as object | undefined) },
    modelVendor: { ...empty.modelVendor, ...(portPayload.modelVendor as object | undefined) },
    populationImpact: {
      ...empty.populationImpact,
      ...(portPayload.populationImpact as object | undefined),
    },
    deployment: { ...empty.deployment, ...(portPayload.deployment as object | undefined) },
    overlay: { ...empty.overlay, ...(portPayload.overlay as object | undefined) },
    evidenceAttachments: Array.isArray(portPayload.evidenceAttachments)
      ? (portPayload.evidenceAttachments as IntakePayload["evidenceAttachments"])
      : empty.evidenceAttachments,
  };
}

export async function POST(req: Request): Promise<Response> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  // Flatten the conversation's message contents into one string field so
  // runMutationGuard's input-size validation (which only checks flat string
  // fields, per lib/security/input-limits.ts) can cap total conversation
  // size — mirrors app/api/admin/threshold/route.ts's bodyText composition
  // pattern for a route whose real body isn't itself a flat string map.
  const conversationRaw = (json as { conversation?: unknown })?.conversation;
  const flattenedConversation = Array.isArray(conversationRaw)
    ? conversationRaw
        .map((m) => (typeof (m as { content?: unknown })?.content === "string" ? (m as { content: string }).content : ""))
        .join("\n")
    : "";

  const bodyText: Record<string, string> = { conversation: flattenedConversation };

  const guard = await runMutationGuard(req, bodyText, {
    inputLimits: [{ field: "conversation", maxChars: MAX_MESSAGES * MAX_MESSAGE_CHARS }],
    inputTotalCap: MAX_MESSAGES * MAX_MESSAGE_CHARS,
    requiresBudget: true,
    estimatedTokens: ESTIMATED_TOKENS,
  });
  if (!guard.ok) {
    return Response.json({ error: guard.failure.message }, { status: guard.failure.status });
  }

  // Guard-first, then role-check (app/api/admin/threshold/route.ts's
  // underlying admin-service.ts precedent) — role always comes from the
  // session-resolved actor, never from the request body.
  if (guard.actor.role !== "requester") {
    return Response.json({ error: "only the requester persona may use the intake chat" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "invalid request body" }, { status: 400 });
  }

  const port = getAgentPort();
  const result = await port.intakeInterview(
    {
      conversation: parsed.data.conversation,
      partialPayload: parsed.data.partialPayload,
    },
    { timeoutMs: AGENT_TIMEOUT_MS },
  );

  if (!result.ok) {
    const message = "message" in result.error ? result.error.message : result.error.kind;
    return Response.json({ error: message }, { status: statusForFailure(result.error) });
  }

  const updatedPayload = coerceToIntakePayload(result.value.payload);
  const completeness = evaluateCompleteness(updatedPayload);

  // "done" semantics (judgment call, documented per task brief): the
  // intake-spec §2 completeness model gates initial submit on BLOCKING rules
  // only (REQUIRED-FOR-TIER and ADVISORY never block) — so we mirror that
  // exact precedent here: the conversational interview is "done" once there
  // are no remaining BLOCKING-level gaps, matching evaluateCompleteness's
  // own `canSubmit` semantics (canSubmit === no BLOCKING gaps). We reuse
  // `canSubmit` directly rather than re-deriving it from `gaps` to guarantee
  // the two can never drift apart.
  const done = completeness.canSubmit;

  const reply = result.value.followUpQuestions.join(" ");

  return Response.json(
    {
      reply,
      updatedPayload,
      gaps: completeness.gaps,
      done,
    },
    { status: 200 },
  );
}
