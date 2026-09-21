"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { DeploymentRow } from "@/lib/data/dto";
import { latestDeployment } from "@/lib/deployments/selection";
import { apiErrorToMessage, isApiError, rollbackDeployment } from "@/lib/client/api";
import { useLiveSessionOptional, type LiveSession } from "@/lib/client/session-context";
import { Button } from "@/components/ui/button";
import { DeploymentsTab } from "./deployments-tab";
import { DEMO_SESSION_TOOLTIP } from "./role-gate";
import { RollbackDialog, type RollbackTargetOption } from "./rollback-dialog";

/** Recovery belongs to the initiative, independently of its promotion queue. */
export function DeploymentRecovery({
  initiativeId,
  initiativeTitle,
  deployments,
  isSeeded = false,
}: {
  initiativeId?: string;
  initiativeTitle: string;
  deployments: DeploymentRow[];
  isSeeded?: boolean;
}) {
  const live = useLiveSessionOptional();
  const session = live?.session ?? null;
  // Rollback restores a prior version from a deployed version; a paused-only
  // initiative must resume before it meets the existing service's contract.
  const current = latestDeployment(
    deployments.filter((row) => row.status === "deployed").map((row) => ({
      ...row, id: row.id ?? "", deployedAt: new Date(row.at),
    })),
  );
  const targets = deployments
    .filter((row) => row.id && row.id !== current?.id && (row.status === "retired" || row.status === "paused"))
    .map((row) => ({ deploymentVersionId: row.id!, version: row.version }));

  return (
    <div className="flex flex-col gap-4" data-slot="deployment-recovery">
      <DeploymentsTab deployments={deployments} />
      <RollbackControls
        key={JSON.stringify([session?.token, session?.role, session?.workspaceId, initiativeId, isSeeded, deployments])}
        initiativeId={initiativeId}
        initiativeTitle={initiativeTitle}
        isSeeded={isSeeded}
        current={current}
        targets={targets}
        session={session}
        onExpired={() => live?.logout()}
      />
    </div>
  );
}

function RollbackControls({
  initiativeId, initiativeTitle, isSeeded, current, targets, session, onExpired,
}: {
  initiativeId?: string;
  initiativeTitle: string;
  isSeeded: boolean;
  current: DeploymentRow | null;
  targets: RollbackTargetOption[];
  session: LiveSession | null;
  onExpired: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const mounted = React.useRef(true);
  const reasonId = React.useId();
  React.useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const roleOk = session?.role === "approver" || session?.role === "admin";
  const disabledReason = !session?.workspaceId ? DEMO_SESSION_TOOLTIP
    : isSeeded ? "This shared example is read-only. Create your own initiative to try rollback."
    : !roleOk ? "Requires the approver or admin role — choose a persona in the header"
    : !initiativeId || !current?.id ? "No identified deployed version is available to roll back."
    : targets.length === 0 ? "No prior (retired/paused) version to roll back to"
    : null;

  async function confirm(input: { targetDeploymentVersionId: string; reason: string }) {
    const reason = input.reason.trim();
    if (disabledReason || pending || !session || !initiativeId || !reason ||
      !targets.some((target) => target.deploymentVersionId === input.targetDeploymentVersionId)) return;
    setPending(true);
    setError(null);
    try {
      const result = await rollbackDeployment(session.token, initiativeId, input.targetDeploymentVersionId, reason);
      if (!mounted.current) return;
      toast.success(`Rolled back ${initiativeTitle}: ${result.fromVersion} → ${result.toVersion}.`);
      setOpen(false);
      router.refresh();
    } catch (err) {
      if (!mounted.current) return;
      const message = isApiError(err) ? apiErrorToMessage(err) : "Something went wrong — please try again.";
      setError(message);
      toast.error(message);
      if (isApiError(err) && err.status === 401) onExpired();
    } finally {
      if (mounted.current) setPending(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-end gap-3" data-slot="rollback-action">
        {disabledReason ? <p id={reasonId} className="text-xs text-muted-foreground">{disabledReason}</p> : null}
        <Button
          type="button"
          variant="destructive"
          disabled={Boolean(disabledReason) || pending}
          aria-describedby={disabledReason ? reasonId : undefined}
          data-slot="rollback-button"
          data-live-action={!disabledReason ? "true" : undefined}
          onClick={() => { setError(null); setOpen(true); }}
        >
          Roll back
        </Button>
      </div>
      <RollbackDialog
        open={open}
        onOpenChange={(next) => { if (!pending) { setOpen(next); setError(null); } }}
        initiativeTitle={initiativeTitle}
        currentVersion={current?.version ?? ""}
        targets={targets}
        pending={pending}
        error={error}
        onConfirm={(input) => void confirm(input)}
      />
    </>
  );
}
