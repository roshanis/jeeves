/**
 * Zod schemas for the per-agent structured-output shapes documented in each
 * agent directory's schema.md / instructions.md "Output" sections.
 *
 * These are the load-bearing artifacts `agents/README.md` refers to: the
 * `.md` files are the human-readable spec, but "if they drift, the Zod
 * schema wins at runtime." Both the openai adapter (real `generateText` +
 * `Output.object` calls) and the mock adapter (canned fixtures) are validated
 * against the same schemas here, so the two adapters cannot silently drift
 * apart.
 *
 * Nothing in this file is wired to `AgentPort` directly — `AgentPort`
 * (`lib/agents/ports.ts`) exposes the narrower `DraftReviewOutput` /
 * `TriageAssistOutput` / `CompletenessCheckOutput` shapes. The mapping from
 * this file's richer `ReviewerDraftOutput` down to the port's
 * `DraftReviewOutput` lives in `mapReviewerDraftToPortOutput` below (see
 * `agents/README.md`: "the adapter... is responsible for mapping that
 * richer shape down to the port's DraftReviewOutput").
 */
import { z } from "zod";
import type { DraftReviewOutput, GovernanceDomain } from "./ports";

/* -------------------------------------------------------------------------
 * Reviewer agent — agents/reviewer/schema.md
 * ---------------------------------------------------------------------- */

/**
 * `assessmentMd` is documented as "<= 400 words" (agents/reviewer/schema.md,
 * agents/reviewer/instructions.md). We do not regex-count words (the brief
 * explicitly says not to) — instead we apply a generous soft character-length
 * guard (6000 chars is comfortably above 400 words of markdown with bullets
 * and citations) purely as a sanity backstop against a badly malformed or
 * runaway generation, not as an enforcement of the 400-word guidance itself.
 */
const ASSESSMENT_MD_MAX_LENGTH = 6000;

export const reviewerEvidenceRequestSchema = z.object({
  controlId: z.string().min(1),
  description: z.string().min(1),
});

export const reviewerSuggestedConditionSchema = z.object({
  text: z.string().min(1),
  controlId: z.string().min(1),
});

export const reviewerDraftOutputSchema = z.object({
  assessmentMd: z.string().min(1).max(ASSESSMENT_MD_MAX_LENGTH),
  // No strict citation-format regex: agents/reviewer/instructions.md's
  // citation format ("<Policy ID> §<anchor>") is guidance for the model, not
  // a machine-checkable grammar we should gate structured-output parsing on
  // (Policy IDs and anchors vary per domain/version, e.g. "MP-H v3 §MP-H-2.1"
  // vs. "FL-2026-01 v1 §FL-2.1"). We only require non-empty strings here.
  citations: z.array(z.string().min(1)),
  evidenceRequests: z.array(reviewerEvidenceRequestSchema),
  recommendation: z.enum(["ready-for-signature", "return-with-gaps"]),
  suggestedConditions: z.array(reviewerSuggestedConditionSchema),
  confidenceNotes: z.string(),
});

export type ReviewerDraftOutput = z.infer<typeof reviewerDraftOutputSchema>;

/* -------------------------------------------------------------------------
 * Triage agent — agents/triage/instructions.md "Output"
 * ---------------------------------------------------------------------- */

export const triageFlagExplanationSchema = z.object({
  flag: z.string().min(1),
  answer: z.string().min(1),
  why: z.string().min(1),
});

export const triageRationaleOutputSchema = z.object({
  rationaleMd: z.string().min(1),
  flagExplanations: z.array(triageFlagExplanationSchema),
});

export type TriageRationaleOutput = z.infer<typeof triageRationaleOutputSchema>;

