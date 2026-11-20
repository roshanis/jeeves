"use client";

/** Workspace-only threshold editor. Global defaults are maintained outside the public demo. */
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
import type { SetThresholdInput } from "@/lib/client/api";

export interface ThresholdInitiativeOption {
  initiativeId: string;
  title: string;
  slug: string;
  /** The initiative's current Q-01 threshold: its override, else its tier default. */
  currentThreshold?: number | null;
}

const fieldClass =
  "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function ThresholdForm({
  initiativeOptions,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  initiativeOptions: ThresholdInitiativeOption[];
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (input: Omit<SetThresholdInput, "controlId">) => void;
}) {
  const [initiativeId, setInitiativeId] = React.useState<string>(
    initiativeOptions[0]?.initiativeId ?? "",
  );
  const currentFor = (id: string): number | null =>
    initiativeOptions.find((option) => option.initiativeId === id)?.currentThreshold ?? null;
  const [valueText, setValueText] = React.useState<string>(() => {
    const initial = currentFor(initiativeId);
    return initial !== null ? String(initial) : "";
  });
  const [reason, setReason] = React.useState("");

  const value = Number.parseFloat(valueText);
  // Q-01 thresholds are hallucination rates, so only [0, 1] is meaningful.
  const valueValid = valueText.trim().length > 0 && Number.isFinite(value) && value >= 0 && value <= 1;
  const shownCurrent = currentFor(initiativeId);
  const reasonValid = reason.trim().length > 0;
  const scopeValid = initiativeOptions.some((option) => option.initiativeId === initiativeId);
  const submittable = valueValid && reasonValid && scopeValid && !pending;

  function handleConfirm() {
    if (!submittable) return;
    onConfirm({ initiativeId, value, reason: reason.trim() });
  }

  return (
    <>
      <p className="text-sm text-muted-foreground">
        Shared defaults are read-only. This change applies only to an initiative in your workspace.
      </p>
      {initiativeOptions.length === 0 ? <p className="text-sm">Create and deploy an initiative to try a threshold override.</p> : null}
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Initiative</span>
        <select
          value={initiativeId}
          onChange={(e) => {
            setInitiativeId(e.target.value);
            const next = currentFor(e.target.value);
            setValueText(next !== null ? String(next) : "");
          }}
          data-slot="threshold-initiative"
          className={fieldClass}
        >
          {initiativeOptions.map((option) => (
            <option key={option.initiativeId} value={option.initiativeId}>
              {option.title} ({option.slug})
            </option>
          ))}
        </select>
      </label>
      {shownCurrent !== null ? (
        <p className="text-sm text-muted-foreground" data-slot="threshold-current">
          Current threshold: {shownCurrent}
        </p>
      ) : null}

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">New threshold value (required)</span>
        <input
          type="number"
          step="0.01"
          min={0}
          max={1}
          value={valueText}
          onChange={(e) => setValueText(e.target.value)}
          data-slot="threshold-value"
          className={fieldClass}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Reason (required)</span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={2000}
          data-slot="threshold-reason"
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
          disabled={!submittable}
          onClick={handleConfirm}
          data-slot="threshold-confirm"
        >
          {pending ? "Saving…" : "Save threshold"}
        </Button>
      </DialogFooter>
    </>
  );
}

export function ThresholdEditDialog({
  open,
  onOpenChange,
  initiativeOptions,
  pending,
  error = null,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initiativeOptions: ThresholdInitiativeOption[];
  pending: boolean;
  error?: string | null;
  onConfirm: (input: Omit<SetThresholdInput, "controlId">) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-slot="threshold-edit-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Q-01 threshold</DialogTitle>
          <DialogDescription>
            Changing an eval-quality threshold is one of the two live admin
            actions. It requires a reason and is written to the audit trail;
            the next monitor run enforces the new value.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <ThresholdForm
            initiativeOptions={initiativeOptions}
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
