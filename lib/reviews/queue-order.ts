type QueueStatus = "pending" | "drafted" | "signed" | "returned" | "abstained";

interface QueueRowLike {
  slug: string;
  review: { status: QueueStatus; cycleOpen?: boolean };
}

/**
 * A review that was never signed or abstained and whose cycle has since
 * closed (a conditional approval, rejection or later decision closes the
 * cycle). It can no longer be signed, returned or resumed, so it is not work.
 */
export function isClosedUnsigned(review: { status: QueueStatus; cycleOpen?: boolean }): boolean {
  return review.cycleOpen === false && review.status !== "signed" && review.status !== "abstained";
}

const STATUS_ORDER: Record<QueueStatus, number> = { returned: 0, drafted: 1, pending: 2, abstained: 3, signed: 4 };

/** Blocked and incomplete reviews first, completed ones next, dead rows of closed cycles last. */
export function sortReviewQueue<T extends QueueRowLike>(rows: T[]): T[] {
  return rows.slice().sort(
    (a, b) =>
      Number(isClosedUnsigned(a.review)) - Number(isClosedUnsigned(b.review)) ||
      STATUS_ORDER[a.review.status] - STATUS_ORDER[b.review.status] ||
      a.slug.localeCompare(b.slug),
  );
}
