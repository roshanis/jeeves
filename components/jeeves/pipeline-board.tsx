import Link from "next/link";
import type { InitiativeSummary } from "@/lib/data/dto";
import type { LifecycleState } from "@/lib/domain/types";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { TierBadge } from "./tier-badge";
import { LifecycleBadge, LIFECYCLE_LABEL } from "./lifecycle-badge";
import { AccountableApproverChip } from "./accountable-approver-chip";

// Column order per ui-spec §2 item 3: Intake -> Triaged -> In Review ->
// Conditionally Approved / Approved -> Deployed -> Paused -> Rejected.
const COLUMNS: LifecycleState[] = [
  "intake_draft",
  "triaged",
  "in_review",
  "conditionally_approved",
  "approved",
  "fast_lane_approved",
  "deployed",
  "paused",
  "rejected",
];

export function PipelineBoard({ initiatives }: { initiatives: InitiativeSummary[] }) {
  const byState = new Map<LifecycleState, InitiativeSummary[]>();
  for (const col of COLUMNS) byState.set(col, []);
  for (const init of initiatives) {
    if (!byState.has(init.state)) byState.set(init.state, []);
    byState.get(init.state)!.push(init);
  }

  return (
    <div
      data-slot="pipeline-board"
      className="grid grid-flow-col auto-cols-[minmax(220px,1fr)] gap-3 overflow-x-auto pb-2"
    >
      {COLUMNS.map((state) => {
        const items = byState.get(state) ?? [];
        return (
          <div
            key={state}
            data-column={state}
            className="flex min-w-[220px] flex-col gap-2 rounded-lg bg-muted/40 p-2"
          >
            <div className="flex items-center justify-between px-1">
              <span className="text-sm font-medium">{LIFECYCLE_LABEL[state]}</span>
              <span className="text-xs text-muted-foreground">{items.length}</span>
            </div>
            {items.length === 0 ? (
              <p className="px-1 text-xs text-muted-foreground">
                No initiatives in {LIFECYCLE_LABEL[state]}
              </p>
            ) : (
              items.map((init) => (
                <Link key={init.slug} href={`/initiatives/${init.slug}`}>
                  <Card
                    data-slot="pipeline-card"
                    className={
                      init.state === "paused"
                        ? "border-l-4 border-l-amber-500"
                        : undefined
                    }
                  >
                    <CardHeader className="gap-1 pb-0">
                      <div className="flex items-center justify-between gap-2">
                        <TierBadge tier={init.tier} />
                        {init.overdue ? (
                          <span className="text-xs font-medium text-red-600">overdue</span>
                        ) : null}
                      </div>
                      <p className="text-sm font-medium leading-snug">{init.title}</p>
                      <p className="text-xs text-muted-foreground">{init.slug}</p>
                    </CardHeader>
                    <CardContent className="flex items-center justify-between gap-2 pt-2">
                      <AccountableApproverChip name={init.accountableApprover} />
                      <LifecycleBadge state={init.state} />
                    </CardContent>
                  </Card>
                </Link>
              ))
            )}
          </div>
        );
      })}
    </div>
  );
}
