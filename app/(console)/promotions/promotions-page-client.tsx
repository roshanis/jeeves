"use client";

/**
 * /promotions client component — RL-checkpoint promotion queue (plan.md M3;
 * ui-spec's "no route is role-scoped" principle: the page itself is public,
 * only the Promote/Rollback actions gate on role) PLUS the M3 promotion-view
 * extensions: per-initiative deployment-version history, an honest eval
 * comparison, and a rollback action.
 *
 * Split from the original single-file page (see app/promotions/page.tsx):
 * this component keeps the original client-fetch approach for the
 * promotion QUEUE (`GET /api/deployments/promotions` via a `useEffect`) and
 * additionally accepts server-fetched `historyByInitiativeId` as a prop
 * (deployment history + eval series, computed once per page load in the
 * server-component wrapper).
 *
 * Rollback gating (approver OR admin) cannot use the shared
 * `DisableWithTooltip`'s `requiresRole` prop as-is (it only accepts a single
 * role) without editing components/jeeves/role-gate.tsx, which is out of
 * scope for this task — so this component checks the live session's role
 * itself (mirroring DisableWithTooltip's own internal logic) and renders a
 * plain disabled button + tooltip when the session is absent or the role
 * doesn't satisfy the OR-condition.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  listPromotions,
  promoteCheckpoint,
  rollbackDeployment,
  isApiError,
  apiErrorToMessage,
  type PromotionListItem,
} from "@/lib/client/api";
import { useLiveSession, useLiveSessionOptional } from "@/lib/client/session-context";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TierBadge } from "@/components/jeeves/tier-badge";
import { SyntheticDataLabel } from "@/components/jeeves/synthetic-data-label";
import { DisableWithTooltip, DEMO_PASSCODE_TOOLTIP } from "@/components/jeeves/role-gate";
import {
  PromotionDialog,
  type PromotionAttestationInput,
} from "@/components/jeeves/promotion-dialog";
import { DeploymentHistory } from "@/components/jeeves/deployment-history";
import { EvalComparison } from "@/components/jeeves/eval-comparison";
import { RollbackDialog } from "@/components/jeeves/rollback-dialog";
import type { Tier } from "@/lib/domain/types";
import type { InitiativeHistoryContext } from "./page";

function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Rollback's own gated button: enabled for a live session whose role is
 * "approver" OR "admin" AND the initiative has at least one prior
 * (retired/paused) version to roll back to. Mirrors
 * DisableWithTooltip/GatedActionButton's rendering shape without depending
 * on its single-role `requiresRole` prop.
 */
function RollbackButton({
  disabledReason,
  onAction,
}: {
  disabledReason: string | null;
  onAction: () => void;
}) {
  const live = useLiveSessionOptional();
  const session = live?.session ?? null;
  const roleOk = session?.role === "approver" || session?.role === "admin";
  const enabled = Boolean(session && roleOk && !disabledReason);

  if (enabled) {
    return (
      <Button
        type="button"
        variant="destructive"
        onClick={onAction}
        data-slot="rollback-button"
        data-live-action="true"
      >
        Roll back
      </Button>
    );
  }

  const tooltip = !session
    ? DEMO_PASSCODE_TOOLTIP
    : !roleOk
      ? "Requires the approver or admin role — switch persona via the demo mode chip"
      : (disabledReason ?? DEMO_PASSCODE_TOOLTIP);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="inline-flex" tabIndex={0}>
            <Button
              type="button"
              disabled
              variant="destructive"
              className="pointer-events-none"
              data-slot="rollback-button"
            >
              Roll back
            </Button>
          </span>
        }
      />
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

