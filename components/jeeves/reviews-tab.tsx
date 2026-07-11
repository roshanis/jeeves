// Reviews tab (ui-spec §3.3): per-domain status list with draft text and
// policy citations. Sign/Return are approve-style actions: hidden entirely
// for Admin, disabled-with-tooltip for every other role (role-gate.tsx).
import type { ReviewRow } from "@/lib/data/dto";
import type { Domain } from "@/lib/domain/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { GatedActionButton } from "./role-gate";
import { cn } from "@/lib/utils";

export const DOMAIN_LABEL: Record<Domain, string> = {
  legal: "Legal",
  procurement: "Procurement",
  "tech-architecture": "Tech Architecture",
  "responsible-ai": "Responsible AI",
  security: "Security",
  "privacy-hipaa": "Privacy/HIPAA",
  "clinical-safety": "Clinical Safety",
  "data-governance": "Data Governance",
};

const STATUS_CLASS: Record<ReviewRow["status"], string> = {
  pending: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  drafted: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  signed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  returned: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
};

const STATUS_LABEL: Record<ReviewRow["status"], string> = {
  pending: "Not started",
  drafted: "Drafted",
  signed: "Signed",
  returned: "Returned",
};

export function ReviewStatusBadge({ status }: { status: ReviewRow["status"] }) {
  return (
    <span
      data-slot="review-status"
      data-status={status}
      className={cn(
        "inline-flex h-5 w-fit items-center rounded-full px-2 text-xs font-medium",
        STATUS_CLASS[status],
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

export function ReviewsTab({ reviews }: { reviews: ReviewRow[] }) {
  if (reviews.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No reviews drafted yet — required domains will appear here once
        triage completes.
      </p>
    );
  }

  return (
    <div className="space-y-3" data-slot="reviews-tab">
      {reviews.map((review) => (
        <Card key={review.domain} size="sm">
          <CardHeader className="flex-row items-center justify-between gap-2">
            <CardTitle className="text-sm">{DOMAIN_LABEL[review.domain]}</CardTitle>
            <div className="flex items-center gap-2">
              <ReviewStatusBadge status={review.status} />
              {review.reviewer ? (
                <span className="text-xs text-muted-foreground">{review.reviewer}</span>
              ) : null}
              {review.signedAt ? (
                <span className="text-xs text-muted-foreground">
                  signed {review.signedAt.slice(0, 10)}
                </span>
              ) : null}
            </div>
          </CardHeader>
          {review.draftMd || review.citations.length > 0 ? (
            <CardContent className="space-y-2">
              {review.draftMd ? (
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                  {review.draftMd}
                </p>
              ) : null}
              {review.citations.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {review.citations.map((c) => (
                    <Badge key={c} variant="outline">
                      {c}
                    </Badge>
                  ))}
                </div>
              ) : null}
              {review.status === "drafted" || review.status === "returned" ? (
                <>
                  <Separator />
                  <div className="flex gap-2">
                    <GatedActionButton label="Sign" />
                    <GatedActionButton label="Return" variant="outline" />
                  </div>
                </>
              ) : null}
            </CardContent>
          ) : null}
        </Card>
      ))}
    </div>
  );
}
