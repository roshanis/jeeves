import { IllegalTransitionError, type IllegalTransitionKind } from "../lifecycle/transitions";

const STATUS_BY_KIND: Record<IllegalTransitionKind, number> = {
  role: 403,
  state: 409,
  reason: 400,
};

/** The one place that decides which HTTP status an IllegalTransitionError gets. */
export function illegalTransitionStatus(err: IllegalTransitionError): number {
  return STATUS_BY_KIND[err.kind] ?? 403;
}

export function illegalTransitionResponse(err: IllegalTransitionError): Response {
  return Response.json({ error: err.message }, { status: illegalTransitionStatus(err) });
}
