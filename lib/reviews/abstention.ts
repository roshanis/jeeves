import type { auditEvents, reviewDecisions } from "../db/schema";

export type ResumableReviewStatus = "pending" | "drafted" | "returned";
export function isResumableReviewStatus(status: unknown): status is ResumableReviewStatus {
  return status === "pending" || status === "drafted" || status === "returned";
}

/** A resume must use the receipt for this exact row revision, never infer a state from retained text. */
export function currentAbstention(
  review: typeof reviewDecisions.$inferSelect,
  events: readonly (typeof auditEvents.$inferSelect)[],
) {
  if (review.status !== "abstained") return null;
  const matches = events.filter((event) => event.action === "review_abstained" &&
    event.after === "abstained" && event.actorRole === "reviewer" && event.actor === review.reviewer &&
    event.metadata?.reviewDecisionId === review.id && event.metadata?.cycleId === review.cycleId &&
    event.metadata?.domain === review.domain && event.metadata?.revision === review.revision);
  const event = matches.length === 1 ? matches[0] : undefined;
  const reason = event?.metadata?.reason;
  if (!event || !isResumableReviewStatus(event.before) || typeof reason !== "string" || !reason.trim() || reason.length > 2000) return null;
  return { reason, reviewer: event.actor, at: event.ts.toISOString(), priorStatus: event.before, eventId: event.id };
}
