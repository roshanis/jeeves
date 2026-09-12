import { loadPortfolioDetails } from "@/app/_lib/portfolio-data";
import { getAppProvider, getCurrentWorkspaceId } from "@/app/_lib/data-provider";
import {
  ReviewWorkbench,
  type ReviewQueueRow,
} from "@/components/jeeves/review-workbench";
import { ReviewRequestQueue } from "@/components/jeeves/review-request-queue";
import {
  deliveryTransportStatus,
  undeliveredNotifications,
  type ReviewNotificationRow,
} from "@/lib/services/notification-service";
import { getDb } from "@/lib/db/client";

export default async function ReviewsPage() {
  const provider = getAppProvider();
  const viewerWorkspaceId = await getCurrentWorkspaceId();
  const details = await loadPortfolioDetails(provider, viewerWorkspaceId);

  // The outbound request queue. Only meaningful against a real database — the
  // mock provider has no notifications table — so this degrades to an empty
  // queue rather than failing the page, same pattern as the inbox's incident
  // load.
  let requests: ReviewNotificationRow[] = [];
  const dbMode = process.env.DATA_PROVIDER === "db" || !!process.env.DATABASE_URL;
  if (dbMode) {
    try {
      requests = await undeliveredNotifications(getDb());
    } catch {
      requests = [];
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
        review,
      });
    }
  }

  // Returned first (bottlenecks), then drafted (awaiting signature), then signed.
  const order = { returned: 0, drafted: 1, signed: 2, pending: 3 } as const;
  rows.sort(
    (a, b) =>
      order[a.review.status] - order[b.review.status] ||
      a.slug.localeCompare(b.slug),
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Review workbench</h1>
        <p className="text-sm text-muted-foreground">
          All domain reviews across the portfolio. Agents draft, humans
          decide — signing authority never sits with agents or Admin.
        </p>
      </div>
      <ReviewWorkbench rows={rows} />
      <ReviewRequestQueue notifications={requests} transport={deliveryTransportStatus()} />
    </div>
  );
}