/* -------------------------------------------------------------------------
 * Ops-monitor agent — agents/ops-monitor/instructions.md "Output"
 *
 * NOTE: AgentPort (lib/agents/ports.ts) has exactly three methods —
 * draftReview, triageAssist, checkCompleteness. There is no ops-monitor
 * port method today, so this schema/type is exported for future use (e.g.
 * a WorkflowPort-driven breach-response flow) and is not wired to any
 * AgentPort implementation in lib/agents/mock-adapter.ts or
 * lib/agents/openai-adapter.ts beyond an exported generator function.
 * ---------------------------------------------------------------------- */

/**
 * `suggestedScope` is documented in agents/ops-monitor/instructions.md as
 * `Domain[]` "matching lib/domain/types.ts values" — but per this task's
 * scope we must not create a dependency on lib/domain/types.ts. The value
 * set is identical to `GovernanceDomain` in `./ports` (same eight strings),
 * so we reuse that type/enum here instead of introducing a second import.
 */
export const opsMonitorIncidentOutputSchema = z.object({
  incidentSummaryMd: z.string().min(1),
  suggestedScope: z.array(
    z.enum([
      "legal",
      "procurement",
      "tech-architecture",
      "responsible-ai",
      "security",
      "privacy-hipaa",
      "clinical-safety",
      "data-governance",
    ]),
  ),
  severityNote: z.string(),
});

export type OpsMonitorIncidentOutput = z.infer<
  typeof opsMonitorIncidentOutputSchema
>;

/* -------------------------------------------------------------------------
 * Auditor agent — agents/auditor/instructions.md "Output"
 *
 * Unlike the reviewer agent, there is no rich-to-port mapping step for the
 * auditor: agents/auditor/instructions.md's `AuditorAnswerOutput` IS the
 * port shape (`lib/agents/ports.ts`'s `AuditorAnswerOutput`), verbatim.
 * `ports.ts` re-declares this as its own self-contained interface (matching
 * that file's existing style of not importing from `schemas.ts` — see e.g.
 * `DraftReviewOutput`), and this Zod schema is the runtime validator both
 * adapters check the model/mock output against before returning it through
 * the port. Keep the two declarations in sync by hand; there is no shared
 * source-of-truth type between them (documented judgment call, task brief
 * Task 2).
 * ---------------------------------------------------------------------- */

export const auditorAnswerOutputSchema = z.object({
  // instructions.md: the answer, Markdown, grounded per the citation rule.
  // Even a refusal must populate this (with the refusal text), so a hard
  // min(1) is appropriate — there is no valid empty-answer case.
  answerMd: z.string().min(1),
  // instructions.md: "every event timestamp or decision id you relied on."
  // Empty is valid and expected on a refusal (nothing was relied upon).
  citedEvents: z.array(z.string()),
  // instructions.md: "the CannedAuditQueryId used... as supplied in the
  // input" — explicitly allowed to be an empty string per that wording, so
  // no min(1) here (unlike answerMd).
  queryUsed: z.string(),
});

export type AuditorAnswerOutput = z.infer<typeof auditorAnswerOutputSchema>;

/* -------------------------------------------------------------------------
 * Intake agent — agents/intake/instructions.md "Output"
 *
 * Same no-mapping relationship as the auditor agent above: this schema's
 * `payload` field mirrors `lib/intake/types.ts`'s `IntakePayload` exactly
 * (same section names/field names), but every field is nullable/optional
 * per instructions.md's "partially filled, nulls/empty arrays for anything
 * not yet answered or not yet asked." We do not invent fields beyond what
 * `IntakePayload` declares, and we do not import `IntakePayload` itself
 * (lib/agents has no dependency on lib/intake — the mirrored shape here is
 * this file's own runtime validator, kept in sync with lib/intake/types.ts
 * by hand, the same way ports.ts's interfaces are kept in sync with this
 * file rather than importing it).
 * ---------------------------------------------------------------------- */

const intakeBasicsSchema = z.object({
  title: z.string(),
  sponsorOrg: z.string(),
  requesterName: z.string(),
  requesterEmail: z.string(),
  businessProblem: z.string(),
});

