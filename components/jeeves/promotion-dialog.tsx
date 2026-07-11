"use client";

/**
 * RL-checkpoint promotion confirmation dialog (ui-spec / plan.md M3;
 * POST /api/deployments/promotions/[id]/promote). Modeled closely on
 * reason-dialog.tsx's structure: a form sub-component mounted only while
 * `open` (so its field state resets naturally on close), confirm disabled
 * until ALL FOUR mandatory fields (feedbackDataSource, consentBasis,
 * reviewedBy, reason) are non-empty after `.trim()`.
 *
 * Unlike ReasonDialog's single optional `error` prop surfaced only via toast
 * at the call site, this dialog also renders the error INLINE (same
 * `role="alert"` treatment) so tests can assert on it directly, per the task
 * brief.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface PromotionAttestationInput {
  feedbackDataSource: string;
  consentBasis: string;
  reviewedBy: string;
  reason: string;
}

function PromotionForm({
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (input: PromotionAttestationInput) => void;
}) {
  const [feedbackDataSource, setFeedbackDataSource] = React.useState("");
  const [consentBasis, setConsentBasis] = React.useState("");
  const [reviewedBy, setReviewedBy] = React.useState("");
  const [reason, setReason] = React.useState("");

  const trimmed = {
    feedbackDataSource: feedbackDataSource.trim(),
    consentBasis: consentBasis.trim(),
    reviewedBy: reviewedBy.trim(),
    reason: reason.trim(),
  };
  const allFilled =
    trimmed.feedbackDataSource.length > 0 &&
    trimmed.consentBasis.length > 0 &&
    trimmed.reviewedBy.length > 0 &&
    trimmed.reason.length > 0;

  const textareaClass =
    "min-h-16 rounded-lg border border-input bg-transparent p-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
  const inputClass =
    "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

  return (
    <>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Feedback data source (required)</span>
          <textarea
            value={feedbackDataSource}
            onChange={(e) => setFeedbackDataSource(e.target.value)}
            maxLength={2000}
            data-slot="promotion-feedback-data-source-input"
            className={textareaClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Consent basis (required)</span>
          <textarea
            value={consentBasis}
            onChange={(e) => setConsentBasis(e.target.value)}
            maxLength={2000}
            data-slot="promotion-consent-basis-input"
            className={textareaClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Reviewed by (required)</span>
          <input
            type="text"
            value={reviewedBy}
            onChange={(e) => setReviewedBy(e.target.value)}
            maxLength={200}
            data-slot="promotion-reviewed-by-input"
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Reason (required)</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={2000}
            data-slot="promotion-reason-input"
            className={textareaClass}
          />
        </label>
      </div>
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
          disabled={pending || !allFilled}
          onClick={() => onConfirm(trimmed)}
          data-slot="promotion-confirm"
        >
          {pending ? "Promoting…" : "Promote"}
        </Button>
      </DialogFooter>
    </>
  );
}

export function PromotionDialog({
  open,
  onOpenChange,
  initiativeTitle,
  version,
  pending,
  error = null,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initiativeTitle: string;
  version: string;
  pending: boolean;
  error?: string | null;
  onConfirm: (input: PromotionAttestationInput) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-slot="promotion-dialog">
        <DialogHeader>
          <DialogTitle>Promote checkpoint {version}</DialogTitle>
          <DialogDescription>
            Promoting {initiativeTitle} to version {version} requires
            attesting to the feedback-data provenance and consent basis — this
            is recorded in the audit log.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <PromotionForm
            pending={pending}
            error={error}
            onCancel={() => onOpenChange(false)}
            onConfirm={onConfirm}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
