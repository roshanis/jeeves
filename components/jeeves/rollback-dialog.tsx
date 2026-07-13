"use client";

/**
 * RollbackDialog — reason-gated confirmation for POST
 * /api/deployments/[id]/rollback (M3 promotion-view extension, deliverable
 * 3). Modeled on promotion-dialog.tsx's structure: a form sub-component
 * mounted only while `open` (so its field state resets naturally on close),
 * confirm disabled until a target version is selected AND the reason is
 * non-empty after `.trim()`.
 *
 * Unlike PromotionDialog's free-text attestation fields, the "target
 * version" here is a fixed choice from the initiative's own prior
 * (retired/paused) deployment-version rows — never free text — so an
 * operator cannot roll back to an id that isn't actually a sibling version.
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

export interface RollbackTargetOption {
  deploymentVersionId: string;
  version: string;
}

function RollbackForm({
  targets,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  targets: RollbackTargetOption[];
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (input: { targetDeploymentVersionId: string; reason: string }) => void;
}) {
  const [targetId, setTargetId] = React.useState(targets[0]?.deploymentVersionId ?? "");
  const [reason, setReason] = React.useState("");

  const trimmedReason = reason.trim();
  const canConfirm = targetId.length > 0 && trimmedReason.length > 0;

  const inputClass =
    "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
  const textareaClass =
    "min-h-20 rounded-lg border border-input bg-transparent p-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

  return (
    <>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Roll back to version (required)</span>
          <select
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            data-slot="rollback-target-select"
            className={inputClass}
          >
            {targets.length === 0 ? <option value="">No prior version available</option> : null}
            {targets.map((t) => (
              <option key={t.deploymentVersionId} value={t.deploymentVersionId}>
                {t.version}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Reason (required)</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={2000}
            data-slot="rollback-reason-input"
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
          variant="destructive"
          disabled={pending || !canConfirm}
          onClick={() => onConfirm({ targetDeploymentVersionId: targetId, reason: trimmedReason })}
          data-slot="rollback-confirm"
        >
          {pending ? "Rolling back…" : "Roll back"}
        </Button>
      </DialogFooter>
    </>
  );
}

export function RollbackDialog({
  open,
  onOpenChange,
  initiativeTitle,
  currentVersion,
  targets,
  pending,
  error = null,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initiativeTitle: string;
  currentVersion: string;
  targets: RollbackTargetOption[];
  pending: boolean;
  error?: string | null;
  onConfirm: (input: { targetDeploymentVersionId: string; reason: string }) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-slot="rollback-dialog">
        <DialogHeader>
          <DialogTitle>Roll back deployment — {initiativeTitle}</DialogTitle>
          <DialogDescription>
            Rolling back retires the current deployed version ({currentVersion}) and
            restores a prior version to live. This is recorded in the audit log.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <RollbackForm
            targets={targets}
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