const intakeUseCaseSchema = z.object({
  primaryUsers: z.string(),
  decisionInformed: z.string(),
  expectedVolume: z
    .enum(["<100/mo", "100-1k/mo", "1k-10k/mo", "10k-100k/mo", ">100k/mo"])
    .nullable(),
});

const intakeDataSchema = z.object({
  dataSources: z.array(z.string()),
  phiCategories: z.array(
    z.enum([
      "Demographics",
      "Diagnosis/ICD codes",
      "Medications",
      "Clinical notes/free text",
      "Claims/billing",
      "Lab results",
      "Images",
      "Other",
    ]),
  ),
  phiCategoriesOtherText: z.string().nullable(),
  retentionIntent: z
    .enum([
      "Session-only (no persistence)",
      "<=30 days",
      "<=1 year",
      ">1 year",
      "Indefinite/per-record-schedule",
    ])
    .nullable(),
  retentionIntentNote: z.string().nullable(),
  trainingVsInference: z
    .enum(["Inference-only", "Fine-tuning/training", "Both"])
    .nullable(),
});

const intakeModelVendorSchema = z.object({
  buildOrBuy: z.enum(["Build (internal)", "Buy (vendor)", "Hybrid"]).nullable(),
  vendorName: z.string().nullable(),
  hosting: z.enum(["Vendor-hosted", "Self-hosted (Meridian infra)"]).nullable(),
  modelType: z
    .enum([
      "LLM (generative)",
      "Classical ML / classifier",
      "OCR/extraction",
      "Rules engine",
      "Other",
    ])
    .nullable(),
});

const intakePopulationImpactSchema = z.object({
  affectedPopulations: z.array(z.string()),
  expectedBenefits: z.string().nullable(),
  expectedHarms: z.string().nullable(),
});

const intakeDeploymentSchema = z.object({
  integrationPoints: z.array(z.string()),
  rolloutPlan: z.string().nullable(),
});

/**
 * intake-spec §1(g) overlay questions — booleans, nullable per "never invent
 * an answer" (agents/intake/instructions.md): an unanswered overlay flag is
 * `null`, never coerced to `false`.
 */
const intakeOverlaySchema = z.object({
  touchesPHI: z.boolean().nullable(),
  memberFacing: z.boolean().nullable(),
  careCoverageInfluence: z.boolean().nullable(),
  vendorHosted: z.boolean().nullable(),
  humanInTheLoop: z.boolean().nullable(),
  individualImpact: z.boolean().nullable(),
});

const evidenceAttachmentSchema = z.object({
  controlId: z.string(),
  fileName: z.string(),
  uploadedAt: z.string(),
});

/**
 * Mirrors `IntakePayload` (lib/intake/types.ts) field-for-field. All string
 * fields are permitted to be empty strings (not just `z.string().min(1)`)
 * since an unasked/unanswered text field is documented as "" or null across
 * this codebase's own conventions (e.g. mock-adapter.ts's hasRetentionAnswer
 * treats an empty string the same as absent).
 */
export const intakePayloadSchema = z.object({
  basics: intakeBasicsSchema,
  useCase: intakeUseCaseSchema,
  data: intakeDataSchema,
  modelVendor: intakeModelVendorSchema,
  populationImpact: intakePopulationImpactSchema,
  deployment: intakeDeploymentSchema,
  overlay: intakeOverlaySchema,
  evidenceAttachments: z.array(evidenceAttachmentSchema),
});

const intakeGapSchema = z.object({
  ruleId: z.string(),
  field: z.string(),
  level: z.enum(["BLOCKING", "REQUIRED-FOR-TIER", "ADVISORY"]),
});

export const intakeInterviewOutputSchema = z.object({
  payload: intakePayloadSchema,
  gaps: z.array(intakeGapSchema),
  // instructions.md: "Conversational text you want the requester to
  // actually see... belongs in followUpQuestions" — an empty array is valid
  // once every field/overlay question has been answered (see mock-adapter's
  // closing-acknowledgment convention).
  followUpQuestions: z.array(z.string()),
});

