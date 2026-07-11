"use client";

// Review workbench (ui-spec §5): queue across all initiatives + two-pane
// drafting surface (agent draft + citations left, editable assessment +
// verdict right). Sign/Return are approve-style actions (hidden for Admin,
// disabled-with-tooltip without a live session — see role-gate.tsx).
//
// Live mode: for an initiative created during this live demo session (the
// live registry knows its cycleId), a reviewer-role session gets an
// EDITABLE assessment textarea and working Sign (submits the edited draft)
// and Return (mandatory-reason dialog) actions against the real API.
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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
import { TierBadge } from "./tier-badge";
import { DOMAIN_LABEL, ReviewStatusBadge } from "./domain-labels";
import { GatedActionButton } from "./role-gate";
import { ReturnReviewDialog } from "./return-review-dialog";
import {
  apiErrorToMessage,
  isApiError,
  returnReview,
  signReview,
} from "@/lib/client/api";
import { useLiveInfo } from "@/lib/client/use-live-info";
import { useLiveSessionOptional } from "@/lib/client/session-context";

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
        <div>
          <div className="mb-3 flex items-center gap-2 text-sm">
            <span className="font-semibold">{DOMAIN_LABEL[selected.review.domain]} review</span>
            <span className="text-muted-foreground">·</span>
            <Link
              href={`/initiatives/${selected.slug}?tab=reviews`}
              className="text-primary underline-offset-4 hover:underline"
            >
              {selected.title}
            </Link>
            <TierBadge tier={selected.tier} />
            <ReviewStatusBadge status={selected.review.status} />
          </div>

          {/* Signature screen: evidence & policy · agent draft · reviewer sign-off */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3" data-slot="review-columns">
            <Card className="overflow-hidden">
              <CardHeader className="border-b bg-muted/40 py-2.5">
                <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
                  1 · Evidence &amp; policy sources
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pt-4">
                {selected.review.citations.length > 0 ? (
                  <ul className="space-y-1.5">
                    {selected.review.citations.map((c) => (
                      <li key={c} className="flex items-start gap-2 text-sm">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                        <span className="font-mono text-xs">{c}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No policy sources cited yet.
                  </p>
                )}
                <p className="border-t pt-3 text-xs text-muted-foreground">
                  The drafting agent may cite only sources supplied to it. Required
                  evidence surfaces as conditions on approval — see the initiative&rsquo;s
                  Controls tab.
                </p>
              </CardContent>
            </Card>

            <Card className="overflow-hidden">
              <CardHeader className="border-b bg-muted/40 py-2.5">
                <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
                  2 · Agent-drafted assessment
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                  {selected.review.draftMd ?? "No draft yet for this domain."}
                </p>
              </CardContent>
            </Card>

            <AssessmentPane
              key={`${selected.slug}-${selected.review.domain}`}
              row={selected}
            />
          </div>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
          Select a review from the queue to open the three-column workbench —
          evidence &amp; policy, the agent draft, and your findings.
        </p>
      )}
    </div>
  );
}

/**
 * Right pane — editable assessment + Sign/Return. Keyed by slug+domain from
 * the parent so its draft-edit state re-initializes per selection.
 */
function AssessmentPane({ row }: { row: ReviewQueueRow }) {
  const router = useRouter();
  const live = useLiveSessionOptional();
  const session = live?.session ?? null;
  const liveInfo = useLiveInfo(row.slug);
  const cycleId = liveInfo?.cycleId ?? null;

  const [editedText, setEditedText] = React.useState(row.review.draftMd ?? "");
  const [pending, setPending] = React.useState(false);
  const [returnOpen, setReturnOpen] = React.useState(false);

  const canAct = Boolean(session?.role === "reviewer" && cycleId);
  const actionable = row.review.status === "drafted" || row.review.status === "returned";

  async function handleSign() {
    if (!session || !cycleId) return;
    setPending(true);
    try {
      await signReview(
        session.token,
        cycleId,
        row.review.domain,
        editedText !== (row.review.draftMd ?? "") ? editedText : undefined,
      );
      toast.success(`${DOMAIN_LABEL[row.review.domain]} review signed.`);
      router.refresh();
    } catch (err) {
      toast.error(isApiError(err) ? apiErrorToMessage(err) : "Sign failed.");
      if (isApiError(err) && err.status === 401) live?.logout();
    } finally {
      setPending(false);
    }
  }

  async function handleReturn(reason: string) {
    if (!session || !cycleId) return;
    setPending(true);
    try {
      await returnReview(session.token, cycleId, row.review.domain, reason);
      setReturnOpen(false);
      toast.success(`${DOMAIN_LABEL[row.review.domain]} review returned.`);
      router.refresh();
    } catch (err) {
      toast.error(isApiError(err) ? apiErrorToMessage(err) : "Return failed.");
      if (isApiError(err) && err.status === 401) live?.logout();
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b bg-muted/40 py-2.5">
        <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
          3 · Reviewer findings &amp; sign-off
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-4">
        <textarea
          className="min-h-40 w-full rounded-md border border-input bg-transparent p-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
          value={editedText}
          onChange={(e) => setEditedText(e.target.value)}
          disabled={!canAct}
          maxLength={20_000}
          aria-label="Assessment text"
          data-slot="assessment-textarea"
        />
        <div className="flex gap-2">
          <GatedActionButton
            label="Sign"
            requiresRole="reviewer"
            pending={pending}
            pendingLabel="Signing…"
            onAction={canAct && actionable ? () => void handleSign() : undefined}
          />
          <GatedActionButton
            label="Return"
            variant="outline"
            requiresRole="reviewer"
            pending={pending}
            onAction={canAct && actionable ? () => setReturnOpen(true) : undefined}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Returning requires a mandatory reason; both actions write an
          audit event. Agents draft — humans decide.
        </p>
      </CardContent>

      <ReturnReviewDialog
        open={returnOpen}
        onOpenChange={setReturnOpen}
        domainLabel={DOMAIN_LABEL[row.review.domain]}
        pending={pending}
        onConfirm={(reason) => void handleReturn(reason)}
      />
    </Card>
  );
}
