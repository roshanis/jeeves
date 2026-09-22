import { loadPortfolioDetails } from "@/app/_lib/portfolio-data";
import { getAppProvider, getCurrentWorkspaceId } from "@/app/_lib/data-provider";
import type { ReviewQueueRow } from "@/components/jeeves/review-workbench";
import { ReviewWorkbenchRoute } from "./review-workbench-route";

export default async function ReviewsPage() {
  const provider = getAppProvider();
  const viewerWorkspaceId = await getCurrentWorkspaceId();
  const details = await loadPortfolioDetails(provider, viewerWorkspaceId);

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

  // Keep blocked and incomplete reviews ahead of completed signatures.
  const order = { returned: 0, drafted: 1, pending: 2, abstained: 3, signed: 4 } as const;
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
      <ReviewWorkbenchRoute rows={rows} />
    </div>
  );
}
