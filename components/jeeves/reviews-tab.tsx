"use client";

// Reviews tab (ui-spec §3.3): per-domain status list with draft text and
// policy citations. Sign/Return are approve-style actions: hidden entirely
// for Admin, disabled-with-tooltip without a live session (role-gate.tsx),
// and LIVE for a reviewer-role session on an initiative created during this
// live demo session (lib/client/live-registry.ts knows its cycleId).
//
// Live draft-run: when the initiative was created live and has pending
// domain rows, a "Start draft run" panel fans the selected domains out to
// the agent port (POST /api/initiatives/[id]/draft-run) and polls the
// public GET progress endpoint every 1.5s, so rows flip pending -> drafted
// in place without a full page reload; a router.refresh() at the end pulls
// the server-rendered state (draft text, reviewer names) in.
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ReviewRow } from "@/lib/data/dto";
import type { Domain } from "@/lib/domain/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  apiErrorToMessage,
  getDraftRunProgress,
  isApiError,
  returnReview,
  signReview,
  startDraftRun,
  type DraftRunProgressRow,
} from "@/lib/client/api";
import { useLiveInfo } from "@/lib/client/use-live-info";
import { useLiveSessionOptional } from "@/lib/client/session-context";
import { GatedActionButton } from "./role-gate";
import { DOMAIN_LABEL, ReviewStatusBadge } from "./domain-labels";
import { ReturnReviewDialog } from "./return-review-dialog";

// Re-exported for backwards compatibility with earlier imports; the
// canonical home is ./domain-labels (server-safe).
export { DOMAIN_LABEL, ReviewStatusBadge } from "./domain-labels";

const POLL_INTERVAL_MS = 1500;
const MAX_POLLS = 80; // 2 minutes of polling at 1.5s — plenty for the mock adapter

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
  const [selectedDomains, setSelectedDomains] = React.useState<Domain[] | null>(null);
  const checkedDomains = selectedDomains ?? pendingDomains;
  const [running, setRunning] = React.useState(false);
  const [pollRows, setPollRows] = React.useState<DraftRunProgressRow[] | null>(null);
  const pollTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, []);

  async function handleStartDraftRun() {
    if (!session || !liveInfo?.initiativeId || checkedDomains.length === 0) return;
    setRunning(true);
    try {
      const result = await startDraftRun(session.token, liveInfo.initiativeId, checkedDomains);
      toast.success(
        `Draft run started — ${result.outcomes.length} domain(s) dispatched to the drafting agents.`,
      );
      const initiativeId = liveInfo.initiativeId;
      const requested = new Set(checkedDomains);
      let polls = 0;

      const poll = async () => {
        polls += 1;
        try {
          const progress = await getDraftRunProgress(initiativeId, result.cycleId);
          setPollRows(progress.rows);
          const requestedDone = progress.rows
            .filter((row) => requested.has(row.domain))
            .every((row) => row.status !== "pending");
          if ((requestedDone && polls > 1) || progress.complete || polls >= MAX_POLLS) {
            setRunning(false);
            toast.success("Draft run finished — drafts are ready for review.");
            router.refresh();
            return;
          }
        } catch {
          // transient polling error — keep trying until MAX_POLLS
          if (polls >= MAX_POLLS) {
            setRunning(false);
            return;
          }
        }
        pollTimer.current = setTimeout(() => void poll(), POLL_INTERVAL_MS);
      };
      pollTimer.current = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    } catch (err) {
      setRunning(false);
      toast.error(isApiError(err) ? apiErrorToMessage(err) : "Draft run failed to start.");
      if (isApiError(err) && err.status === 401) live?.logout();
    }
  }

  // ----- live sign/return -----------------------------------------------
  const [actingDomain, setActingDomain] = React.useState<Domain | null>(null);
  const [returnDialogDomain, setReturnDialogDomain] = React.useState<Domain | null>(null);
  const [localStatus, setLocalStatus] = React.useState<Partial<Record<Domain, ReviewRow["status"]>>>(
    {},
  );

  async function handleSign(domain: Domain) {
    if (!session || !liveInfo?.cycleId) return;
    setActingDomain(domain);
    try {
      await signReview(session.token, liveInfo.cycleId, domain);
      setLocalStatus((prev) => ({ ...prev, [domain]: "signed" }));
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
    setActingDomain(domain);
    try {
      await returnReview(session.token, liveInfo.cycleId, domain, reason);
      setLocalStatus((prev) => ({ ...prev, [domain]: "returned" }));
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

  // Overlay live poll/local statuses over the server-rendered rows so
  // progress appears without a reload.
  const pollByDomain = new Map((pollRows ?? []).map((row) => [row.domain, row]));
  const displayRows = reviews.map((review) => {
    const local = localStatus[review.domain];
    const poll = pollByDomain.get(review.domain);
    let status: ReviewRow["status"] | "failed" = review.status;
    if (poll && poll.status !== "pending") status = poll.status;
    if (local) status = local;
    return { review, status };
  });

  const canRunDrafts = Boolean(
    session && liveInfo?.initiativeId && liveInfo?.cycleId && pendingDomains.length > 0,
  );

  return (
    <div className="space-y-3" data-slot="reviews-tab">
      {canRunDrafts ? (
        <Card size="sm" data-slot="draft-run-panel">
          <CardHeader>
            <CardTitle className="text-sm">Draft run — fan out to drafting agents</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Select the domains to draft (agents draft — humans decide). Rows
              below flip from Not started to Drafted as each domain completes.
            </p>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {pendingDomains.map((domain) => (
                <label key={domain} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    data-slot="draft-domain-checkbox"
                    data-domain={domain}
                    checked={checkedDomains.includes(domain)}
                    disabled={running}
                    onChange={(e) =>
                      setSelectedDomains(
                        e.target.checked
                          ? [...checkedDomains, domain]
                          : checkedDomains.filter((d) => d !== domain),
                      )
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
              {running ? "Drafting…" : `Start draft run (${checkedDomains.length} domains)`}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {displayRows.map(({ review, status }) => (
        <Card key={review.domain} size="sm" data-slot="review-row" data-domain={review.domain}>
          <CardHeader className="flex-row items-center justify-between gap-2">
            <CardTitle className="text-sm">{DOMAIN_LABEL[review.domain]}</CardTitle>
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
              {status === "drafted" || status === "returned" ? (
                <>
                  <Separator />
                  <div className="flex gap-2">
                    <GatedActionButton
                      label="Sign"
                      requiresRole="reviewer"
                      pending={actingDomain === review.domain}
                      pendingLabel="Signing…"
                      onAction={
                        liveInfo?.cycleId ? () => void handleSign(review.domain) : undefined
                      }
                    />
                    <GatedActionButton
                      label="Return"
                      variant="outline"
                      requiresRole="reviewer"
                      pending={actingDomain === review.domain}
                      onAction={
                        liveInfo?.cycleId
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
      ))}

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
