"use client";

/**
 * Per-deployment Pause/Resume action for the Admin console table (ui-spec §7
 * action 2; demo-script step 6). Composes the shared ReasonDialog (mandatory
 * reason; submit disabled while empty) over the admin pause/resume routes:
 *   POST /api/admin/deployments/[initiativeId]/pause   { reason }
 *   POST /api/admin/deployments/[initiativeId]/resume  { reason }
 *
 * Gating matches the routes (admin-service requireAdminWithReason): the
 * button is live only for an ADMIN session (`requiresRole="admin"`); any
 * other state renders the standard DisableWithTooltip. When `initiativeId`
 * is null (mock data mode — the read-model DTOs expose no DB ids, see
 * threshold-edit-dialog.tsx's Gap-A note) no onAction is passed, so the
 * button stays disabled-with-tooltip even for a live admin.
 *
 * While the initiative is in `re_review` (open reassessment) the Resume
 * control is disabled with the reason in words: the server refuses it (409)
 * until the Approver approves the reassessment. The role requirement is
 * dropped then, so every signed-in non-public persona sees that reason, not
 * "Requires the admin role".
 *
 * Label follows the DEPLOYMENT status like the original read-only build:
 * "Resume" when paused, else "Pause". The server enforces actual transition
 * legality (400 on e.g. pausing a retired deployment) and the dialog
 * surfaces that message inline.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ApiError,
  apiErrorToMessage,
  isApiError,
  pauseDeployment,
  resumeDeployment,
} from "@/lib/client/api";
import { useLiveSessionOptional } from "@/lib/client/session-context";
import type { DeploymentRow } from "@/lib/data/dto";
import type { LifecycleState } from "@/lib/domain/types";
import { DisableWithTooltip } from "./role-gate";
import { ReasonDialog } from "./reason-dialog";

export const REASSESSMENT_RESUME_REASON =
  "Reassessment open: the Approver must approve the reassessment before this deployment can resume.";

export function DeploymentActionButton({
  title,
  initiativeId,
  status,
  lifecycleState,
}: {
  /** Initiative display title (used in the dialog heading + toast). */
  title: string;
  /** DB initiative id — null when unresolvable (mock data mode). */
  initiativeId: string | null;
  status: DeploymentRow["status"];
  /** Initiative lifecycle state; re_review disables Resume. */
  lifecycleState: LifecycleState;
}) {
  const router = useRouter();
  const live = useLiveSessionOptional();
  const session = live?.session ?? null;

  const action: "pause" | "resume" = status === "paused" ? "resume" : "pause";
  const reassessmentOpen = action === "resume" && lifecycleState === "re_review";

  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleConfirm(reason: string) {
    if (!initiativeId || reassessmentOpen) return;
    if (!session) {
      setError(apiErrorToMessage(new ApiError(401, "session expired")));
      return;
    }
    setPending(true);
    setError(null);
    try {
      const call = action === "resume" ? resumeDeployment : pauseDeployment;
      const result = await call(session.token, initiativeId, reason);
      toast.success(
        `${title} ${action}d — lifecycle ${result.before} → ${result.after}. Logged to the audit trail.`,
      );
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(isApiError(err) ? apiErrorToMessage(err) : `Deployment ${action} failed.`);
      if (isApiError(err) && err.status === 401) live?.logout();
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <DisableWithTooltip
        label={action === "resume" ? "Resume" : "Pause"}
        variant="outline"
        requiresRole={reassessmentOpen ? undefined : "admin"}
        onAction={
          initiativeId && !reassessmentOpen
            ? () => {
                setError(null);
                setOpen(true);
              }
            : undefined
        }
        disabledReason={reassessmentOpen ? REASSESSMENT_RESUME_REASON : undefined}
        data-slot={`deployment-${action}`}
      />
      <ReasonDialog
        open={open}
        onOpenChange={setOpen}
        title={action === "resume" ? `Resume deployment — ${title}` : `Pause deployment — ${title}`}
        description={
          action === "resume"
            ? "Resuming returns a paused deployment to service. After a monitor breach it is available only once the Approver has approved the reassessment. The reason is written to the audit trail."
            : "Pausing halts the deployment immediately. The reason is written to the audit trail."
        }
        confirmLabel={action === "resume" ? "Resume deployment" : "Pause deployment"}
        pendingLabel={action === "resume" ? "Resuming…" : "Pausing…"}
        destructive={action === "pause"}
        pending={pending}
        error={error}
        onConfirm={(reason) => void handleConfirm(reason)}
      />
    </>
  );
}