export function PromotionsPageClient({
  historyByInitiativeId,
}: {
  historyByInitiativeId: Record<string, InitiativeHistoryContext>;
}) {
  const { session } = useLiveSession();
  const router = useRouter();

  const [items, setItems] = React.useState<PromotionListItem[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [dialogTarget, setDialogTarget] = React.useState<PromotionListItem | null>(null);
  const [pending, setPending] = React.useState(false);
  const [dialogError, setDialogError] = React.useState<string | null>(null);

  const [rollbackTarget, setRollbackTarget] = React.useState<PromotionListItem | null>(null);
  const [rollbackPending, setRollbackPending] = React.useState(false);
  const [rollbackError, setRollbackError] = React.useState<string | null>(null);

  const load = React.useCallback(async (): Promise<void> => {
    try {
      const result = await listPromotions();
      setItems(result);
      setLoadError(null);
    } catch (err) {
      setLoadError(
        isApiError(err) ? apiErrorToMessage(err) : "Something went wrong loading promotions.",
      );
    }
  }, []);

  // Fetch-on-mount: see the original file's comment on why the async loader
  // is invoked from inside the effect body with a `cancelled` guard (the
  // `react-hooks/set-state-in-effect` rule).
  React.useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const result = await listPromotions();
        if (cancelled) return;
        setItems(result);
        setLoadError(null);
      } catch (err) {
        if (cancelled) return;
        setLoadError(
          isApiError(err) ? apiErrorToMessage(err) : "Something went wrong loading promotions.",
        );
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleConfirm(input: PromotionAttestationInput) {
    if (!session || !dialogTarget) return;
    setPending(true);
    setDialogError(null);
    try {
      await promoteCheckpoint(session.token, dialogTarget.deploymentVersionId, {
        attestation: {
          feedbackDataSource: input.feedbackDataSource,
          consentBasis: input.consentBasis,
          reviewedBy: input.reviewedBy,
        },
        reason: input.reason,
      });
      toast.success(`Promoted ${dialogTarget.initiativeTitle} to ${dialogTarget.version}.`);
      setDialogTarget(null);
      await load();
      router.refresh();
    } catch (err) {
      const message = isApiError(err) ? apiErrorToMessage(err) : "Something went wrong — please try again.";
      setDialogError(message);
      toast.error(message);
    } finally {
      setPending(false);
    }
  }

  async function handleRollbackConfirm(input: { targetDeploymentVersionId: string; reason: string }) {
    if (!session || !rollbackTarget) return;
    setRollbackPending(true);
    setRollbackError(null);
    try {
      const result = await rollbackDeployment(
        session.token,
        rollbackTarget.initiativeId,
        input.targetDeploymentVersionId,
        input.reason,
      );
      toast.success(
        `Rolled back ${rollbackTarget.initiativeTitle}: ${result.fromVersion} → ${result.toVersion}.`,
      );
      setRollbackTarget(null);
      await load();
      router.refresh();
    } catch (err) {
      const message = isApiError(err) ? apiErrorToMessage(err) : "Something went wrong — please try again.";
      setRollbackError(message);
      toast.error(message);
    } finally {
      setRollbackPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-6" data-slot="promotions-page">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">RL checkpoint promotions</h1>
        <p className="text-sm text-muted-foreground">
          Checkpoints awaiting feedback-provenance sign-off before promotion
          to live deployment. Promotion requires an approver to attest to the
          feedback data source and consent basis.
        </p>
      </div>

      <SyntheticDataLabel>
        <Card>
          <CardContent>
            {loadError ? (
              <p className="text-sm text-destructive" role="alert">
                {loadError}
              </p>
            ) : items === null ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : items.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No checkpoints are currently awaiting promotion sign-off.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Initiative</TableHead>
                    <TableHead>Tier</TableHead>
                    <TableHead>Version</TableHead>
                    <TableHead>Supersedes</TableHead>
                    <TableHead>Model version</TableHead>
                    <TableHead>Deployed at</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.deploymentVersionId} data-slot="promotion-row">
                      <TableCell className="whitespace-normal font-medium">
                        <Link
                          href={`/initiatives/${item.initiativeSlug}`}
                          className="text-primary underline-offset-4 hover:underline"
                        >
                          {item.initiativeTitle}
                        </Link>
                        <div className="font-mono text-xs text-muted-foreground">
                          {item.initiativeSlug}
                        </div>
                      </TableCell>
                      <TableCell>
                        {item.tier ? <TierBadge tier={item.tier as Tier} /> : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{item.version}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {item.supersedesVersion ?? "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {item.modelVersion ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(item.deployedAt)}
                      </TableCell>
                      <TableCell>
                        <DisableWithTooltip
                          label="Promote"
                          requiresRole="approver"
                          data-slot="promote-button"
                          onAction={() => {
                            setDialogError(null);
                            setDialogTarget(item);
                          }}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </SyntheticDataLabel>

      {items && items.length > 0 ? (
        <div className="flex flex-col gap-4" data-slot="promotion-detail-panels">
          {items.map((item) => {
            const ctx = historyByInitiativeId[item.initiativeId];
            const history = ctx?.history ?? [];
            const priorTargets = history
              .filter((h) => h.status === "retired" || h.status === "paused")
              .map((h) => ({ deploymentVersionId: h.id, version: h.version }));
            const currentEntry = history.find((h) => h.isCurrent) ?? null;

            return (
              <div key={item.deploymentVersionId} className="flex flex-col gap-3">
                <DeploymentHistory title={item.initiativeTitle} entries={history} />
                <EvalComparison
                  candidateVersion={item.version}
                  currentVersion={item.supersedesVersion}
                  evalSeries={ctx?.evalSeries ?? null}
                />
                {currentEntry ? (
                  <div className="flex items-center justify-end gap-2" data-slot="rollback-action">
                    <RollbackButton
                      disabledReason={
                        priorTargets.length === 0
                          ? "No prior (retired/paused) version to roll back to"
                          : null
                      }
                      onAction={() => {
                        setRollbackError(null);
                        setRollbackTarget(item);
                      }}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      <PromotionDialog
        open={dialogTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDialogTarget(null);
            setDialogError(null);
          }
        }}
        initiativeTitle={dialogTarget?.initiativeTitle ?? ""}
        version={dialogTarget?.version ?? ""}
        pending={pending}
        error={dialogError}
        onConfirm={(input) => void handleConfirm(input)}
      />

      <RollbackDialog
        open={rollbackTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRollbackTarget(null);
            setRollbackError(null);
          }
        }}
        initiativeTitle={rollbackTarget?.initiativeTitle ?? ""}
        currentVersion={
          (rollbackTarget && historyByInitiativeId[rollbackTarget.initiativeId]?.history.find((h) => h.isCurrent)?.version) ??
          rollbackTarget?.supersedesVersion ??
          ""
        }
        targets={
          rollbackTarget
            ? (historyByInitiativeId[rollbackTarget.initiativeId]?.history ?? [])
                .filter((h) => h.status === "retired" || h.status === "paused")
                .map((h) => ({ deploymentVersionId: h.id, version: h.version }))
            : []
        }
        pending={rollbackPending}
        error={rollbackError}
        onConfirm={(input) => void handleRollbackConfirm(input)}
      />
    </div>
  );
}
