import { loadPortfolioDetails } from "@/app/_lib/portfolio-data";
// Fetch visible case-file telemetry once, then attach deployment history.
// The interactive queue is loaded by PromotionsPageClient.
import { getDb } from "@/lib/db/client";
import { deploymentHistoryForInitiatives, type DeploymentHistoryEntry } from "@/lib/services/promotion-service";
import { getAppProvider, getCurrentWorkspaceId } from "@/app/_lib/data-provider";
import type { TelemetrySeries } from "@/lib/data/dto";
import { PromotionsPageClient } from "./promotions-page-client";
import type { Metadata } from "next";


export const metadata: Metadata = {
  title: "Promotion queue",
  description:
    "Checkpoint promotions awaiting a decision, with deployment history and eval trend for each candidate model version.",
};

export interface InitiativeHistoryContext {
  history: DeploymentHistoryEntry[];
  evalSeries: TelemetrySeries | null;
}

export default async function PromotionsPage() {
  const provider = getAppProvider();
  const viewerWorkspaceId = await getCurrentWorkspaceId();

  const details = await loadPortfolioDetails(provider, viewerWorkspaceId);
  const histories = await deploymentHistoryForInitiatives(
    getDb(),
    details.flatMap((detail) => (detail.summary.initiativeId ? [detail.summary.initiativeId] : [])),
  );
  const entries = details.map((detail) => {
    const initiativeId = detail.summary.initiativeId;
    if (!initiativeId) return null;
    const history = histories.get(initiativeId) ?? [];
    const evalSeries = detail.telemetry.find((series) => series.kind === "eval_hallucination" || series.kind === "eval_relevance") ?? null;
    return [initiativeId, { history, evalSeries }] as const;
  });

  const historyByInitiativeId: Record<string, InitiativeHistoryContext> =
    Object.fromEntries(entries.filter((entry) => entry !== null));

  return <PromotionsPageClient historyByInitiativeId={historyByInitiativeId} />;
}
