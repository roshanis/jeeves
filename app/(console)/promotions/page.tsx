import { loadPortfolioDetails } from "@/app/_lib/portfolio-data";
// Fetch visible case-file telemetry once, then attach deployment history.
// The interactive queue is loaded by PromotionsPageClient.
import { getDb } from "@/lib/db/client";
import { deploymentHistory, type DeploymentHistoryEntry } from "@/lib/services/promotion-service";
import { getAppProvider, getCurrentWorkspaceId } from "@/app/_lib/data-provider";
import type { TelemetrySeries } from "@/lib/data/dto";
import { PromotionsPageClient } from "./promotions-page-client";

export interface InitiativeHistoryContext {
  history: DeploymentHistoryEntry[];
  evalSeries: TelemetrySeries | null;
}

export default async function PromotionsPage() {
  const provider = getAppProvider();
  const viewerWorkspaceId = await getCurrentWorkspaceId();

  const details = await loadPortfolioDetails(provider, viewerWorkspaceId);
  const entries = await Promise.all(details.map(async (detail) => {
    const initiativeId = detail.summary.initiativeId;
    if (!initiativeId) return null;
    const history = await deploymentHistory(getDb(), initiativeId);
    const evalSeries = detail.telemetry.find((series) => series.kind === "eval_hallucination" || series.kind === "eval_relevance") ?? null;
    return [initiativeId, { history, evalSeries }] as const;
  }));

  const historyByInitiativeId: Record<string, InitiativeHistoryContext> =
    Object.fromEntries(entries.filter((entry) => entry !== null));

  return <PromotionsPageClient historyByInitiativeId={historyByInitiativeId} />;
}
