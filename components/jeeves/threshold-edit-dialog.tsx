"use client";

/**
 * Q-01 threshold edit dialog (ui-spec §7 action 1; demo-script step 7).
 * Mandatory value + reason; a scope choice matching the API's two shapes
 * (app/api/admin/threshold/route.ts):
 *   - "tier-default"      -> { initiativeId: null, tier, value, reason }
 *   - "project-override"  -> { initiativeId: "<id>", value, reason }
 *
 * Confirm stays DISABLED until the form is submittable (non-empty reason,
 * finite value, and — for a project override — a selected initiative), per
 * the task contract "submit disabled when empty". The form body mounts only
 * while open, so state resets naturally on close.
 *
 * `initiativeOptions` lists only initiatives whose DB id is known to the
 * admin page (Gap-A workaround: the read-model DTOs expose no initiative
 * id, so the admin page resolves slug->id itself; in mock data mode the
 * list is empty and the override scope explains why it is unavailable).
 */
import * as React from "react";
import type { Tier } from "@/lib/domain/types";
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
}

const TIERS: Tier[] = ["low", "medium", "high", "critical"];

const fieldClass =
  "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function ThresholdForm({
  currentThreshold,
  initiativeOptions,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  currentThreshold: number | null;
  initiativeOptions: ThresholdInitiativeOption[];
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (input: Omit<SetThresholdInput, "controlId">) => void;
}) {
  const [scope, setScope] = React.useState<"tier-default" | "project-override">("tier-default");
  const [tier, setTier] = React.useState<Tier>("high");
  const [initiativeId, setInitiativeId] = React.useState<string>(
    initiativeOptions[0]?.initiativeId ?? "",
  );
  const [valueText, setValueText] = React.useState<string>(
    currentThreshold !== null ? String(currentThreshold) : "",
  );
  const [reason, setReason] = React.useState("");

  const value = Number.parseFloat(valueText);
  const valueValid = valueText.trim().length > 0 && Number.isFinite(value);
  const reasonValid = reason.trim().length > 0;
  const scopeValid = scope === "tier-default" || initiativeId.length > 0;
  const submittable = valueValid && reasonValid && scopeValid && !pending;

  function handleConfirm() {
    if (!submittable) return;
    onConfirm(
      scope === "tier-default"
        ? { initiativeId: null, tier, value, reason: reason.trim() }
        : { initiativeId, value, reason: reason.trim() },
    );
  }

  return (
    <>
      <fieldset className="flex flex-col gap-1.5 text-sm">
        <legend className="pb-1 font-medium">Scope</legend>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="threshold-scope"
            checked={scope === "tier-default"}
            onChange={() => setScope("tier-default")}
            data-slot="threshold-scope-tier"
          />
          Tier default — applies to every deployment of that tier without an override
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="threshold-scope"
            checked={scope === "project-override"}
            onChange={() => setScope("project-override")}
            data-slot="threshold-scope-override"
            disabled={initiativeOptions.length === 0}
          />
          Project override — applies to one initiative&apos;s current deployment only
        </label>
        {initiativeOptions.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Project overrides are unavailable: no initiative ids are resolvable
            in this data mode.
          </p>
        ) : null}
      </fieldset>

      {scope === "tier-default" ? (
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Tier</span>
          <select
            value={tier}
            onChange={(e) => setTier(e.target.value as Tier)}
            data-slot="threshold-tier"
            className={fieldClass}
          >
            {TIERS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Initiative</span>
          <select
            value={initiativeId}
            onChange={(e) => setInitiativeId(e.target.value)}
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
      )}

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">New threshold value (required)</span>
        <input
          type="number"
          step="0.01"
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
  currentThreshold,
  initiativeOptions,
  pending,
  error = null,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentThreshold: number | null;
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
            currentThreshold={currentThreshold}
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
