"use client";

// Review workbench: queue across initiatives, then evidence sources, the
// selected submitted source, and the human assessment. Sign/Return are
// domain-review actions (hidden for Admin,
// disabled-with-tooltip without a live session — see role-gate.tsx).
//
// Live mode: the server-scoped review supplies its exact cycle; an assigned reviewer gets an
// EDITABLE assessment textarea and working Sign (submits the edited draft)
// and Return (mandatory-reason dialog) actions against the real API.
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ReviewRow } from "@/lib/data/dto";
import type { Domain, Tier } from "@/lib/domain/types";
import {
  QueueAgeCell,
  QueueAgingBadge,
  oldestUnsignedAgeMs,
  useClientNow,
} from "@/components/jeeves/queue-age";
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
  runReviewAgent,
} from "@/lib/client/api";
import { useLiveSessionOptional } from "@/lib/client/session-context";
import {
  getReviewActionEligibility,
  performReviewMutation,
} from "@/lib/client/review-actions";
import { ReviewEvidenceWorkspace } from "./review-evidence-workspace";

export interface ReviewQueueRow {
  slug: string;
  title: string;
  tier: Tier;
  isSeeded?: boolean;
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

// Per-domain glyph, purely decorative — pairs with DOMAIN_LABEL text so the
// queue table and workbench header read faster without relying on color
// alone. Mirrors the mapping in reviews-tab.tsx.
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

function DomainIcon({ domain, className }: { domain: Domain; className?: string }) {
  const Icon = DOMAIN_ICON[domain];
  return <Icon className={className} aria-hidden />;
}

export interface ReviewSelection {
  slug: string;
  domain: Domain;
}

export function ReviewWorkbench({ rows, selection, onSelectionChange }: {
  rows: ReviewQueueRow[];
  /** The route owns selection, including copied links and Back/Forward. */
  selection?: ReviewSelection | null;
  onSelectionChange?: (selection: ReviewSelection | null) => void;
}) {
  const { reviewerDomain } = useRole();
  const live = useLiveSessionOptional();
  const sessionKey = live?.session?.token ?? "public";
  const [localSelection, setLocalSelection] = React.useState<ReviewSelection | null>(null);
  const selected = selection === undefined ? localSelection : selection;
  const selectReview = onSelectionChange ?? setLocalSelection;
  const [drafts, setDrafts] = React.useState<Record<string, { text: string; revision: number | undefined; evidencePacketId: string | null }>>({});
  const [returnReasons, setReturnReasons] = React.useState<Record<string, string>>({});
  const [queueOpen, setQueueOpen] = React.useState(!selection);
  const [override, setOverride] = React.useState<Domain | "all" | null>(null);
  // Queue aging clock — null on server/first render (placeholder), then the
  // cached client time. See useClientNow above for the hydration rationale.
  const nowMs = useClientNow();

  const effectiveFilter = selected?.domain ?? override ?? reviewerDomain ?? "all";
  const isPersonaDefault = !selected && override === null && reviewerDomain !== null;

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
  const visibleSelected = selected
    ? filteredRows.find(
        (row) => row.slug === selected.slug && row.review.domain === selected.domain,
      ) ?? null
    : null;
  const draftKey = visibleSelected
    ? `${sessionKey}:${visibleSelected.slug}:${visibleSelected.review.domain}:${visibleSelected.review.cycleId ?? visibleSelected.review.createdAt}`
    : "";

  return (
    <div className="flex flex-col gap-6" data-slot="review-workbench">
      {visibleSelected && !queueOpen ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-muted-foreground">Reviewer queue · {filteredRows.length} reviews in this view</p>
          <button type="button" onClick={() => setQueueOpen(true)} className="touch-min rounded-md border bg-card px-3 py-2 font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Change review</button>
        </div>
      ) : <Card>
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
                onClick={() => { setOverride("all"); selectReview(null); }}
                aria-pressed={effectiveFilter === "all"}
                className={`touch-min rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
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
                <QueueAgingBadge ageMs={oldestUnsignedAgeMs(rows.map((r) => r.review), nowMs)} />
              </button>
              {presentDomains.map((domain) => {
                const domainRows = rows.filter((row) => row.review.domain === domain);
                const isActive = effectiveFilter === domain;
                return (
                  <button
                    key={domain}
                    type="button"
                    onClick={() => { setOverride(domain); selectReview(null); }}
                    aria-pressed={isActive}
                    className={`touch-min rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
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
                      {domainRows.length}
                    </span>
                    <QueueAgingBadge ageMs={oldestUnsignedAgeMs(domainRows.map((r) => r.review), nowMs)} />
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
                <TableHead>Age</TableHead>
                <TableHead>Reviewer</TableHead>
                <TableHead>Last updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRows.map((row) => {
                return (
                <TableRow
                  key={`${row.slug}-${row.review.domain}`}
                  data-selected={
                    visibleSelected?.slug === row.slug &&
                    visibleSelected?.review.domain === row.review.domain
                  }
                >
                  <TableCell>
                    <button
                      type="button"
                      onClick={() => {
                        selectReview({ slug: row.slug, domain: row.review.domain });
                        setQueueOpen(false);
                      }}
                      aria-label={`Open ${DOMAIN_LABEL[row.review.domain]} review for ${row.title}`}
                      className="text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="font-medium">{row.title}</span>{" "}
                      <span className="text-xs text-muted-foreground">{row.slug}</span>
                    </button>
                  </TableCell>
                  <TableCell>
                    <TierBadge tier={row.tier} />
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1.5">
                      <DomainIcon domain={row.review.domain} className="size-3.5 shrink-0 text-muted-foreground" />
                      {DOMAIN_LABEL[row.review.domain]}
                    </span>
                  </TableCell>
                  <TableCell>
                    <ReviewStatusBadge status={row.review.status} />
                  </TableCell>
                  <TableCell>
                    <QueueAgeCell
                      createdAt={row.review.createdAt}
                      status={row.review.status}
                      nowMs={nowMs}
                    />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.review.reviewer ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.review.signedAt?.slice(0, 10) ?? "—"}
                  </TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>}

      {visibleSelected ? (
        <div>
          <div className="mb-5 flex flex-wrap items-center gap-2 text-sm">
            <h2 className="flex items-center gap-2 text-xl font-semibold">
              <DomainIcon domain={visibleSelected.review.domain} className="size-4 shrink-0 text-muted-foreground" />
              {DOMAIN_LABEL[visibleSelected.review.domain]} review
            </h2>
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

          <ReviewEvidenceWorkspace
            slug={visibleSelected.slug}
            domain={visibleSelected.review.domain}
            citations={visibleSelected.review.citations}
            citationProvenance={visibleSelected.review.citationProvenance}
            missingEvidence={visibleSelected.review.missingEvidence}
            evidenceRequests={visibleSelected.review.evidenceRequests}
            reviewStatus={visibleSelected.review.status}
            reviewCycleId={visibleSelected.review.cycleId}
          >
            {({ signingBlock, cycleId, cycleChanged, evidencePacketId }) => (
            <AssessmentPane
              key={draftKey}
              row={visibleSelected}
              signingBlock={signingBlock}
              evidenceCycleId={cycleId}
              cycleChanged={cycleChanged}
              evidencePacketId={evidencePacketId}
              editedRevision={drafts[draftKey]?.revision}
              editedEvidencePacketId={drafts[draftKey]?.evidencePacketId}
              returnReason={returnReasons[draftKey] ?? ""}
              onReturnReasonChange={(reason) => setReturnReasons((current) => ({ ...current, [draftKey]: reason }))}
              onReviewedRevision={() => setDrafts((current) => ({
                ...current,
                [draftKey]: { text: current[draftKey]?.text ?? visibleSelected.review.draftMd ?? "", revision: visibleSelected.review.revision, evidencePacketId },
              }))}
              editedText={
                drafts[draftKey]?.text ??
                visibleSelected.review.draftMd ??
                ""
              }
              onEditedTextChange={(value) =>
                setDrafts((current) => ({
                  ...current,
                  [draftKey]: { text: value, revision: current[draftKey]?.revision ?? visibleSelected.review.revision, evidencePacketId: current[draftKey] ? current[draftKey].evidencePacketId : evidencePacketId },
                }))
              }
              onLoadCurrentDraft={() => setDrafts((current) => ({
                ...current,
                [draftKey]: {
                  text: visibleSelected.review.draftMd ?? "",
                  revision: current[draftKey]?.revision ?? visibleSelected.review.revision,
                  evidencePacketId: current[draftKey] ? current[draftKey].evidencePacketId : evidencePacketId,
                },
              }))}
            />
            )}
          </ReviewEvidenceWorkspace>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
          {selected
            ? "This review is not available in the current workspace. Choose a review from the queue."
            : rows.length === 0
            ? "Nothing is awaiting signature. Drafts that have not started remain available from the initiative’s Reviews tab."
            : "Select a review to inspect its evidence, verify the sources, and record your assessment."}
        </p>
      )}
    </div>
  );
}

/**
 * Right pane — editable assessment + Sign/Return. Keyed by slug+domain from
 * the parent so its draft-edit state re-initializes per selection.
 */
function AssessmentPane({
  row,
  editedText,
  onEditedTextChange,
  onLoadCurrentDraft,
  signingBlock,
  evidenceCycleId,
  cycleChanged,
  evidencePacketId,
  editedRevision,
  editedEvidencePacketId,
  onReviewedRevision,
  returnReason,
  onReturnReasonChange,
}: {
  row: ReviewQueueRow;
  editedText: string;
  onEditedTextChange: (value: string) => void;
  onLoadCurrentDraft: () => void;
  signingBlock: string | null;
  evidenceCycleId: string | null;
  cycleChanged: boolean;
  evidencePacketId: string | null;
  editedRevision?: number;
  editedEvidencePacketId?: string | null;
  onReviewedRevision: () => void;
  returnReason: string;
  onReturnReasonChange: (reason: string) => void;
}) {
  const router = useRouter();
  const live = useLiveSessionOptional();
  const session = live?.session ?? null;
  const cycleId = cycleChanged || row.isSeeded === true ? null : row.review.cycleId ?? evidenceCycleId ?? null;

  const [pending, setPending] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [returnOpen, setReturnOpen] = React.useState(false);
  const mounted = React.useRef(false);
  React.useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const [returnRevision, setReturnRevision] = React.useState<number | null>(null);
  const [conflict, setConflict] = React.useState<{ revision: number; packetId: string | null } | null>(null);
  const staleEdits = (editedRevision !== undefined && editedRevision !== row.review.revision) ||
    (editedEvidencePacketId !== undefined && editedEvidencePacketId !== evidencePacketId);
  const mustReviewAgain = staleEdits || Boolean(conflict);
  const refreshedAfterConflict = !conflict || conflict.revision !== row.review.revision || conflict.packetId !== evidencePacketId;

  const eligibility = getReviewActionEligibility(
    session,
    cycleId,
    row.review.domain,
    row.review.status,
    row.review.revision,
  );
  const alreadySigned = row.review.status === "signed";
  const hasDraft = Boolean(row.review.draftMd);

  async function handleRunAgent() {
    if (!session || !cycleId || !eligibility.canRunAgent || pending || mustReviewAgain) return;
    setRunning(true);
    try {
      const res = await runReviewAgent(session.token, cycleId, row.review.domain, row.review.revision);
      if (!mounted.current) return;
      if (res.status === "drafted") {
        toast.success(`${DOMAIN_LABEL[row.review.domain]} agent drafted a fresh assessment.`);
      } else if (res.status === "skipped") {
        toast.info(`Agent result was not applied (${res.reason ?? "review changed"}). Refresh and review the current assessment.`);
      } else {
        toast.error(`Agent run failed: ${res.error ?? "unknown error"}`);
      }
      router.refresh();
    } catch (err) {
      if (!mounted.current) return;
      toast.error(isApiError(err) ? apiErrorToMessage(err) : "Agent run failed.");
      if (isApiError(err) && err.status === 401) live?.logout();
    } finally {
      if (mounted.current) setRunning(false);
    }
  }

  async function handleSign() {
    if (!session || !cycleId || signingBlock || pending || running || !eligibility.canSignOrReturn || mustReviewAgain || row.review.revision === undefined) return;
    setPending(true);
    try {
      await performReviewMutation(
        session.token,
        cycleId,
        row.review.domain,
        {
          kind: "sign",
          expectedRevision: row.review.revision,
          expectedEvidencePacketId: evidencePacketId,
          editedDraftMd:
            editedText !== (row.review.draftMd ?? "") ? editedText : undefined,
        },
      );
      if (!mounted.current) return;
      toast.success(`${DOMAIN_LABEL[row.review.domain]} review signed.`);
      router.refresh();
    } catch (err) {
      if (!mounted.current) return;
      if (isApiError(err) && err.status === 409) {
        setConflict({ revision: row.review.revision, packetId: evidencePacketId });
        router.refresh();
      }
      toast.error(isApiError(err) ? apiErrorToMessage(err) : "Sign failed.");
      if (isApiError(err) && err.status === 401) live?.logout();
    } finally {
      if (mounted.current) setPending(false);
    }
  }

  async function handleReturn(reason: string) {
    if (!session || !cycleId || returnRevision === null || pending || running || mustReviewAgain) return;
    setPending(true);
    onReturnReasonChange(reason);
    try {
      await performReviewMutation(session.token, cycleId, row.review.domain, {
        kind: "return",
        reason,
        expectedRevision: returnRevision,
      });
      if (!mounted.current) return;
      setReturnOpen(false);
      toast.success(`${DOMAIN_LABEL[row.review.domain]} review returned.`);
      router.refresh();
    } catch (err) {
      if (!mounted.current) return;
      if (isApiError(err) && err.status === 409) {
        setConflict({ revision: returnRevision, packetId: evidencePacketId });
        setReturnOpen(false);
        router.refresh();
      }
      toast.error(isApiError(err) ? apiErrorToMessage(err) : "Return failed.");
      if (isApiError(err) && err.status === 401) live?.logout();
    } finally {
      if (mounted.current) setPending(false);
    }
  }

  return (
    <Card className="min-w-0 overflow-hidden" data-slot="review-assessment">
      <CardHeader className="border-b py-4">
        <CardTitle>Your assessment</CardTitle>
        <p className="text-xs text-muted-foreground">{DOMAIN_LABEL[row.review.domain]} · Human domain review</p>
      </CardHeader>
      <CardContent className="space-y-3 pt-4">
        <details className="rounded-lg border bg-primary/5 p-3">
          <summary className="cursor-pointer rounded-sm text-xs font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">AI draft · verify against evidence</summary>
          <p className="mt-3 max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{row.review.draftMd ?? "No draft yet for this domain."}</p>
        </details>
        {eligibility.canRunAgent ? (
          <div className="flex flex-col gap-1.5 border-b pb-3" data-slot="run-agent">
            <button
              type="button"
              onClick={() => void handleRunAgent()}
              disabled={running || pending || alreadySigned || mustReviewAgain}
              data-slot="run-agent-button"
              className="inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
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
          className="min-h-56 w-full rounded-md border border-input bg-transparent p-3 text-sm leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
          value={editedText}
          onChange={(e) => onEditedTextChange(e.target.value)}
          disabled={!eligibility.canEdit || pending || running}
          maxLength={20_000}
          aria-label="Assessment text"
          data-slot="assessment-textarea"
        />
        {row.review.revision === undefined && !alreadySigned ? <p role="status" className="text-sm text-muted-foreground">Refresh this review to load its version before editing or signing.</p> : null}
        {mustReviewAgain && !alreadySigned ? <div role="alert" className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <p>This review or its evidence changed. Refresh and review the latest draft and evidence again. Your assessment edits are preserved.</p>
          <button type="button" className="rounded-md border px-3 py-2 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" disabled={Boolean(signingBlock) || !refreshedAfterConflict || row.review.revision === undefined} onClick={() => { onReviewedRevision(); setConflict(null); }}>I reviewed the refreshed draft and evidence</button>
          <p className="text-xs">Compare the AI draft above with your assessment, check the submitted sources, and update your edits before acknowledging.</p>
          <button type="button" disabled={Boolean(signingBlock) || !refreshedAfterConflict || row.review.revision === undefined} onClick={onLoadCurrentDraft} className="min-h-11 font-medium underline underline-offset-4 disabled:opacity-50">Discard edits and load current draft</button>
        </div> : null}
        {signingBlock && !alreadySigned ? <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">{signingBlock}</p> : null}
        {alreadySigned ? <p className="rounded-lg border bg-muted/30 p-3 text-sm">Signed by {row.review.reviewer ?? "the assigned reviewer"}{row.review.signedAt ? ` on ${row.review.signedAt.slice(0, 10)}` : ""}. This domain review is read-only.</p> : null}
        <div className="flex flex-wrap gap-2">
          <GatedActionButton
            label="Sign"
            requiresRole="reviewer"
            pending={pending || running || Boolean(signingBlock) || mustReviewAgain}
            pendingLabel={pending ? "Signing…" : "Sign"}
            onAction={eligibility.canSignOrReturn ? () => void handleSign() : undefined}
          />
          <GatedActionButton
            label="Return"
            variant="outline"
            requiresRole="reviewer"
            pending={pending || running || mustReviewAgain}
            onAction={eligibility.canSignOrReturn ? () => { setReturnRevision(row.review.revision!); setReturnOpen(true); } : undefined}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Sign records this domain’s review, not overall initiative approval.
          Return requires a reason. Both actions write an audit event.
        </p>
      </CardContent>

      <ReturnReviewDialog
        open={returnOpen}
        onOpenChange={setReturnOpen}
        domainLabel={DOMAIN_LABEL[row.review.domain]}
        pending={pending}
        initialReason={returnReason}
        onConfirm={(reason) => void handleReturn(reason)}
      />
    </Card>
  );
}
