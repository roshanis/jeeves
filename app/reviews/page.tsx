import { getAppProvider, getCurrentWorkspaceId } from "@/app/_lib/data-provider";
import {
  ReviewWorkbench,
  type ReviewQueueRow,
} from "@/components/jeeves/review-workbench";

export default async function ReviewsPage() {
  const provider = getAppProvider();
  const viewerWorkspaceId = await getCurrentWorkspaceId();
  const initiatives = await provider.listInitiatives({ viewerWorkspaceId });
  const details = await Promise.all(
    initiatives.map((i) => provider.getInitiativeDetail(i.slug, { viewerWorkspaceId })),
  );

  const rows: ReviewQueueRow[] = [];
  for (const detail of details) {
    if (!detail) continue;
    for (const review of detail.reviews) {
      // Queue shows actionable / in-flight rows first; pending rows are
      // noise at portfolio scale, but drafted/returned/signed all matter
      // for bottleneck-spotting (ui-spec §5.2).
      if (review.status === "pending") continue;
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
    </div>
  );
}