export type IntakeInterviewOutput = z.infer<typeof intakeInterviewOutputSchema>;

/* -------------------------------------------------------------------------
 * Reviewer rich-shape -> port-shape mapping (agents/README.md)
 * ---------------------------------------------------------------------- */

/**
 * Maps the rich `ReviewerDraftOutput` (what the reviewer agent actually
 * returns) down to the stable `DraftReviewOutput` port shape
 * (`lib/agents/ports.ts`). Used by both the openai adapter and the mock
 * adapter so the mapping logic — and its judgment calls — live in exactly
 * one place.
 *
 * Judgment calls (documented per agents/README.md's request that the port
 * stay stable even as the richer per-agent schema gains fields):
 *
 * 1. `domain` is passed through from the caller's input, not re-derived from
 *    the rich output (the rich schema doesn't carry `domain` itself).
 *
 * 2. `draftMarkdown` = `rich.assessmentMd`, optionally with an appended
 *    "## Evidence requests" bullet section when `evidenceRequests` is
 *    non-empty. This keeps the human-editable draft self-contained (a
 *    reviewer editing `draftMarkdown` alone still sees the gaps) without
 *    duplicating the full structured `evidenceRequests` data model inside
 *    the markdown — the port's own `missingEvidence` array remains the
 *    structured source of truth for gaps.
 *
 * 3. `recommendation` mapping:
 *      - "ready-for-signature"  -> "recommend-sign-off"
 *      - "return-with-gaps"     -> "recommend-conditional" when
 *        `suggestedConditions` is non-empty (a populated suggestedConditions
 *        array signals the domain's policy text supports conditional
 *        approval for this fact pattern per instructions.md's "Suggested
 *        conditions" section), else "recommend-return".
 *    "return-with-gaps" never maps to "recommend-sign-off" — the rich
 *    schema's binary vocabulary is deliberately coarser than the port's
 *    three-way recommendation, and conditional-vs-return is inferred from
 *    whether the agent populated suggestedConditions at all.
 *
 * 4. `suggestedConditions` (port: `string[]`) = `rich.suggestedConditions`
 *    mapped to just `.text`, dropping `controlId`. The port's
 *    `suggestedConditions` is documented as plain human-readable strings;
 *    `controlId` is retained on the rich shape for traceability but the
 *    port doesn't have a slot for it, so it is intentionally dropped here
 *    rather than concatenated into the text (keeps each condition string
 *    exactly what a human approver would read/adopt verbatim).
 *
 * 5. `missingEvidence` (port: `string[]`) = `rich.evidenceRequests` mapped
 *    to just `.description`, dropping `controlId` for the same reason as
 *    (4) — the port's `missingEvidence` is documented as "Evidence the
 *    agent could not find," a flat human-readable list, not a structured
 *    per-control record. `controlId` remains available on the rich shape
 *    (and, per (2), can still be surfaced in `draftMarkdown`'s prose) for
 *    any caller that wants it before mapping down to the port.
 */
export function mapReviewerDraftToPortOutput(
  domain: GovernanceDomain,
  rich: ReviewerDraftOutput,
): DraftReviewOutput {
  const evidenceSection =
    rich.evidenceRequests.length > 0
      ? `\n\n## Evidence requests\n${rich.evidenceRequests
          .map((r) => `- ${r.description}`)
          .join("\n")}`
      : "";

  const recommendation: DraftReviewOutput["recommendation"] =
    rich.recommendation === "ready-for-signature"
      ? "recommend-sign-off"
      : rich.suggestedConditions.length > 0
        ? "recommend-conditional"
        : "recommend-return";

  return {
    domain,
    draftMarkdown: `${rich.assessmentMd}${evidenceSection}`,
    recommendation,
    suggestedConditions: rich.suggestedConditions.map((c) => c.text),
    missingEvidence: rich.evidenceRequests.map((r) => r.description),
  };
}
