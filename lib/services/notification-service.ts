/**
 * Review-request notifications — telling a domain it has been asked.
 *
 * `triage()` fans out one pending review per required domain, so a Critical
 * initiative asks all eight at once. Nothing ever told them. A review row
 * appeared in a queue and waited to be noticed; there was no notification
 * transport anywhere in the codebase. That is the gap between "Legal has
 * been asked" and "Legal knows they were asked".
 *
 * TWO THINGS THIS DELIBERATELY IS NOT:
 *
 * 1. It does not send anything. There is no configured transport, and
 *    inventing one would mean a demo that claims to have emailed Legal while
 *    nothing left the process. This repo already holds that line elsewhere —
 *    the telemetry connector card reports "not configured" rather than
 *    pretending — and `deliveryTransportStatus()` below is the same
 *    admission, surfaced in the UI.
 *
 * 2. It is not a queue worker. `enqueueReviewRequests` is called INSIDE the
 *    transaction that creates the review rows, on purpose: the invariant is
 *    that a review cannot exist without a recorded request for it. A
 *    fire-and-forget send after commit would be able to lose the ask while
 *    keeping the review, which is the failure mode that makes a governance
 *    queue quietly stall.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Db } from "../db/client";
import { reviewNotifications } from "../db/schema";
import type { Domain, Tier } from "../domain/types";
import { DOMAIN_LABEL } from "../domain/labels";

/** The only kind today. Named so a nudge or a return-for-rework can reuse the table. */
export const REVIEW_REQUESTED = "review_requested" as const;

export interface ReviewNotificationRow {
  id: string;
  initiativeId: string;
  cycleId: string;
  domain: string;
  kind: string;
  subject: string;
  body: string;
  createdAt: Date;
  deliveredAt: Date | null;
  deliveryChannel: string | null;
}

/** Anything with the transactional methods used here — a Db or a tx handle. */
type Writable = Pick<Db, "insert">;

export interface EnqueueArgs {
  initiativeId: string;
  initiativeTitle: string;
  cycleId: string;
  domains: readonly Domain[];
  tier: Tier;
  /** Injected so the caller's clock (and tests) stay authoritative. */
  now: number;
}

/**
 * Records one request per domain. Call inside the transaction that creates
 * the review rows.
 *
 * Idempotent per (cycle, domain, kind) via the unique index, matching
 * `triage()`'s own re-runnability: a retry must not queue a second ask.
 */
export async function enqueueReviewRequests(
  tx: Writable,
  args: EnqueueArgs,
): Promise<void> {
  if (args.domains.length === 0) return;

  const at = new Date(args.now);
  for (const domain of args.domains) {
    const label = DOMAIN_LABEL[domain] ?? domain;
    await tx
      .insert(reviewNotifications)
      .values({
        id: `rn-${randomUUID()}`,
        initiativeId: args.initiativeId,
        cycleId: args.cycleId,
        domain,
        kind: REVIEW_REQUESTED,
        // Rendered now, not at read time: the ask should read as it did when
        // it was made, even if the initiative has since moved on.
        subject: `${label} review requested: ${args.initiativeTitle}`,
        body:
          `${label} review is required for "${args.initiativeTitle}" ` +
          `(risk tier: ${args.tier}). It is one of ${args.domains.length} ` +
          `domain review${args.domains.length === 1 ? "" : "s"} opened together — ` +
          `they are independent, so this one does not wait on the others. ` +
          `An agent may draft it; a human signs it.`,
        createdAt: at,
        deliveredAt: null,
        deliveryChannel: null,
      })
      // Re-running triage re-attempts only unfinished domains; the ask is
      // already on file, so a conflict is the expected, correct outcome.
      .onConflictDoNothing();
  }
}

/** A single domain's outstanding asks — the reviewer's own view. */
export async function pendingNotificationsForDomain(
  db: Db,
  domain: Domain,
): Promise<ReviewNotificationRow[]> {
  return db
    .select()
    .from(reviewNotifications)
    .where(
      and(eq(reviewNotifications.domain, domain), isNull(reviewNotifications.deliveredAt)),
    )
    .orderBy(asc(reviewNotifications.createdAt)) as Promise<ReviewNotificationRow[]>;
}

/**
 * Everything not yet delivered — the operator view. With no transport
 * configured this is every notification ever recorded, which is the honest
 * picture: these are asks that exist in the system and have reached nobody
 * outside it.
 */
export async function undeliveredNotifications(db: Db): Promise<ReviewNotificationRow[]> {
  return db
    .select()
    .from(reviewNotifications)
    .where(isNull(reviewNotifications.deliveredAt))
    .orderBy(asc(reviewNotifications.createdAt)) as Promise<ReviewNotificationRow[]>;
}

export interface TransportStatus {
  configured: boolean;
  channel: string | null;
  detail: string;
}

/**
 * What the UI must say about delivery.
 *
 * Hard-coded unconfigured, because it is: there is no SMTP client, webhook
 * client or queue in this codebase. When a transport is added, this is the
 * one place that decides whether the UI may claim delivery — and it should
 * report `configured: true` only when something can actually send.
 */
export function deliveryTransportStatus(): TransportStatus {
  return {
    configured: false,
    channel: null,
    detail:
      "No delivery transport is configured — review requests are recorded and " +
      "shown in-app, but nothing is emailed or posted anywhere.",
  };
}
