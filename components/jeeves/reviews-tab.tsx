"use client";

// Reviews tab (ui-spec §3.3): per-domain status list with draft text and
// policy citations. Sign/Return are approve-style actions: hidden entirely
// for Admin, disabled-with-tooltip without a live session (role-gate.tsx),
// and LIVE for a reviewer-role session on an initiative created during this
// live demo session (lib/client/live-registry.ts knows its cycleId).
//
// Live draft-run is synchronous: the POST returns a final outcome for every
// requested domain. The UI reports those outcomes directly and offers a
// targeted retry for failed domains.
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ReviewRow } from "@/lib/data/dto";
import type { Domain } from "@/lib/domain/types";
import {
  Bot,
  Cpu,
  Database,
  HeartPulse,
  Lock,
  Scale,
  ShieldCheck,
  ShoppingCart,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  apiErrorToMessage,
  isApiError,
  startDraftRun,
  type DraftRunDomainOutcome,
} from "@/lib/client/api";
import { useLiveInfo } from "@/lib/client/use-live-info";
import { useLiveSessionOptional } from "@/lib/client/session-context";
import { GatedActionButton } from "./role-gate";
import { DOMAIN_LABEL, ReviewStatusBadge } from "./domain-labels";
import { ReturnReviewDialog } from "./return-review-dialog";
import { ReviewEvidenceWorkspace } from "./review-evidence-workspace";
import {
  failedDraftRunDomains,
  getReviewActionEligibility,
  performReviewMutation,
} from "@/lib/client/review-actions";

// Re-exported for backwards compatibility with earlier imports; the
// canonical home is ./domain-labels (server-safe).
export { DOMAIN_LABEL, ReviewStatusBadge } from "./domain-labels";

// Per-domain glyph, purely decorative — pairs with DOMAIN_LABEL text so the
// review queue reads faster without relying on color alone.
const DOMAIN_ICON: Record<Domain, LucideIcon> = {
  legal: Scale,
  procurement: ShoppingCart,
  "tech-architecture": Cpu,
  "responsible-ai": Bot,
  security: Lock,
  "privacy-hipaa": ShieldCheck,
  "clinical-safety": HeartPulse,
  "data-governance": Database,
};

function unfinishedDomains(outcomes: DraftRunDomainOutcome[], reviews: ReviewRow[]): Domain[] {
  return outcomes.filter((outcome) => {
    if (outcome.status === "failed") return true;
    if (outcome.status !== "skipped" || outcome.reason === "already signed") return false;
    // An unqualified no-op can also mean a returned review. Only a known
    // drafted/signed row proves the draft requirement was already satisfied.
    const status = reviews.find((review) => review.domain === outcome.domain)?.status;
    return outcome.reason !== undefined || (status !== "drafted" && status !== "signed");
  }).map((outcome) => outcome.domain);
}

export function ReviewsTab(props: { reviews: ReviewRow[]; slug?: string }) {
  const live = useLiveSessionOptional();
  const cycleKey = props.reviews.map((review) => review.cycleId ?? "legacy").join(":");
  return <ReviewsTabContent key={`${props.slug}:${live?.session?.token ?? "public"}:${cycleKey}`} {...props} />;
}

