import { loadPortfolioDetails } from "@/app/_lib/portfolio-data";
import { getAppProvider, getCurrentWorkspaceId } from "@/app/_lib/data-provider";
import { sortReviewQueue } from "@/lib/reviews/queue-order";
import type { ReviewQueueRow } from "@/components/jeeves/review-workbench";
import { ReviewWorkbenchRoute } from "./review-workbench-route";
import { ReviewRequestQueue } from "@/components/jeeves/review-request-queue";
import {
  deliveryTransportStatus,
  recentUndeliveredNotifications,
  type ReviewNotificationRow,
} from "@/lib/services/notification-service";
import { getDb } from "@/lib/db/client";
import { logUnexpectedError } from "@/lib/http/log-error";
import { runtimeDatabaseUrl } from "@/lib/db/runtime-config";
import { resolveDataProviderMode } from "@/lib/data/provider-mode";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Review workbench",
  description:
    "All domain reviews across the portfolio, with the outbound review-request queue. Agents draft; humans sign — signing authority never sits with agents or Admin.",
};

export default async function ReviewsPage() {
  const provider = getAppProvider();
  const viewerWorkspaceId = await getCurrentWorkspaceId();
  const details = await loadPortfolioDetails(provider, viewerWorkspaceId);

  // The outbound request queue. Only meaningful against a real database — the
  // mock provider has no notifications table — so this degrades to an empty
  // queue rather than failing the page, same pattern as the inbox's incident
  // load. Scoped to the viewer's workspace like everything else on this page:
  // each ask names its initiative, so an unscoped queue would show every
  // playground visitor everyone else's titles.
  let requests: ReviewNotificationRow[] = [];
  let requestsTotal = 0;
  let requestsLoadFailed = false;
  const dbMode = resolveDataProviderMode(process.env.DATA_PROVIDER, !!runtimeDatabaseUrl()) === "db";
  if (dbMode) {
    try {
      const recent = await recentUndeliveredNotifications(getDb(), viewerWorkspaceId);
      requests = recent.rows;
      requestsTotal = recent.total;
    } catch (err) {
      logUnexpectedError("reviews: could not load review requests", err);
      requests = [];
      requestsLoadFailed = true;
    }
  }

  const rows: ReviewQueueRow[] = [];
  for (const detail of details) {
    if (!detail) continue;
    for (const review of detail.reviews) {
      // Keep pending reviews visible so users can reach work awaiting a draft.
      rows.push({
        slug: detail.summary.slug,
        title: detail.summary.title,
        tier: detail.summary.tier,
        isSeeded: detail.summary.isSeeded,
        review,
      });
    }
  }

  // Blocked and incomplete reviews first; unsigned reviews of closed cycles last.
  const sortedRows = sortReviewQueue(rows);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Review workbench</h1>
        <p className="text-sm text-muted-foreground">
          All domain reviews across the portfolio. Agents draft, humans
          decide — signing authority never sits with agents or Admin.
        </p>
      </div>
      <ReviewWorkbenchRoute rows={sortedRows} />
      <ReviewRequestQueue
        notifications={requests}
        total={requestsTotal}
        loadFailed={requestsLoadFailed}
        transport={deliveryTransportStatus()}
      />
    </div>
  );
}
