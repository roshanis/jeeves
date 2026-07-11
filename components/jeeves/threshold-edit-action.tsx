"use client";

/**
 * "Edit threshold" live action for the Admin console's Q-01 card (ui-spec §7
 * action 1; demo-script step 7). Thin submit wrapper around
 * ThresholdEditDialog: opens for a live ADMIN session (any other state keeps
 * the standard DisableWithTooltip rendering), posts via
 * lib/client/api#setThreshold with `controlId: "Q-01"`, toasts the
 * before → after result, and router.refresh()es so the server-rendered
 * threshold value + Control-change audit log pick the change up.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  apiErrorToMessage,
  isApiError,
  setThreshold,
  type SetThresholdInput,
} from "@/lib/client/api";
import { useLiveSessionOptional } from "@/lib/client/session-context";
import { DisableWithTooltip } from "./role-gate";
import {
  ThresholdEditDialog,
  type ThresholdInitiativeOption,
} from "./threshold-edit-dialog";

export function ThresholdEditAction({
  currentThreshold,
  initiativeOptions,
}: {
  currentThreshold: number | null;
  initiativeOptions: ThresholdInitiativeOption[];
}) {
  const router = useRouter();
  const live = useLiveSessionOptional();
  const session = live?.session ?? null;

  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleConfirm(input: Omit<SetThresholdInput, "controlId">) {
    if (!session) return;
    setPending(true);
    setError(null);
    try {
      const result = await setThreshold(session.token, { controlId: "Q-01", ...input });
      toast.success(
        result.scope === "tier-default"
          ? `Q-01 tier default (${result.tier}) changed: ${result.before ?? "unset"} → ${result.after}. Logged to the audit trail.`
          : `Q-01 project override changed: ${result.before ?? "tier default"} → ${result.after}. Logged to the audit trail.`,
      );
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(isApiError(err) ? apiErrorToMessage(err) : "Threshold change failed.");
      if (isApiError(err) && err.status === 401) live?.logout();
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <DisableWithTooltip
        label="Edit threshold"
        variant="outline"
        requiresRole="admin"
        onAction={() => {
          setError(null);
          setOpen(true);
        }}
        data-slot="edit-threshold"
      />
      <ThresholdEditDialog
        open={open}
        onOpenChange={setOpen}
        currentThreshold={currentThreshold}
        initiativeOptions={initiativeOptions}
        pending={pending}
        error={error}
        onConfirm={(input) => void handleConfirm(input)}
      />
    </>
  );
}
