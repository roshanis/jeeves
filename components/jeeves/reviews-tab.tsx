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

export function ReviewsTab({ reviews, slug }: { reviews: ReviewRow[]; slug?: string }) {
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

  async function handleStartDraftRun() {
    if (!session || !liveInfo?.initiativeId || checkedDomains.length === 0) return;
    setRunning(true);
    try {
      const result = await startDraftRun(session.token, liveInfo.initiativeId, checkedDomains);
      setOutcomeState({ cycleId: result.cycleId, outcomes: result.outcomes });
      const failedDomains = failedDraftRunDomains(result.outcomes);
      if (failedDomains.length > 0) {
        setSelectionState({ cycleId: result.cycleId, domains: failedDomains });
        toast.error(
          `${failedDomains.length} domain${failedDomains.length === 1 ? "" : "s"} failed. Retry only the failed domains.`,
        );
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
  const [returnDialogDomain, setReturnDialogDomain] = React.useState<Domain | null>(null);
  const [localState, setLocalState] = React.useState<{
    cycleId: string | null;
    statuses: Partial<Record<Domain, ReviewRow["status"]>>;
  }>({ cycleId: null, statuses: {} });
  const localStatus = localState.cycleId === (liveInfo?.cycleId ?? null)
    ? localState.statuses
    : {};

  async function handleSign(domain: Domain) {
    if (!session || !liveInfo?.cycleId) return;
    const cycleId = liveInfo.cycleId;
    setActingDomain(domain);
    try {
      await performReviewMutation(session.token, cycleId, domain, { kind: "sign" });
      setLocalState((prev) => ({
        cycleId,
        statuses: {
          ...(prev.cycleId === cycleId ? prev.statuses : {}),
          [domain]: "signed",
        },
      }));
      toast.success(`${DOMAIN_LABEL[domain]} review signed.`);
      router.refresh();
    } catch (err) {
      toast.error(isApiError(err) ? apiErrorToMessage(err) : "Sign failed.");
      if (isApiError(err) && err.status === 401) live?.logout();
    } finally {
      setActingDomain(null);
    }
  }

  async function handleReturn(domain: Domain, reason: string) {
    if (!session || !liveInfo?.cycleId) return;
    const cycleId = liveInfo.cycleId;
    setActingDomain(domain);
    try {
      await performReviewMutation(session.token, cycleId, domain, {
        kind: "return",
        reason,
      });
      setLocalState((prev) => ({
        cycleId,
        statuses: {
          ...(prev.cycleId === cycleId ? prev.statuses : {}),
          [domain]: "returned",
        },
      }));
      setReturnDialogDomain(null);
      toast.success(`${DOMAIN_LABEL[domain]} review returned.`);
      router.refresh();
    } catch (err) {
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
      if (local) status = local;
    }
    return { review, status };
  });

  const canRunDrafts = Boolean(
    session &&
      liveInfo?.initiativeId &&
      liveInfo?.cycleId &&
      (pendingDomains.length > 0 || outcomes.some((outcome) => outcome.status === "failed")),
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
              before results appear. Failed domains remain selected for a focused retry.
            </p>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {Array.from(new Set([...pendingDomains, ...outcomes.filter((o) => o.status === "failed").map((o) => o.domain)])).map((domain) => (
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
                : outcomes.some((outcome) => outcome.status === "failed")
                  ? `Retry failed domains (${checkedDomains.length})`
                  : `Start draft run (${checkedDomains.length} domains)`}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {displayRows.map(({ review, status }) => {
        const eligibility = getReviewActionEligibility(
          session,
          liveInfo?.cycleId ?? null,
          review.domain,
          status === "failed" ? "pending" : status,
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
                  <div className="flex flex-wrap gap-1.5">
                    {review.citations.map((c) => (
                      <Badge key={c} variant="outline" className="font-mono text-[11px]">
                        {c}
                      </Badge>
                    ))}
                  </div>
                ) : null}
                {status === "drafted" || status === "returned" ? (
                  <>
                    <Separator />
                    <div className="flex justify-end gap-2">
                      <GatedActionButton
                        label="Sign"
                        requiresRole="reviewer"
                        pending={actingDomain === review.domain}
                        pendingLabel="Signing…"
                        onAction={
                          eligibility.canSignOrReturn ? () => void handleSign(review.domain) : undefined
                        }
                      />
                      <GatedActionButton
                        label="Return"
                        variant="outline"
                        requiresRole="reviewer"
                        pending={actingDomain === review.domain}
                        onAction={
                          eligibility.canSignOrReturn
                            ? () => setReturnDialogDomain(review.domain)
                            : undefined
                        }
                      />
                    </div>
                  </>
                ) : null}
              </CardContent>
            ) : null}
          </Card>
        );
      })}

      <ReturnReviewDialog
        open={returnDialogDomain !== null}
        onOpenChange={(open) => {
          if (!open) setReturnDialogDomain(null);
        }}
        domainLabel={returnDialogDomain ? DOMAIN_LABEL[returnDialogDomain] : ""}
        pending={actingDomain !== null}
        onConfirm={(reason) => {
          if (returnDialogDomain) void handleReturn(returnDialogDomain, reason);
        }}
      />
    </div>
  );
}
