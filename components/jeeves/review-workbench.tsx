"use client";

// Review workbench: queue across initiatives, then evidence sources, the
// selected submitted source, and the human assessment. Sign/Return are
// domain-review actions (hidden for Admin,
// disabled-with-tooltip without a live session — see role-gate.tsx).
//
// Live mode: the server-scoped review supplies its exact cycle; an assigned reviewer gets an
// EDITABLE assessment textarea and working Sign (submits the edited draft)
// and Return (mandatory-reason dialog) actions against the real API.
//
// Unsaved work (assessment text, a typed return reason, an abstention reason
// whose submission failed) is also mirrored per persona and review into this browser
// tab's sessionStorage (lib/client/review-unsaved-store.ts). After the session
// ends, the same persona is offered it back on the same review and cycle and
// chooses Restore or Discard; nothing is applied automatically. Demo mode only:
// a production install never mirrors assessment text into the browser.
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
import { ReasonDialog } from "./reason-dialog";
import { ReturnReviewDialog } from "./return-review-dialog";
import { useRole } from "./role-context";
import {
  apiErrorToMessage,
  isApiError,
  runReviewAgent,
} from "@/lib/client/api";
import { useLiveSessionOptional } from "@/lib/client/session-context";
import { useDeploymentMode } from "@/lib/client/deployment-mode-context";
import { findPersona } from "@/lib/client/personas";
import {
  clearUnsavedReview,
  dropStoredReturnReason,
  readUnsavedReview,
  writeUnsavedReview,
  type UnsavedReview,
} from "@/lib/client/review-unsaved-store";
import {
  getReviewActionEligibility,
  performReviewMutation,
} from "@/lib/client/review-actions";
import { ReviewEvidenceWorkspace } from "./review-evidence-workspace";

export interface ReviewQueueRow {
  slug: string;
  title: string;
  tier: Tier | null;
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
  const [abstainReasons, setAbstainReasons] = React.useState<Record<string, string>>({});
  const [queueOpen, setQueueOpen] = React.useState(!selection);
  const [override, setOverride] = React.useState<Domain | "all" | null>(null);
  // Queue aging clock — null on server/first render (placeholder), then the
  // cached client time. See useClientNow above for the hydration rationale.
  const nowMs = useClientNow();
  // Focus handoff after the focused control unmounts (WCAG 2.4.3): set only by
  // explicit user actions so deep links and Back/Forward never steal focus.
  const rootRef = React.useRef<HTMLDivElement>(null);
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const pendingFocus = React.useRef<"review" | "queue" | null>(null);

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

  const selectedSlug = visibleSelected?.slug;
  const selectedDomain = visibleSelected?.review.domain;
  React.useEffect(() => {
    if (pendingFocus.current === "review" && !queueOpen && headingRef.current) {
      headingRef.current.focus();
      pendingFocus.current = null;
    } else if (pendingFocus.current === "queue" && queueOpen) {
      rootRef.current?.querySelector<HTMLElement>('[data-selected="true"] button')?.focus();
      pendingFocus.current = null;
    }
  }, [queueOpen, selectedSlug, selectedDomain]);

