"use client";

/**
 * Mandatory-reason dialog for returning a domain review (ui-spec §3.3/§5;
 * the shared "ReasonDialog" pattern from §9 — reason is required, the
 * server rejects an empty one with 400 and this dialog never submits one).
 *
 * The form body is a child component rendered only while the dialog is
 * open, so its reason/error state resets naturally on close (no
 * setState-in-effect reset dance).
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

function ReturnReasonForm({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  function handleConfirm() {
    const trimmed = reason.trim();
    if (trimmed.length === 0) {
      setError("A reason is required to return a review.");
      return;
    }
    onConfirm(trimmed);
  }

  return (
    <>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Reason (required)</span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={2000}
          data-slot="return-reason-input"
          className="min-h-24 rounded-lg border border-input bg-transparent p-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
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
          variant="destructive"
          disabled={pending}
          onClick={handleConfirm}
          data-slot="return-confirm"
        >
          {pending ? "Returning…" : "Return review"}
        </Button>
      </DialogFooter>
    </>
  );
}

export function ReturnReviewDialog({
  open,
  onOpenChange,
  domainLabel,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  domainLabel: string;
  pending: boolean;
  onConfirm: (reason: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-slot="return-review-dialog">
        <DialogHeader>
          <DialogTitle>Return {domainLabel} review</DialogTitle>
          <DialogDescription>
            Returning sends this domain review back with a mandatory reason;
            the action is recorded in the audit trail.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <ReturnReasonForm
            pending={pending}
            onCancel={() => onOpenChange(false)}
            onConfirm={onConfirm}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
