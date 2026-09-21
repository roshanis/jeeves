/** Model-output schemas and the mapping into application-owned agent results. */
import { z } from "zod";
import { intakeModelPayloadSchema } from "@/lib/intake/schema";
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
 * Intake interview — shared save/create bounds with explicit nullable answers
 * for strict model output (persistence also accepts legacy omitted answers).
 * ---------------------------------------------------------------------- */

const intakeGapSchema = z.object({
  ruleId: z.string(),
  field: z.string(),
  level: z.enum(["BLOCKING", "REQUIRED-FOR-TIER", "ADVISORY"]),
});

export const intakeInterviewOutputSchema = z.object({
  payload: intakeModelPayloadSchema,
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

/** Preserve policy citations separately and retain reviewer context in the saved Markdown. */
export function mapReviewerDraftToPortOutput(
  domain: GovernanceDomain,
  rich: ReviewerDraftOutput,
): DraftReviewOutput {
  const sections = [rich.assessmentMd];
  if (rich.evidenceRequests.length > 0) {
    sections.push(`## Evidence requests\n${rich.evidenceRequests
      .map((request) => `- ${request.controlId}: ${request.description}`)
      .join("\n")}`);
  }
  if (rich.suggestedConditions.length > 0) {
    sections.push(`## Suggested conditions\n${rich.suggestedConditions
      .map((condition) => `- ${condition.controlId}: ${condition.text}`)
      .join("\n")}`);
  }
  if (rich.confidenceNotes.trim()) {
    sections.push(`## Confidence notes\n${rich.confidenceNotes}`);
  }

  const recommendation: DraftReviewOutput["recommendation"] =
    rich.recommendation === "ready-for-signature"
      ? "recommend-sign-off"
      : rich.suggestedConditions.length > 0
        ? "recommend-conditional"
        : "recommend-return";

  return {
    domain,
    citations: [...rich.citations],
    draftMarkdown: sections.join("\n\n"),
    recommendation,
    suggestedConditions: rich.suggestedConditions.map((c) => c.text),
    missingEvidence: rich.evidenceRequests.map((r) => r.description),
  };
}
