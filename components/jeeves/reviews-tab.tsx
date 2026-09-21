"use client";

// Reviews tab (ui-spec §3.3): per-domain status list with draft text and
// unverified references. Reviewer commands live in the evidence workbench; this
// case summary links to the exact domain and owns only batch drafting.
//
// Live draft-run is synchronous: the POST returns a final outcome for every
// requested domain. The UI reports those outcomes directly and offers a
// targeted retry for failed domains.
import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
import {
  apiErrorToMessage,
  isApiError,
  startDraftRun,
  type DraftRunDomainOutcome,
} from "@/lib/client/api";
import { useLiveSessionOptional } from "@/lib/client/session-context";
import { DOMAIN_LABEL, ReviewStatusBadge } from "./domain-labels";
import { failedDraftRunDomains } from "@/lib/client/review-actions";

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

interface ReviewsTabProps {
  reviews: ReviewRow[];
  slug?: string;
  initiativeId?: string;
  isSeeded?: boolean;
}

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

export function ReviewsTab(props: ReviewsTabProps) {
  const live = useLiveSessionOptional();
  const cycleKey = props.reviews.map((review) => review.cycleId ?? "legacy").join(":");
  return <ReviewsTabContent key={`${props.slug}:${live?.session?.token ?? "public"}:${cycleKey}`} {...props} />;
}

function ReviewsTabContent({ reviews, slug, initiativeId, isSeeded }: {
  reviews: ReviewRow[];
  slug?: string;
  initiativeId?: string;
  isSeeded?: boolean;
}) {
  const router = useRouter();
  const live = useLiveSessionOptional();
  const session = live?.session ?? null;

  // ----- live draft-run state -------------------------------------------
  const pendingDomains = React.useMemo(
    () => reviews.filter((r) => r.status === "pending").map((r) => r.domain),
    [reviews],
  );
  const [selectionState, setSelectionState] = React.useState<{
    cycleId: string | null;
    domains: Domain[];
  } | null>(null);
  const cycleId = reviews[0]?.cycleId ?? null;
  const selectedDomains = selectionState?.cycleId === cycleId
    ? selectionState.domains
    : null;
  const checkedDomains = selectedDomains ?? pendingDomains;
  const [running, setRunning] = React.useState(false);
  const [outcomeState, setOutcomeState] = React.useState<{
    cycleId: string | null;
    outcomes: DraftRunDomainOutcome[];
  }>({ cycleId: null, outcomes: [] });
  const outcomes = outcomeState.cycleId === cycleId
    ? outcomeState.outcomes
    : [];

  const unfinished = unfinishedDomains(outcomes, reviews);
  const mounted = React.useRef(false);
  React.useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function handleStartDraftRun() {
    if (!session || !initiativeId || isSeeded !== false || checkedDomains.length === 0) return;
    setRunning(true);
    try {
      const result = await startDraftRun(session.token, initiativeId, checkedDomains);
      if (!mounted.current) return;
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
      if (!mounted.current) return;
      toast.error(isApiError(err) ? apiErrorToMessage(err) : "Draft run failed to start.");
      if (isApiError(err) && err.status === 401) live?.logout();
    } finally {
      if (mounted.current) setRunning(false);
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
    const outcome = outcomeByDomain.get(review.domain);
    let status: ReviewRow["status"] | "failed" = review.status;
    if (review.status !== "signed") {
      if (outcome?.status === "drafted" || outcome?.status === "failed") status = outcome.status;
    }
    return { review, status };
  });

  const canRunDrafts = Boolean(
    session &&
      (session.role === "requester" || session.role === "admin") &&
      initiativeId &&
      isSeeded === false &&
      cycleId &&
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
              before results appear. Incomplete domains remain selected for a focused retry.
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
            {slug || review.draftMd || review.citations.length > 0 || review.missingEvidence?.length || review.evidenceRequests?.length ? (
              <CardContent className="space-y-3 pt-4">
                {review.draftMd ? (
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                    {review.draftMd}
                  </p>
                ) : null}
                {review.citations.length > 0 ? (
                  <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">{review.citationProvenance === "agent-supplied" ? "Unverified agent references" : "Unverified historical references"}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {review.citations.map((c) => (
                      <Badge key={c} variant="outline" className="font-mono text-[11px]">
                        {c}
                      </Badge>
                    ))}
                  </div>
                  </div>
                ) : null}
                {review.missingEvidence?.length ? <section className="space-y-1 text-sm" aria-label="Missing evidence"><h3 className="font-medium">Missing evidence reported by the agent</h3>{review.missingEvidence.map((gap, i) => <p key={i}>{gap}</p>)}</section> : null}
                {review.evidenceRequests?.length ? <section className="space-y-1 text-sm" aria-label="Evidence requests"><h3 className="font-medium">Evidence requested by the agent</h3>{review.evidenceRequests.map((request, i) => <p key={i}>{request.controlId} · {request.description}</p>)}</section> : null}
                {slug ? (
                  <Link
                    href={`/reviews?initiative=${encodeURIComponent(slug)}&domain=${encodeURIComponent(review.domain)}`}
                    className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline"
                  >
                    Open {DOMAIN_LABEL[review.domain]} review
                  </Link>
                ) : null}
              </CardContent>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}