  return (
    <div ref={rootRef} className="flex flex-col gap-6" data-slot="review-workbench">
      {visibleSelected && !queueOpen ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-muted-foreground">Reviewer queue · {filteredRows.length} reviews in this view</p>
          <button type="button" onClick={() => { pendingFocus.current = "queue"; setQueueOpen(true); }} className="touch-min rounded-md border bg-card px-3 py-2 font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Change review</button>
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
          <Table containerLabel="Domain reviews">
            <TableHeader>
              <TableRow>
                <TableHead>Initiative</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead>Domain</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Age</TableHead>
                <TableHead>Reviewer</TableHead>
                <TableHead>Signed</TableHead>
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
                        pendingFocus.current = "review";
                        selectReview({ slug: row.slug, domain: row.review.domain });
                        setQueueOpen(false);
                      }}
                      aria-current={
                        visibleSelected?.slug === row.slug &&
                        visibleSelected?.review.domain === row.review.domain
                          ? "true"
                          : undefined
                      }
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
            <h2 ref={headingRef} tabIndex={-1} className="flex items-center gap-2 text-xl font-semibold focus-visible:outline-none">
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
            isSeeded={visibleSelected.isSeeded === true}
            reviewCycleId={visibleSelected.review.cycleId}
          >
            {({ signingBlock, cycleId, cycleChanged, evidencePacketId, evidenceLoading }) => (
            <AssessmentPane
              key={draftKey}
              row={visibleSelected}
              signingBlock={signingBlock}
              evidenceCycleId={cycleId}
              cycleChanged={cycleChanged}
              evidencePacketId={evidencePacketId}
              evidenceLoading={evidenceLoading}
              editedRevision={drafts[draftKey]?.revision}
              editedEvidencePacketId={drafts[draftKey]?.evidencePacketId}
              returnReason={returnReasons[draftKey] ?? ""}
              onReturnReasonChange={(reason) => setReturnReasons((current) => ({ ...current, [draftKey]: reason }))}
              abstainReason={abstainReasons[draftKey] ?? ""}
              onAbstainReasonChange={(reason) => setAbstainReasons((current) => ({ ...current, [draftKey]: reason }))}
              hasLocalEdits={drafts[draftKey] !== undefined || returnReasons[draftKey] !== undefined || abstainReasons[draftKey] !== undefined}
              onRestoreUnsaved={({ text, revision, evidencePacketId: packetId }) => setDrafts((current) => ({
                ...current,
                [draftKey]: { text, revision: revision ?? visibleSelected.review.revision, evidencePacketId: packetId },
              }))}
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

function offerParts(offer: UnsavedReview): string {
  const parts = [
    offer.text !== undefined ? "assessment edits" : null,
    offer.returnReason ? "a typed return reason" : null,
    offer.abstainReason ? "an abstention reason whose submission failed" : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0] ?? "work";
}

/**
 * Right pane — editable assessment + Sign/Return. Keyed by slug+domain from
 * the parent so its draft-edit state re-initializes per selection. Its unsaved
 * work is mirrored to sessionStorage and, once per mount, offered back to the
 * same persona on the same review cycle (never applied without a choice).
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
  evidenceLoading,
  editedRevision,
  editedEvidencePacketId,
  onReviewedRevision,
  returnReason,
  onReturnReasonChange,
  abstainReason,
  onAbstainReasonChange,
  hasLocalEdits,
  onRestoreUnsaved,
}: {
  row: ReviewQueueRow;
  editedText: string;
  onEditedTextChange: (value: string) => void;
  onLoadCurrentDraft: () => void;
  signingBlock: string | null;
  evidenceCycleId: string | null;
  cycleChanged: boolean;
  evidencePacketId: string | null;
  evidenceLoading: boolean;
  editedRevision?: number;
  editedEvidencePacketId?: string | null;
  onReviewedRevision: () => void;
  returnReason: string;
  onReturnReasonChange: (reason: string) => void;
  abstainReason: string;
  onAbstainReasonChange: (reason: string) => void;
  hasLocalEdits: boolean;
  onRestoreUnsaved: (work: { text: string; revision: number | null; evidencePacketId: string | null }) => void;
}) {
  const router = useRouter();
  const live = useLiveSessionOptional();
  const session = live?.session ?? null;
  const cycleId = cycleChanged || row.isSeeded === true || row.review.cycleOpen === false ? null : row.review.cycleId ?? evidenceCycleId ?? null;

  const [pending, setPending] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [returnOpen, setReturnOpen] = React.useState(false);
  const [returnError, setReturnError] = React.useState<string | null>(null);
  const [abstainRevision, setAbstainRevision] = React.useState<number | null>(null);
  const [abstainError, setAbstainError] = React.useState<string | null>(null);
  const mounted = React.useRef(false);
  React.useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const cycleKey = row.review.cycleId ?? row.review.createdAt;
  // The unsaved-work store is a demo convenience: production never touches it.
  const demo = useDeploymentMode() === "demo";
  const [offer, setOffer] = React.useState<UnsavedReview | null>(() => {
    if (!demo || !session || session.role === "public" || hasLocalEdits) return null;
    const entry = readUnsavedReview({ personaKey: session.personaKey, slug: row.slug, domain: row.review.domain, cycleKey });
    if (!entry) return null;
    const text = entry.text !== undefined && entry.text !== (row.review.draftMd ?? "") ? entry.text : undefined;
    return text === undefined && !entry.returnReason && !entry.abstainReason ? null : { ...entry, text };
  });
  const offerHeadingId = React.useId();
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const focusAfterOffer = React.useRef(false);
  React.useEffect(() => {
    if (offer === null && focusAfterOffer.current) {
      focusAfterOffer.current = false;
      textareaRef.current?.focus();
    }
  }, [offer]);
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
  const offerShown = offer !== null && !alreadySigned && (eligibility.canEdit || eligibility.canAbstain);
  React.useEffect(() => {
    if (offerShown) toast.info("Unsaved work from an earlier session is available to restore above your assessment.", { id: "unsaved-review-offer" });
  }, [offerShown]);
  // Mirrors the reviewer's unsaved work for this review into this tab. Each
  // caller passes the field it has just changed; the others come from props.
  // Returns true only when a non-empty entry was stored.
  function persistUnsaved(o: { text?: string; returnReason?: string; abstainReason?: string }): boolean {
    if (!demo || !session || session.role === "public" || offer !== null) return false;
    const text = "text" in o ? o.text : editedText;
    const reason = "returnReason" in o ? o.returnReason : returnReason;
    const abstain = "abstainReason" in o ? o.abstainReason : abstainReason;
    return writeUnsavedReview({
      personaKey: session.personaKey,
      personaLabel: personaLabelOf(session),
      slug: row.slug,
      domain: row.review.domain,
      cycleKey,
      revision: editedRevision !== undefined ? editedRevision : row.review.revision ?? null,
      evidencePacketId: editedEvidencePacketId !== undefined ? editedEvidencePacketId : evidencePacketId,
      text: text !== undefined && text !== (row.review.draftMd ?? "") ? text : undefined,
      returnReason: reason || undefined,
      abstainReason: abstain || undefined,
    });
  }
  const personaLabelOf = (s: { personaKey: string; personaLabel?: string }) => s.personaLabel ?? findPersona(s.personaKey)?.label ?? "This persona";
  const keptMessage = (label: string) => `Your session expired. Your unsaved work is kept in this browser tab. Start the demo again as ${label} to restore it.`;
  function restoreUnsaved() {
    if (!offer) return;
    if (offer.text !== undefined) onRestoreUnsaved({ text: offer.text, revision: offer.revision, evidencePacketId: offer.evidencePacketId });
    if (offer.returnReason) onReturnReasonChange(offer.returnReason);
    if (offer.abstainReason) onAbstainReasonChange(offer.abstainReason);
    focusAfterOffer.current = true;
    setOffer(null);
  }
  function discardUnsaved() {
    if (demo && session) clearUnsavedReview(session.personaKey, row.slug, row.review.domain);
    focusAfterOffer.current = true;
    setOffer(null);
  }
  // One list of conditions for both buttons, each worded for its own action.
  const disabledReasonFor = (action: "sign" | "return") => {
    const signing = action === "sign";
    return !eligibility.isOwnDomain ? `Only the ${DOMAIN_LABEL[row.review.domain]} reviewer can sign or return this review`
      : row.review.status === "signed" ? "Already signed"
      : row.review.status === "abstained" ? (signing ? "Resume the review before signing" : "Resume the review before returning it")
      : row.review.status === "pending" ? (signing ? "Run the agent to draft this review before signing" : "Run the agent to draft this review before returning it")
      : row.isSeeded === true ? (signing ? "This is a read-only example; open a live review to sign" : "This is a read-only example; open a live review to return one")
      : cycleChanged ? "Refresh to load the current review cycle"
      : signing ? "This review is not open for signing right now" : "This review is not open for return right now";
  };
  const signDisabledReason = disabledReasonFor("sign");
  const returnDisabledReason = disabledReasonFor("return");
  const hasDraft = Boolean(row.review.draftMd);
  const blankAssessment = editedText.trim() === "";

  async function handleRunAgent() {
    if (!session || !cycleId || !eligibility.canRunAgent || pending || mustReviewAgain || offerShown) return;
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
      const unauthorized = isApiError(err) && err.status === 401;
      const kept = unauthorized && persistUnsaved({});
      toast.error(kept ? keptMessage(personaLabelOf(session)) : isApiError(err) ? apiErrorToMessage(err) : "Agent run failed.");
      if (unauthorized) live?.logout();
    } finally {
      if (mounted.current) setRunning(false);
    }
  }

  async function handleSign() {
    if (!session || !cycleId || signingBlock || pending || running || !eligibility.canSignOrReturn || mustReviewAgain || blankAssessment || offerShown || row.review.revision === undefined) return;
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
      if (demo) clearUnsavedReview(session.personaKey, row.slug, row.review.domain);
      if (!mounted.current) return;
      toast.success(`${DOMAIN_LABEL[row.review.domain]} review signed.`);
      router.refresh();
    } catch (err) {
      if (!mounted.current) return;
      if (isApiError(err) && err.status === 409) {
        setConflict({ revision: row.review.revision, packetId: evidencePacketId });
        router.refresh();
      }
      const unauthorized = isApiError(err) && err.status === 401;
      const kept = unauthorized && persistUnsaved({});
      toast.error(kept ? keptMessage(personaLabelOf(session)) : isApiError(err) ? apiErrorToMessage(err) : "Sign failed.");
      if (unauthorized) live?.logout();
    } finally {
      if (mounted.current) setPending(false);
    }
  }

  async function handleReturn(reason: string) {
    if (!session || !cycleId || returnRevision === null || pending || running || mustReviewAgain) return;
    setPending(true);
    setReturnError(null);
    onReturnReasonChange(reason);
    persistUnsaved({ returnReason: reason });
    try {
      await performReviewMutation(session.token, cycleId, row.review.domain, {
        kind: "return",
        reason,
        expectedRevision: returnRevision,
      });
      // Recorded: the stored copy of this reason must not be offered back, even if the pane has gone.
      if (demo) dropStoredReturnReason({ personaKey: session.personaKey, slug: row.slug, domain: row.review.domain, cycleKey }, reason);
      if (!mounted.current) return;
      setReturnOpen(false);
      onReturnReasonChange("");
      persistUnsaved({ returnReason: "" });
      toast.success(`${DOMAIN_LABEL[row.review.domain]} review returned.`);
      router.refresh();
    } catch (err) {
      if (!mounted.current) return;
      if (isApiError(err) && err.status === 409) {
        setConflict({ revision: returnRevision, packetId: evidencePacketId });
        setReturnOpen(false);
        router.refresh();
      }
      const unauthorized = isApiError(err) && err.status === 401;
      const kept = unauthorized && persistUnsaved({ returnReason: reason });
      const returnMessage = kept ? keptMessage(personaLabelOf(session)) : isApiError(err) ? apiErrorToMessage(err) : "Return failed.";
      if (!(isApiError(err) && err.status === 409)) setReturnError(returnMessage);
      toast.error(returnMessage);
      if (unauthorized) live?.logout();
    } finally {
      if (mounted.current) setPending(false);
    }
  }

  async function handleAbstention(kind: "abstain" | "resume", reason?: string) {
    const expectedRevision = kind === "abstain" ? abstainRevision : row.review.revision;
    if (!session || !cycleId || expectedRevision == null || pending ||
      (kind === "abstain" ? !eligibility.canAbstain : !eligibility.canResume)) return;
    setPending(true);
    setAbstainError(null);
    try {
      await performReviewMutation(session.token, cycleId, row.review.domain,
        kind === "abstain" ? { kind, reason: reason!, expectedRevision } : { kind, expectedRevision });
      if (!mounted.current) return;
      setAbstainRevision(null);
      if (kind === "abstain") {
        onAbstainReasonChange("");
        persistUnsaved({ abstainReason: "" });
      }
      toast.success(kind === "abstain" ? "Abstention recorded. The review can continue without your sign-off." : "Review resumed. Complete the review before signing.");
      router.refresh();
    } catch (err) {
      if (!mounted.current) return;
      const unauthorized = isApiError(err) && err.status === 401;
      const kept = unauthorized && persistUnsaved(kind === "abstain" ? { abstainReason: reason } : {});
      const message = kept ? keptMessage(personaLabelOf(session)) : isApiError(err) ? apiErrorToMessage(err) : "The review could not be updated.";
      setAbstainError(message);
      toast.error(message);
      if (isApiError(err) && err.status === 409) router.refresh();
      if (unauthorized) live?.logout();
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
              disabled={running || pending || alreadySigned || mustReviewAgain || offerShown}
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
        {offerShown && offer ? <div role="region" aria-labelledby={offerHeadingId} data-slot="unsaved-review-offer" className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <h3 id={offerHeadingId} className="font-medium">Unsaved work from an earlier session</h3>
          <p>{offer.personaLabel} has unsaved work for this review from an earlier session: {offerParts(offer)}. It was kept in this browser tab only. Restore it to keep working, or discard it.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="rounded-md border px-3 py-2 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={restoreUnsaved}>Restore unsaved work</button>
            <button type="button" className="rounded-md border px-3 py-2 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={discardUnsaved}>Discard unsaved work</button>
          </div>
        </div> : null}
        <textarea
          ref={textareaRef}
          className="min-h-56 w-full rounded-md border border-input bg-transparent p-3 text-sm leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
          value={editedText}
          onChange={(e) => { onEditedTextChange(e.target.value); persistUnsaved({ text: e.target.value }); }}
          disabled={!eligibility.canEdit || pending || running || evidenceLoading || offerShown}
          maxLength={20_000}
          aria-label="Assessment text"
          data-slot="assessment-textarea"
        />
        {row.review.revision === undefined && !alreadySigned ? <p role="status" className="text-sm text-muted-foreground">Refresh this review to load its version before editing or signing.</p> : null}
        {mustReviewAgain && !alreadySigned ? <div role="alert" className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <p>This review or its evidence changed. Refresh and review the latest draft and evidence again. Your assessment edits are preserved.</p>
          <button type="button" className="rounded-md border px-3 py-2 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" disabled={Boolean(signingBlock) || !refreshedAfterConflict || row.review.revision === undefined} onClick={() => { onReviewedRevision(); setConflict(null); }}>I reviewed the refreshed draft and evidence</button>
          <p className="text-xs">Compare the AI draft above with your assessment, check the submitted sources, and update your edits before acknowledging.</p>
          <button type="button" disabled={Boolean(signingBlock) || !refreshedAfterConflict || row.review.revision === undefined} onClick={() => { onLoadCurrentDraft(); persistUnsaved({ text: row.review.draftMd ?? "" }); }} className="min-h-11 font-medium underline underline-offset-4 disabled:opacity-50">Discard edits and load current draft</button>
        </div> : null}
        {blankAssessment && eligibility.canSignOrReturn && !alreadySigned ? <p role="status" className="text-xs text-muted-foreground">Write an assessment before signing.</p> : null}
        {signingBlock && !alreadySigned ? <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">{signingBlock}</p> : null}
        {alreadySigned ? <p className="rounded-lg border bg-muted/30 p-3 text-sm">Signed by {row.review.reviewer ?? "the assigned reviewer"}{row.review.signedAt ? ` on ${row.review.signedAt.slice(0, 10)}` : ""}. This domain review is read-only.</p> : null}
        {row.review.status === "abstained" ? <div role="status" className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <p className="font-medium">{row.review.abstention ? "Abstained · Review continues without your sign-off" : "Abstained · Audit record unavailable"}</p>
          {row.review.abstention ? <><p>{row.review.abstention.reason}</p><p className="text-xs">Recorded by {row.review.abstention.reviewer} on {row.review.abstention.at.slice(0, 10)}.</p></> : <p>Refresh to load the abstention record.</p>}
          <p>{row.review.cycleOpen === false ? "This review cycle is closed. The abstention is retained in the decision history." : "You may resume before the final decision if you choose to participate. The review can continue without you."}</p>
        </div> : null}
        <div className="flex flex-wrap gap-2">
          {eligibility.canAbstain ? <button type="button" className="rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-50" disabled={pending} onClick={() => { setAbstainError(null); setAbstainRevision(row.review.revision!); }}>Abstain</button> : null}
          {eligibility.canResume ? <button type="button" className="rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-50" disabled={pending} onClick={() => void handleAbstention("resume")}>Resume review</button> : null}
          <GatedActionButton
            label="Sign"
            requiresRole="reviewer"
            disabledReason={signDisabledReason}
            pending={pending || running || Boolean(signingBlock) || mustReviewAgain || blankAssessment || offerShown}
            pendingLabel={pending ? "Signing…" : "Sign"}
            onAction={eligibility.canSignOrReturn ? () => void handleSign() : undefined}
          />
          <GatedActionButton
            label="Return"
            variant="outline"
            requiresRole="reviewer"
            disabledReason={returnDisabledReason}
            pending={pending || running || mustReviewAgain || offerShown}
            onAction={eligibility.canSignOrReturn ? () => { setReturnError(null); setReturnRevision(row.review.revision!); setReturnOpen(true); } : undefined}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Sign records this domain’s review, not overall initiative approval.
          Return and Abstain require a reason and are audited. Abstention is not a signature; the other reviewers continue and the approver decides.
        </p>
      </CardContent>

      <ReasonDialog
        open={abstainRevision !== null}
        onOpenChange={(open) => { if (!open && !pending) setAbstainRevision(null); }}
        title={`Abstain from ${DOMAIN_LABEL[row.review.domain]} review`}
        description="Record why you cannot provide this review. The remaining reviews continue without your sign-off, and the approver makes the final decision. You can resume before that decision closes the review cycle."
        confirmLabel="Record abstention"
        pendingLabel="Recording abstention…"
        pending={pending}
        error={abstainError}
        initialReason={abstainReason}
        onConfirm={(reason) => void handleAbstention("abstain", reason)}
      />
      <ReturnReviewDialog
        open={returnOpen}
        onOpenChange={setReturnOpen}
        domainLabel={DOMAIN_LABEL[row.review.domain]}
        pending={pending}
        initialReason={returnReason}
        error={returnError}
        onReasonChange={onReturnReasonChange}
        onConfirm={(reason) => void handleReturn(reason)}
      />
    </Card>
  );
}
