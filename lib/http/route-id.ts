/**
 * Dynamic route params (`[id]`, `[cycleId]`, `[domain]`) reach SQL as bound
 * text. U+0000 is not storable in Postgres text and fails as a 500, so a param
 * that is not a plain identifier is answered 404 at the route. Accepts every
 * existing id shape (init-<hex>, cycle-<uuid>, init-4, exc-seed-hr-r01, dep-..., rd-...).
 */
export function isRouteId(value: string): boolean {
  return /^[A-Za-z0-9_.:-]{1,200}$/.test(value);
}

export const notFoundResponse = (): Response => Response.json({ error: "not found" }, { status: 404 });
