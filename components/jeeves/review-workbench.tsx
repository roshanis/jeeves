"use client";

// Review workbench (ui-spec §5): queue across all initiatives + two-pane
// drafting surface (agent draft + citations left, editable assessment +
// verdict right). Read-only build: the assessment field renders but is
// disabled; Sign/Return are approve-style actions (hidden for Admin,
// disabled-with-tooltip otherwise — see role-gate.tsx).
import * as React from "react";
import Link from "next/link";
import type { ReviewRow } from "@/lib/data/dto";
import type { Tier } from "@/lib/domain/types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TierBadge } from "./tier-badge";
import { DOMAIN_LABEL, ReviewStatusBadge } from "./reviews-tab";
import { GatedActionButton } from "./role-gate";

export interface ReviewQueueRow {
  slug: string;
  title: string;
  tier: Tier;
  review: ReviewRow;
}

export function ReviewWorkbench({ rows }: { rows: ReviewQueueRow[] }) {
  const [selected, setSelected] = React.useState<ReviewQueueRow | null>(null);

  return (
    <div className="flex flex-col gap-6" data-slot="review-workbench">
      <Card>
        <CardHeader>
          <CardTitle>Reviewer queue</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Initiative</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead>Domain</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Reviewer</TableHead>
                <TableHead>Last updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={`${row.slug}-${row.review.domain}`}
                  onClick={() => setSelected(row)}
                  className="cursor-pointer"
                  data-selected={
                    selected?.slug === row.slug &&
                    selected?.review.domain === row.review.domain
                  }
                >
                  <TableCell>
                    <span className="font-medium">{row.title}</span>{" "}
                    <span className="text-xs text-muted-foreground">{row.slug}</span>
                  </TableCell>
                  <TableCell>
                    <TierBadge tier={row.tier} />
                  </TableCell>
                  <TableCell>{DOMAIN_LABEL[row.review.domain]}</TableCell>
                  <TableCell>
                    <ReviewStatusBadge status={row.review.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.review.reviewer ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.review.signedAt?.slice(0, 10) ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {selected ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">
                Agent draft — {DOMAIN_LABEL[selected.review.domain]} ·{" "}
                <Link
                  href={`/initiatives/${selected.slug}?tab=reviews`}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  {selected.title}
                </Link>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                {selected.review.draftMd ?? "No draft yet for this domain."}
              </p>
              {selected.review.citations.length > 0 ? (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium uppercase text-muted-foreground">
                    Policy citations
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {selected.review.citations.map((c) => (
                      <Badge key={c} variant="outline">
                        {c}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Assessment (reviewer edits, then decides)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <textarea
                className="min-h-32 w-full rounded-lg border border-input bg-transparent p-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                defaultValue={selected.review.draftMd ?? ""}
                disabled
                aria-label="Assessment text"
              />
              <div className="flex gap-2">
                <GatedActionButton label="Sign" />
                <GatedActionButton label="Return" variant="outline" />
              </div>
              <p className="text-xs text-muted-foreground">
                Returning requires a mandatory reason; both actions write an
                audit event. Agents draft — humans decide.
              </p>
            </CardContent>
          </Card>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Select a review from the queue to open the drafting surface.
        </p>
      )}
    </div>
  );
}
