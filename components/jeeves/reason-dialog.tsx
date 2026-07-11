"use client";

/**
 * Generic mandatory-reason confirmation dialog (ui-spec §9's "ReasonDialog"
 * pattern; same shape as return-review-dialog.tsx). Used by the two admin
 * deployment actions (pause / resume) — the server rejects an empty reason
 * with 400, and this dialog never submits one: the confirm button is
 * DISABLED until the reason is non-empty (task contract: "submit disabled
 * when empty"), a slightly stricter stance than return-review-dialog's
 * validate-on-click.
 *
 * The form body is a child component rendered only while the dialog is
 * open, so its reason state resets naturally on close.
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

function ReasonForm({
  confirmLabel,
  pendingLabel,
  destructive,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  confirmLabel: string;
  pendingLabel: string;
  destructive: boolean;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = React.useState("");
  const trimmed = reason.trim();

  return (
    <>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Reason (required)</span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={2000}
          data-slot="admin-reason-input"
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
          variant={destructive ? "destructive" : "default"}
          disabled={pending || trimmed.length === 0}
          onClick={() => onConfirm(trimmed)}
          data-slot="admin-reason-confirm"
        >
          {pending ? pendingLabel : confirmLabel}
        </Button>
      </DialogFooter>
    </>
  );
}

export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pendingLabel,
  destructive = false,
  pending,
  error = null,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  pendingLabel: string;
  destructive?: boolean;
  pending: boolean;
  error?: string | null;
  onConfirm: (reason: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-slot="reason-dialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {open ? (
          <ReasonForm
            confirmLabel={confirmLabel}
            pendingLabel={pendingLabel}
            destructive={destructive}
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