function ReviewsTabContent({ reviews, slug }: { reviews: ReviewRow[]; slug?: string }) {
  const router = useRouter();
  const live = useLiveSessionOptional();
  const session = live?.session ?? null;

  const liveInfo = useLiveInfo(slug);

  // ----- live draft-run state -------------------------------------------
  const pendingDomains = React.useMemo(
    () => reviews.filter((r) => r.status === "pending").map((r) => r.domain),
    [reviews],
  );
  const [selectionState, setSelectionState] = React.useState<{
    cycleId: string | null;
    domains: Domain[];
  } | null>(null);
  const cycleId = liveInfo?.cycleId ?? null;
  const selectedDomains = selectionState?.cycleId === cycleId
    ? selectionState.domains
    : null;
  const checkedDomains = selectedDomains ?? pendingDomains;
  const [running, setRunning] = React.useState(false);
  const [outcomeState, setOutcomeState] = React.useState<{
    cycleId: string | null;
    outcomes: DraftRunDomainOutcome[];
  }>({ cycleId: null, outcomes: [] });
  const outcomes = outcomeState.cycleId === (liveInfo?.cycleId ?? null)
    ? outcomeState.outcomes
    : [];

  const unfinished = unfinishedDomains(outcomes, reviews);

  async function handleStartDraftRun() {
    if (!session || !liveInfo?.initiativeId || checkedDomains.length === 0) return;
    setRunning(true);
    try {
      const result = await startDraftRun(session.token, liveInfo.initiativeId, checkedDomains);
      setOutcomeState({ cycleId: result.cycleId, outcomes: result.outcomes });
      const failedDomains = failedDraftRunDomains(result.outcomes);
      const remainingDomains = unfinishedDomains(result.outcomes, reviews);
      if (failedDomains.length > 0) {
        setSelectionState({ cycleId: result.cycleId, domains: remainingDomains });
        toast.error(
          `${failedDomains.length} domain${failedDomains.length === 1 ? "" : "s"} failed. Review the current status and retry the remaining domains.`,
        );
      } else if (remainingDomains.length > 0) {
        setSelectionState({ cycleId: result.cycleId, domains: remainingDomains });
        toast.info(`${remainingDomains.length} domain${remainingDomains.length === 1 ? "" : "s"} did not complete. A run may still be active or the review changed. Refresh and review the current status before retrying.`);
      } else {
        setSelectionState({ cycleId: result.cycleId, domains: [] });
        toast.success("Draft run finished — all requested domains completed.");
      }
      router.refresh();
    } catch (err) {
      toast.error(isApiError(err) ? apiErrorToMessage(err) : "Draft run failed to start.");
      if (isApiError(err) && err.status === 401) live?.logout();
    } finally {
      setRunning(false);
    }
  }

  // ----- live sign/return -----------------------------------------------
  const [actingDomain, setActingDomain] = React.useState<Domain | null>(null);
  const [returnDialog, setReturnDialog] = React.useState<{ domain: Domain; cycleId: string; revision: number } | null>(null);
  const [signingReview, setSigningReview] = React.useState<{ domain: Domain; cycleId: string; revision: number; attempt: number } | null>(null);
  const [conflicts, setConflicts] = React.useState<Partial<Record<Domain, string>>>({});
  const [returnReasons, setReturnReasons] = React.useState<Partial<Record<Domain, string>>>({});
  const [localState, setLocalState] = React.useState<{
    cycleId: string | null;
    statuses: Partial<Record<Domain, { status: ReviewRow["status"]; revision: number }>>;
  }>({ cycleId: null, statuses: {} });
  const localStatus = localState.cycleId === (liveInfo?.cycleId ?? null)
    ? localState.statuses
    : {};

  async function handleSign(review: ReviewRow, evidencePacketId: string | null) {
    if (!session || !review.cycleId || review.revision === undefined || actingDomain || conflicts[review.domain]) return;
    if (signingReview?.cycleId !== review.cycleId || signingReview.revision !== review.revision) return;
    const domain = review.domain;
    const cycleId = review.cycleId;
    setActingDomain(domain);
    try {
      await performReviewMutation(session.token, cycleId, domain, { kind: "sign", expectedRevision: review.revision, expectedEvidencePacketId: evidencePacketId });
      setLocalState((prev) => ({
        cycleId,
        statuses: {
          ...(prev.cycleId === cycleId ? prev.statuses : {}),
          [domain]: { status: "signed", revision: review.revision! },
        },
      }));
      toast.success(`${DOMAIN_LABEL[domain]} review signed.`);
      router.refresh();
    } catch (err) {
      if (isApiError(err) && err.status === 409) setConflicts((previous) => ({ ...previous, [domain]: apiErrorToMessage(err) }));
      toast.error(isApiError(err) ? apiErrorToMessage(err) : "Sign failed.");
      if (isApiError(err) && err.status === 401) live?.logout();
    } finally {
      setActingDomain(null);
    }
  }

  async function handleReturn(reason: string) {
    if (!session || !returnDialog || actingDomain) return;
    const { domain, cycleId, revision } = returnDialog;
    setReturnReasons((previous) => ({ ...previous, [domain]: reason }));
    setActingDomain(domain);
    try {
      await performReviewMutation(session.token, cycleId, domain, {
        kind: "return",
        reason,
        expectedRevision: revision,
      });
      setLocalState((prev) => ({
        cycleId,
        statuses: {
          ...(prev.cycleId === cycleId ? prev.statuses : {}),
          [domain]: { status: "returned", revision },
        },
      }));
      setReturnDialog(null);
      toast.success(`${DOMAIN_LABEL[domain]} review returned.`);
      router.refresh();
    } catch (err) {
      if (isApiError(err) && err.status === 409) {
        setConflicts((previous) => ({ ...previous, [domain]: apiErrorToMessage(err) }));
        setReturnDialog(null);
      }
      toast.error(isApiError(err) ? apiErrorToMessage(err) : "Return failed.");
      if (isApiError(err) && err.status === 401) live?.logout();
    } finally {
      setActingDomain(null);
    }
  }

  if (reviews.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No reviews drafted yet — required domains will appear here once
        triage completes.
      </p>
    );
  }

  const outcomeByDomain = new Map(outcomes.map((outcome) => [outcome.domain, outcome]));
  const displayRows = reviews.map((review) => {
    const local = localStatus[review.domain];
    const outcome = outcomeByDomain.get(review.domain);
    let status: ReviewRow["status"] | "failed" = review.status;
    if (review.status !== "signed") {
      if (outcome?.status === "drafted" || outcome?.status === "failed") status = outcome.status;
      if (local && local.revision === review.revision) status = local.status;
    }
    return { review, status };
  });

  const canRunDrafts = Boolean(
    session &&
      liveInfo?.initiativeId &&
      liveInfo?.cycleId &&
      (pendingDomains.length > 0 || unfinished.length > 0),
  );

  return (
    <div className="space-y-3" data-slot="reviews-tab">
      {canRunDrafts ? (
        <Card size="sm" data-slot="draft-run-panel" className="card-quiet">
          <CardHeader>
            <CardTitle className="kicker">Draft run — fan out to drafting agents</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Select the domains to draft (agents draft — humans decide). The request completes
              before results appear. Unfinished domains remain selected. Check their current status before retrying.
            </p>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {Array.from(new Set([...pendingDomains, ...unfinished])).map((domain) => (
                <label key={domain} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    data-slot="draft-domain-checkbox"
                    data-domain={domain}
                    checked={checkedDomains.includes(domain)}
                    disabled={running}
                    onChange={(e) =>
                      setSelectionState({
                        cycleId,
                        domains: e.target.checked
                          ? [...checkedDomains, domain]
                          : checkedDomains.filter((d) => d !== domain),
                      })
                    }
                  />
                  {DOMAIN_LABEL[domain]}
                </label>
              ))}
            </div>
            <Button
              type="button"
              disabled={running || checkedDomains.length === 0}
              onClick={() => void handleStartDraftRun()}
              data-slot="start-draft-run"
            >
              {running
                ? "Drafting…"
                : unfinished.length > 0
                  ? `Retry remaining domains (${checkedDomains.length})`
                  : `Start draft run (${checkedDomains.length} domains)`}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {displayRows.map(({ review, status }) => {
        const eligibility = getReviewActionEligibility(
          session,
          review.cycleId ?? null,
          review.domain,
          review.status,
          review.revision,
        );
         const DomainIcon = DOMAIN_ICON[review.domain];
        return (
          <Card key={review.domain} size="sm" data-slot="review-row" data-domain={review.domain} className="card-quiet overflow-hidden">
            <CardHeader className="flex-row items-center justify-between gap-2 border-b py-2.5">
              <CardTitle className="flex items-center gap-2 text-sm">
                <DomainIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                {DOMAIN_LABEL[review.domain]}
              </CardTitle>
              <div className="flex items-center gap-2">
                {status === "failed" ? (
                  <Badge variant="destructive">Failed</Badge>
                ) : (
                  <ReviewStatusBadge status={status} />
                )}
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
            {review.draftMd || review.citations.length > 0 || status === "drafted" || status === "returned" ? (
              <CardContent className="space-y-3 pt-4">
                {review.draftMd ? (
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                    {review.draftMd}
                  </p>
                ) : null}
                {review.citations.length > 0 ? (
                  <div className="space-y-2"><p className="text-xs text-muted-foreground">{review.citationProvenance === "agent-supplied" ? "Unverified agent references" : "Unverified historical references"}</p><div className="flex flex-wrap gap-1.5">
                    {review.citations.map((c) => (
                      <Badge key={c} variant="outline" className="font-mono text-[11px]">
                        {c}
                      </Badge>
                    ))}
                  </div></div>
                ) : null}
                {review.missingEvidence?.length ? <section className="space-y-1 text-sm" aria-label="Missing evidence"><h3 className="font-medium">Missing evidence reported by the agent</h3>{review.missingEvidence.map((gap, i) => <p key={i}>{gap}</p>)}</section> : null}
                {review.evidenceRequests?.length ? <section className="space-y-1 text-sm" aria-label="Evidence requests"><h3 className="font-medium">Evidence requested by the agent</h3>{review.evidenceRequests.map((request, i) => <p key={i}>{request.controlId} · {request.description}</p>)}</section> : null}
                {conflicts[review.domain] ? <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">{conflicts[review.domain]} Open “Review &amp; sign” after refreshing to check the current sources.</p> : null}
                {status === "drafted" || status === "returned" ? (
                  <>
                    <Separator />
                    <div className="flex justify-end gap-2">
                      <GatedActionButton
                        label="Review & sign"
                        requiresRole="reviewer"
                        pending={actingDomain === review.domain}
                        pendingLabel="Review & sign"
                        onAction={
                          eligibility.canSignOrReturn && slug ? () => {
                            setConflicts((previous) => ({ ...previous, [review.domain]: undefined }));
                            setSigningReview((previous) => ({ domain: review.domain, cycleId: review.cycleId!, revision: review.revision!, attempt: (previous?.attempt ?? 0) + 1 }));
                          } : undefined
                        }
                      />
                      <GatedActionButton
                        label="Return"
                        variant="outline"
                        requiresRole="reviewer"
                        pending={actingDomain === review.domain}
                        onAction={
                          eligibility.canSignOrReturn
                            ? () => setReturnDialog({ domain: review.domain, cycleId: review.cycleId!, revision: review.revision! })
                            : undefined
                        }
                      />
                    </div>
                    {slug && signingReview?.domain === review.domain ? <ReviewEvidenceWorkspace
                      key={`${signingReview.cycleId}:${signingReview.revision}:${signingReview.attempt}`}
                      slug={slug}
                      domain={review.domain}
                      citations={review.citations}
                      citationProvenance={review.citationProvenance}
                      missingEvidence={review.missingEvidence}
                      evidenceRequests={review.evidenceRequests}
                      reviewStatus={review.status}
                      reviewCycleId={review.cycleId}
                    >{({ signingBlock, cycleChanged, evidencePacketId }) => <Card className="min-w-0"><CardHeader><CardTitle>Domain signature</CardTitle></CardHeader><CardContent className="space-y-3">
                      <p className="whitespace-pre-wrap text-sm">{review.draftMd}</p>
                      {signingBlock ? <p role="status" className="text-sm text-muted-foreground">{signingBlock}</p> : null}
                      {signingReview.revision !== review.revision || signingReview.cycleId !== review.cycleId ? <p role="alert" className="text-sm">This review changed. Open “Review &amp; sign” again to review the updated draft.</p> : null}
                      <GatedActionButton label="Sign" requiresRole="reviewer" pending={actingDomain !== null || Boolean(signingBlock) || cycleChanged || Boolean(conflicts[review.domain]) || signingReview.revision !== review.revision || signingReview.cycleId !== review.cycleId} pendingLabel={actingDomain === review.domain ? "Signing…" : "Sign"} onAction={eligibility.canSignOrReturn ? () => void handleSign(review, evidencePacketId) : undefined} />
                    </CardContent></Card>}</ReviewEvidenceWorkspace> : null}
                  </>
                ) : null}
              </CardContent>
            ) : null}
          </Card>
        );
      })}

      <ReturnReviewDialog
        open={returnDialog !== null}
        onOpenChange={(open) => {
          if (!open) setReturnDialog(null);
        }}
        domainLabel={returnDialog ? DOMAIN_LABEL[returnDialog.domain] : ""}
        initialReason={returnDialog ? returnReasons[returnDialog.domain] : undefined}
        pending={actingDomain !== null}
        onConfirm={(reason) => void handleReturn(reason)}
      />
    </div>
  );
}
