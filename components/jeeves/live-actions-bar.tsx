"use client";

/**
 * Live governance actions for an initiative detail page (task deliverable:
 * live-mode UI over the real /api routes).
 *
 * Renders NOTHING unless (a) a live demo session is active AND (b) this
 * initiative was created during this browser session (the live registry
 * knows its DB initiativeId — the read-model DTOs deliberately expose only
 * the slug, and the 12 seeded initiatives have no client-reachable id, so
 * their pages keep the untouched read-only rendering).
 *
 * Actions by lifecycle state:
 *  - submitted  -> "Open QC" (Program Office / Admin). The gate before the
 *                  fan-out: triage asks every required domain at once, so
 *                  this is the last point at which an incomplete intake
 *                  costs nobody else time.
 *  - in_qc      -> "Run triage" (any authenticated persona; the server
 *                  records the system actor) or "Return to requester"
 *                  (Program Office / Admin, reason required). Triage's
 *                  result is rendered inline: tier, branch (fast-lane vs
 *                  review), required domains.
 *  - in_review  -> "Record decision" (approver role) — approve /
 *                  conditionally approve (≥1 condition) / reject.
 *
 * Draft-run + sign/return live in the Reviews tab (reviews-tab.tsx).
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { LifecycleState } from "@/lib/domain/types";
import {
  apiErrorToMessage,
  decide,
  isApiError,
  runTriage,
  type DecideInput,
  type TriageResult,
  startQc,
  returnFromQc,
} from "@/lib/client/api";
import { rememberCycle } from "@/lib/client/live-registry";
import { useLiveInfo } from "@/lib/client/use-live-info";
import { useLiveSessionOptional } from "@/lib/client/session-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DisableWithTooltip, GatedActionButton } from "./role-gate";
import { ReasonDialog } from "./reason-dialog";
import { TierBadge } from "./tier-badge";
import { DOMAIN_LABEL } from "./domain-labels";

export function LiveActionsBar({ slug, state }: { slug: string; state: LifecycleState }) {
  const router = useRouter();
  const live = useLiveSessionOptional();
  const session = live?.session ?? null;
  const liveInfo = useLiveInfo(slug);

  const [triaging, setTriaging] = React.useState(false);
  const [triageResult, setTriageResult] = React.useState<TriageResult | null>(null);
  const [decideOpen, setDecideOpen] = React.useState(false);
  const [qcPending, setQcPending] = React.useState(false);
  const [returnOpen, setReturnOpen] = React.useState(false);
  const [returnPending, setReturnPending] = React.useState(false);
  const [returnError, setReturnError] = React.useState<string | null>(null);

  if (!session || !liveInfo?.initiativeId) {
    return null;
  }
  const initiativeId = liveInfo.initiativeId;

  async function handleTriage() {
    if (!session) return;
    setTriaging(true);
    try {
      const result = await runTriage(session.token, initiativeId);
      rememberCycle(slug, result.cycleId);
      setTriageResult(result);
      toast.success(
        `Triage complete — tier ${result.tier}, ${result.requiredDomains.length} required domain(s), ${
          result.branch === "fast-lane" ? "fast-lane approved" : "review cycle opened"
        }.`,
      );
      router.refresh();
    } catch (err) {
      toast.error(isApiError(err) ? apiErrorToMessage(err) : "Triage failed.");
      if (isApiError(err) && err.status === 401) live?.logout();
    } finally {
      setTriaging(false);
    }
  }

  async function handleStartQc() {
    if (!session) return;
    setQcPending(true);
    try {
      const result = await startQc(session.token, initiativeId);
      toast.success(
        `QC opened — intake is ${result.completenessPct}% complete. Pass it to open the domain reviews, or return it to the requester.`,
      );
      router.refresh();
    } catch (err) {
      toast.error(isApiError(err) ? apiErrorToMessage(err) : "Could not open QC.");
      if (isApiError(err) && err.status === 401) live?.logout();
    } finally {
      setQcPending(false);
    }
  }

  // The reason is required by the service and lands on the append-only audit
  // trail — it is the only thing telling the requester what to fix. Collected
  // in the shared ReasonDialog (same control the admin pause/resume and
  // review-return actions use), whose confirm button stays disabled until
  // something has been typed, so an empty reason never reaches the 400.
  async function handleReturnFromQc(reason: string) {
    if (!session) return;
    setReturnError(null);
    setReturnPending(true);
    try {
      await returnFromQc(session.token, initiativeId, reason);
      setReturnOpen(false);
      toast.success("Returned to the requester with your reason on the audit trail.");
      router.refresh();
    } catch (err) {
      setReturnError(
        isApiError(err) ? apiErrorToMessage(err) : "Could not return the intake.",
      );
      if (isApiError(err) && err.status === 401) live?.logout();
    } finally {
      setReturnPending(false);
    }
  }

  // QC is the gate before the fan-out. `submitted` can only go into QC;
  // `in_qc` can pass (triage) or go back to the requester.
  const showStartQc = state === "submitted";
  const showTriage = state === "in_qc" && !triageResult;
  const showDecide = state === "in_review";

  if (!showStartQc && !showTriage && !triageResult && !showDecide) {
    return null;
  }

  return (
    <Card size="sm" data-slot="live-actions-bar">
      <CardHeader>
        <CardTitle className="text-sm">Live demo actions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {showStartQc ? (
          <div className="flex items-center gap-3">
            <DisableWithTooltip
              label="Open QC"
              requiresRole="program"
              onAction={() => void handleStartQc()}
              pending={qcPending}
              pendingLabel="Opening QC…"
              data-slot="start-qc"
            />
            <span className="text-xs text-muted-foreground">
              Quality check before any domain is asked. Triage opens every
              required review at once, so this is the last point at which an
              incomplete intake costs nobody else time.
            </span>
          </div>
        ) : null}

        {showTriage ? (
          <div className="flex items-center gap-3">
            <DisableWithTooltip
              label="Run triage"
              onAction={() => void handleTriage()}
              pending={triaging}
              pendingLabel="Running triage…"
              data-slot="run-triage"
            />
            <DisableWithTooltip
              label="Return to requester"
              requiresRole="program"
              onAction={() => setReturnOpen(true)}
              pending={returnPending}
              pendingLabel="Returning…"
              data-slot="qc-return"
            />
            <span className="text-xs text-muted-foreground">
              Passing QC runs deterministic tier + required-domain routing and
              opens all of them at once. Returning sends it back with a reason.
            </span>
          </div>
        ) : null}

        {triageResult ? (
          <div className="space-y-2" data-slot="triage-result">
            <div className="flex flex-wrap items-center gap-2">
              <TierBadge tier={triageResult.tier} />
              <Badge variant={triageResult.branch === "fast-lane" ? "secondary" : "outline"}>
                {triageResult.branch === "fast-lane" ? "Fast-lane" : "Review"}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {triageResult.requiredDomains.length} required domains
              </span>
              {triageResult.branch === "fast-lane" ? (
                <span className="text-xs text-muted-foreground">
                  Policy {triageResult.policyId} — accountable approver{" "}
                  {triageResult.accountableApprover}
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {triageResult.requiredDomains.map((domain) => (
                <Badge key={domain} variant="outline">
                  {DOMAIN_LABEL[domain]}
                </Badge>
              ))}
            </div>
            {triageResult.branch === "review" ? (
              <p className="text-xs text-muted-foreground">
                Review cycle opened — head to the Reviews tab to start the
                draft run.
              </p>
            ) : null}
          </div>
        ) : null}

        {showDecide ? (
          <div className="flex items-center gap-3">
            <GatedActionButton
              label="Record decision"
              requiresRole="approver"
              onAction={() => setDecideOpen(true)}
              data-slot="record-decision"
            />
            <span className="text-xs text-muted-foreground">
              Approver-only: approve, conditionally approve (with conditions),
              or reject.
            </span>
          </div>
        ) : null}
      </CardContent>

      <ReasonDialog
        open={returnOpen}
        onOpenChange={(open) => {
          setReturnOpen(open);
          if (!open) setReturnError(null);
        }}
        title="Return to requester"
        description="The intake goes back to its requester for editing and resubmission. Your reason is what they will act on, and it is written to the audit trail."
        confirmLabel="Return to requester"
        pendingLabel="Returning…"
        destructive
        pending={returnPending}
        error={returnError}
        onConfirm={(reason) => void handleReturnFromQc(reason)}
      />

      <Dialog open={decideOpen} onOpenChange={setDecideOpen}>
        <DialogContent data-slot="decide-dialog" className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Record decision</DialogTitle>
            <DialogDescription>
              The accountable approver records the final decision; it closes
              the review cycle and is written to the audit trail.
            </DialogDescription>
          </DialogHeader>
          {decideOpen ? (
            <DecideForm
              initiativeId={initiativeId}
              onCancel={() => setDecideOpen(false)}
              onDecided={() => {
                setDecideOpen(false);
                router.refresh();
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/* -------------------------------------------------------------------------
 * Decide form (approver) — mounted only while the dialog is open, so its
 * state resets naturally on close.
 * ---------------------------------------------------------------------- */

