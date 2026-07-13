/**
 * /promotions — RL-checkpoint promotion queue (plan.md M3) + M3 promotion-
 * view extensions (deployment-version history, eval comparison, rollback).
 *
 * Server component wrapper: fetches deployment-version history for every
 * seeded initiative directly via `promotion-service.ts#deploymentHistory` +
 * `getDb()` (this module's own DB-only service, same pattern the existing
 * promote route already uses — unaffected by the DATA_PROVIDER mock/db
 * selector, since `getDb()` is a process-wide-memoized handle, not the
 * DataProvider abstraction; see report for the coherence reasoning). The eval
 * series per initiative comes from the read-model DataProvider
 * (`getAppProvider().getInitiativeDetail`), since that's where telemetry
 * already lives (dto.ts#TelemetrySeries).
 *
 * The actual promotion QUEUE (which checkpoints await sign-off) is still
 * fetched client-side via `listPromotions()` in `PromotionsPageClient`
 * (unchanged from the original implementation) — this wrapper only adds the
 * server-fetched history/eval context, keyed by initiativeId, as a prop.
 */
import { getDb } from "@/lib/db/client";
import { deploymentHistory, type DeploymentHistoryEntry } from "@/lib/services/promotion-service";
import { getAppProvider } from "@/app/_lib/data-provider";
import type { TelemetrySeries } from "@/lib/data/dto";
import { PromotionsPageClient } from "./promotions-page-client";

export interface InitiativeHistoryContext {
  history: DeploymentHistoryEntry[];
  evalSeries: TelemetrySeries | null;
}

export default async function PromotionsPage() {
  const provider = getAppProvider();
  const db = getDb();

  const summaries = await provider.listInitiatives();

  const entries = await Promise.all(
    summaries
      .filter((s): s is typeof s & { initiativeId: string } => !!s.initiativeId)
      .map(async (s) => {
        const [history, detail] = await Promise.all([
          deploymentHistory(db, s.initiativeId),
          provider.getInitiativeDetail(s.slug),
        ]);
        const evalSeries =
          detail?.telemetry.find(
            (t) => t.kind === "eval_hallucination" || t.kind === "eval_relevance",
          ) ?? null;
        return [s.initiativeId, { history, evalSeries }] as const;
      }),
  );

  const historyByInitiativeId: Record<string, InitiativeHistoryContext> =
    Object.fromEntries(entries);

  return <PromotionsPageClient historyByInitiativeId={historyByInitiativeId} />;
}
