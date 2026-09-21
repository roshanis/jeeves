// Checked by `tsc --noEmit`; these are type contracts, not runtime simulations.
import type { DraftReviewOutput } from "@/lib/agents/ports";

type Assert<T extends true> = T;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

export type RecommendationContract = Assert<Same<DraftReviewOutput["recommendation"], "recommend-sign-off" | "recommend-conditional" | "recommend-return">>;
