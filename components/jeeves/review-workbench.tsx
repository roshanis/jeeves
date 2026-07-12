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
import type { Domain, Tier } from "@/lib/domain/types";
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
import { useRole } from "./role-context";
import {
  apiErrorToMessage,
  isApiError,
  returnReview,
  runReviewAgent,
  signReview,
} from "@/lib/client/api";
import { Bot } from "lucide-react";
import { useLiveInfo } from "@/lib/client/use-live-info";
import { useLiveSessionOptional } from "@/lib/client/session-context";

export interface ReviewQueueRow {
  slug: string;
  title: string;
  tier: Tier;
  review: ReviewRow;
}

// Fixed, deterministic display order for domain filter chips — mirrors the
// canonical domain order (lib/domain/types.ts) rather than row-appearance
// order, so the chip row doesn't reshuffle as the queue's contents change.
const DOMAIN_ORDER: Domain[] = [
  "legal",
  "procurement",
  "tech-architecture",
  "responsible-ai",
  "security",
  "privacy-hipaa",
  "clinical-safety",
  "data-governance",
];

export function ReviewWorkbench({ rows }: { rows: ReviewQueueRow[] }) {
  const { reviewerDomain } = useRole();
  const [selected, setSelected] = React.useState<ReviewQueueRow | null>(null);
  const [override, setOverride] = React.useState<Domain | "all" | null>(null);

  const effectiveFilter = override ?? reviewerDomain ?? "all";
  const isPersonaDefault = override === null && reviewerDomain !== null;

  const presentDomains = DOMAIN_ORDER.filter((d) =>
    rows.some((row) => row.review.domain === d),
  );

  const filteredRows =
    effectiveFilter === "all"
      ? rows
      : rows.filter((row) => row.review.domain === effectiveFilter);

  // If the current selection got filtered out, don't show a hidden row's
  // detail panel — derive the displayed selection instead of reacting to
  // the filter change after the fact (avoids a setState-in-effect cascade).
  const visibleSelected =
    selected &&
    filteredRows.some(
      (row) => row.slug === selected.slug && row.review.domain === selected.review.domain,
    )
      ? selected
      : null;

  return (
    <div className="flex flex-col gap-6" data-slot="review-workbench">
      <Card>
        <CardHeader>
          <CardTitle>Reviewer queue</CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className="mb-4 flex flex-col gap-2"
            data-slot="review-domain-filter"
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setOverride("all")}
                className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                  effectiveFilter === "all"
                    ? "bg-primary text-primary-foreground"
                    : "border bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                All domains
                <span
                  className={`ml-1.5 tabular-nums ${
                    effectiveFilter === "all"
                      ? "text-primary-foreground/70"
                      : "text-muted-foreground/70"
                  }`}
                >
                  {rows.length}
                </span>
              </button>
              {presentDomains.map((domain) => {
                const count = rows.filter((row) => row.review.domain === domain).length;
                const isActive = effectiveFilter === domain;
                return (
                  <button
                    key={domain}
                    type="button"
                    onClick={() => setOverride(domain)}
                    className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "border bg-card text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {DOMAIN_LABEL[domain]}
                    <span
                      className={`ml-1.5 tabular-nums ${
                        isActive
                          ? "text-primary-foreground/70"
                          : "text-muted-foreground/70"
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
            {isPersonaDefault && reviewerDomain ? (
              <p className="text-xs text-muted-foreground">
                Showing your domain — {DOMAIN_LABEL[reviewerDomain]}. Switch
                persona in the top bar or pick another domain above.
              </p>
            ) : null}
          </div>
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
              {filteredRows.map((row) => (
                <TableRow
                  key={`${row.slug}-${row.review.domain}`}
                  onClick={() => setSelected(row)}
                  className="cursor-pointer"
                  data-selected={
                    visibleSelected?.slug === row.slug &&
                    visibleSelected?.review.domain === row.review.domain
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

      {visibleSelected ? (
        <div>
          <div className="mb-3 flex items-center gap-2 text-sm">
            <span className="font-semibold">
              {DOMAIN_LABEL[visibleSelected.review.domain]} review
            </span>
            <span className="text-muted-foreground">·</span>
            <Link
              href={`/initiatives/${visibleSelected.slug}?tab=reviews`}
              className="text-primary underline-offset-4 hover:underline"
            >
              {visibleSelected.title}
            </Link>
            <TierBadge tier={visibleSelected.tier} />
            <ReviewStatusBadge status={visibleSelected.review.status} />
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
                {visibleSelected.review.citations.length > 0 ? (
                  <ul className="space-y-1.5">
                    {visibleSelected.review.citations.map((c) => (
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
                  {visibleSelected.review.draftMd ?? "No draft yet for this domain."}
                </p>
              </CardContent>
            </Card>

            <AssessmentPane
              key={`${visibleSelected.slug}-${visibleSelected.review.domain}`}
              row={visibleSelected}
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
  const { reviewerDomain } = useRole();
  const live = useLiveSessionOptional();
  const session = live?.session ?? null;
  const liveInfo = useLiveInfo(row.slug);
  const cycleId = liveInfo?.cycleId ?? null;

  const [editedText, setEditedText] = React.useState(row.review.draftMd ?? "");
  const [pending, setPending] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [returnOpen, setReturnOpen] = React.useState(false);

  const canAct = Boolean(session?.role === "reviewer" && cycleId);
  const actionable = row.review.status === "drafted" || row.review.status === "returned";

  // On-demand agent run: only the reviewer assigned to THIS domain, in a live
  // session, may (re)draft it (the server enforces the same domain scope).
  const isOwnDomain = reviewerDomain === row.review.domain;
  const canRunAgent = Boolean(session?.role === "reviewer" && cycleId && isOwnDomain);
  const alreadySigned = row.review.status === "signed";
  const hasDraft = Boolean(row.review.draftMd);

  async function handleRunAgent() {
    if (!session || !cycleId) return;
    setRunning(true);
    try {
      const res = await runReviewAgent(session.token, cycleId, row.review.domain);
      if (res.status === "drafted") {
        if (res.draftMd) setEditedText(res.draftMd);
        toast.success(`${DOMAIN_LABEL[row.review.domain]} agent drafted a fresh assessment.`);
      } else {
        toast.error(`Agent run failed: ${res.error ?? "unknown error"}`);
      }
      router.refresh();
    } catch (err) {
      toast.error(isApiError(err) ? apiErrorToMessage(err) : "Agent run failed.");
      if (isApiError(err) && err.status === 401) live?.logout();
    } finally {
      setRunning(false);
    }
  }

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
        {canRunAgent ? (
          <div className="flex flex-col gap-1.5 border-b pb-3" data-slot="run-agent">
            <button
              type="button"
              onClick={() => void handleRunAgent()}
              disabled={running || alreadySigned}
              data-slot="run-agent-button"
              className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Bot className="h-4 w-4" aria-hidden />
              {running ? "Running agent…" : hasDraft ? "Re-run agent" : "Run agent to draft"}
            </button>
            <p className="text-xs text-muted-foreground">
              {alreadySigned
                ? "Signed — return this review to re-draft with the agent."
                : `Runs the ${DOMAIN_LABEL[row.review.domain]} agent live and loads the draft below. Agents draft — you decide.`}
            </p>
          </div>
        ) : null}
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
