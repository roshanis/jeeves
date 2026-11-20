import { IllegalTransitionError, type IllegalTransitionKind } from "../lifecycle/transitions";

const STATUS_BY_KIND: Record<IllegalTransitionKind, number> = {
  role: 403,
  state: 409,
  reason: 400,
};

/** Machine-readable reason, so a client can word "already done" differently from a version conflict. */
const CODE_BY_KIND: Record<IllegalTransitionKind, string> = {
  role: "NOT_PERMITTED",
  state: "INVALID_STATE",
  reason: "REASON_REQUIRED",
};

/** The one place that decides which HTTP status an IllegalTransitionError gets. */
export function illegalTransitionStatus(err: IllegalTransitionError): number {
  return STATUS_BY_KIND[err.kind] ?? 403;
}

export function illegalTransitionResponse(err: IllegalTransitionError): Response {
  const code = CODE_BY_KIND[err.kind] ?? CODE_BY_KIND.role;
  return Response.json({ error: err.message, code }, { status: illegalTransitionStatus(err) });
}