interface ConditionDraft {
  text: string;
  controlId: string;
}

const fieldClass =
  "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function DecideForm({
  initiativeId,
  onCancel,
  onDecided,
}: {
  initiativeId: string;
  onCancel: () => void;
  onDecided: () => void;
}) {
  const live = useLiveSessionOptional();
  const session = live?.session ?? null;

  const [decision, setDecision] = React.useState<DecideInput["decision"]>("approved");
  const [conditions, setConditions] = React.useState<ConditionDraft[]>([]);
  const [citationsText, setCitationsText] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  async function handleConfirm() {
    if (!session) return;
    const cleanConditions = conditions
      .map((c) => ({ text: c.text.trim(), controlId: c.controlId.trim() }))
      .filter((c) => c.text.length > 0 || c.controlId.length > 0);
    if (decision === "conditionally_approved" && cleanConditions.length === 0) {
      setError("Conditional approval requires at least one condition.");
      return;
    }
    if (cleanConditions.some((c) => c.text.length === 0 || c.controlId.length === 0)) {
      setError("Each condition needs both text and a control id (e.g. C-01).");
      return;
    }
    const citations = citationsText
      .split(",")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

    setError(null);
    setPending(true);
    try {
      const result = await decide(session.token, initiativeId, {
        decision,
        conditions: cleanConditions.length > 0 ? cleanConditions : undefined,
        citations: citations.length > 0 ? citations : undefined,
      });
      toast.success(`Decision recorded: ${result.type} — initiative is now ${result.after}.`);
      onDecided();
    } catch (err) {
      setError(isApiError(err) ? apiErrorToMessage(err) : "Decision failed.");
      if (isApiError(err) && err.status === 401) live?.logout();
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Decision</span>
        <select
          value={decision}
          onChange={(e) => setDecision(e.target.value as DecideInput["decision"])}
          data-slot="decide-select"
          className={fieldClass}
        >
          <option value="approved">Approved</option>
          <option value="conditionally_approved">Conditionally approved</option>
          <option value="rejected">Rejected</option>
        </select>
      </label>

      <div className="flex flex-col gap-2 text-sm">
        <span className="font-medium">
          Conditions{decision === "conditionally_approved" ? " (at least one required)" : ""}
        </span>
        {conditions.map((condition, index) => (
          <div key={index} className="flex gap-2">
            <input
              type="text"
              placeholder="Condition text"
              value={condition.text}
              data-slot="condition-text"
              onChange={(e) =>
                setConditions((prev) =>
                  prev.map((c, i) => (i === index ? { ...c, text: e.target.value } : c)),
                )
              }
              className={`${fieldClass} flex-1`}
            />
            <input
              type="text"
              placeholder="Control id"
              value={condition.controlId}
              data-slot="condition-control-id"
              onChange={(e) =>
                setConditions((prev) =>
                  prev.map((c, i) => (i === index ? { ...c, controlId: e.target.value } : c)),
                )
              }
              className={`${fieldClass} w-28`}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setConditions((prev) => prev.filter((_, i) => i !== index))}
            >
              Remove
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          data-slot="add-condition"
          onClick={() => setConditions((prev) => [...prev, { text: "", controlId: "" }])}
        >
          Add condition
        </Button>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Policy citations (optional, comma-separated)</span>
        <input
          type="text"
          value={citationsText}
          onChange={(e) => setCitationsText(e.target.value)}
          placeholder="e.g. MP-H-2.1, MP-R-5.1(a)"
          data-slot="decide-citations"
          className={fieldClass}
        />
      </label>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={pending}
          onClick={() => void handleConfirm()}
          data-slot="decide-confirm"
        >
          {pending ? "Recording…" : "Record decision"}
        </Button>
      </DialogFooter>
    </>
  );
}
