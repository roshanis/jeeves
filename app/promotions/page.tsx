"use client";

/**
 * /promotions — RL-checkpoint promotion queue (plan.md M3; ui-spec's
 * "no route is role-scoped" principle: the page itself is public, only the
 * Promote action gates on the approver role).
 *
 * Client-fetch approach (judgment call, documented in the task report):
 * GET /api/deployments/promotions is called from a `useEffect` in this
 * client component rather than fetched server-side in a server component
 * (contrast app/audit/page.tsx's server-fetch pattern). This keeps the whole
 * feature inside the lib/client/api.ts + components/jeeves/ + this page file
 * boundary without needing to touch app/_lib/data-provider.ts (which would
 * require a new provider method) — the simplest, safest option given the
 * ownership boundary for this task.
 */
import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  listPromotions,
  promoteCheckpoint,
  isApiError,
  apiErrorToMessage,
  type PromotionListItem,
} from "@/lib/client/api";
import { useLiveSession } from "@/lib/client/session-context";
import { Card, CardContent } from "@/components/ui/card";
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
import { DisableWithTooltip } from "@/components/jeeves/role-gate";
import {
  PromotionDialog,
  type PromotionAttestationInput,
} from "@/components/jeeves/promotion-dialog";
import type { Tier } from "@/lib/domain/types";

function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

export default function PromotionsPage() {
  const { session } = useLiveSession();

  const [items, setItems] = React.useState<PromotionListItem[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [dialogTarget, setDialogTarget] = React.useState<PromotionListItem | null>(null);
  const [pending, setPending] = React.useState(false);
  const [dialogError, setDialogError] = React.useState<string | null>(null);

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

  // Fetch-on-mount: the async loader is invoked from inside the effect body
  // (rather than the effect calling an externally-defined async function
  // directly) with a `cancelled` guard so a late-resolving response never
  // calls setState after unmount — this shape is what satisfies the
  // `react-hooks/set-state-in-effect` rule enabled by eslint-config-next.
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
    } catch (err) {
      const message = isApiError(err) ? apiErrorToMessage(err) : "Something went wrong — please try again.";
      setDialogError(message);
      toast.error(message);
    } finally {
      setPending(false);
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
    </div>
  );
}
