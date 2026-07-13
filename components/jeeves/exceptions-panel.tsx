"use client";

// Control-exception workflow surface (M4). Read-only for the public; an
// accountable approver/admin session gets Approve/Reject on a requested
// exception and Revoke/Renew on an approved one. Every action requires a
// reason and writes an audit event server-side (separation of duties enforced
// by the API — the requester can never decide their own exception).
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  apiErrorToMessage,
  decideException,
  isApiError,
  renewException,
  revokeException,
  type ExceptionRow,
} from "@/lib/client/api";
import { useLiveSessionOptional } from "@/lib/client/session-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type ActionKind = "approve" | "reject" | "revoke" | "renew";

const STATUS_BADGE: Record<ExceptionRow["status"], { label: string; className: string }> = {
  requested: { label: "Requested", className: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  approved: { label: "Approved", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  rejected: { label: "Rejected", className: "bg-destructive/10 text-destructive" },
  revoked: { label: "Revoked", className: "bg-destructive/10 text-destructive" },
  expired: { label: "Expired", className: "bg-muted text-muted-foreground" },
};

const ACTION_LABEL: Record<ActionKind, string> = {
  approve: "Approve exception",
  reject: "Reject exception",
  revoke: "Revoke exception",
  renew: "Renew exception",
};

export function ExceptionsPanel({ exceptions }: { exceptions: ExceptionRow[] }) {
  const router = useRouter();
  const live = useLiveSessionOptional();
  const session = live?.session ?? null;
  // A live session's `role` is the persona's actor role (approver/admin/…),
  // not the derived UI RoleKey. Only an approver/admin sees the action buttons;
  // the server independently authorizes (and enforces SoD) on the actual role.
  const canDecide = session?.role === "approver" || session?.role === "admin";

  const [dialog, setDialog] = React.useState<{ kind: ActionKind; id: string; controlId: string } | null>(null);
  const [reason, setReason] = React.useState("");
  const [pending, setPending] = React.useState(false);

  function openDialog(kind: ActionKind, id: string, controlId: string) {
    setReason("");
    setDialog({ kind, id, controlId });
  }

  async function confirm() {
    if (!session || !dialog) return;
    const trimmed = reason.trim();
    if (trimmed.length === 0) {
      toast.error("A reason is required.");
      return;
    }
    setPending(true);
    try {
      if (dialog.kind === "approve") await decideException(session.token, dialog.id, true, trimmed);
      else if (dialog.kind === "reject") await decideException(session.token, dialog.id, false, trimmed);
      else if (dialog.kind === "revoke") await revokeException(session.token, dialog.id, trimmed);
      else await renewException(session.token, dialog.id, trimmed);
      toast.success(`${ACTION_LABEL[dialog.kind]} — ${dialog.controlId}.`);
      setDialog(null);
      router.refresh();
    } catch (err) {
      toast.error(isApiError(err) ? apiErrorToMessage(err) : "Action failed.");
      if (isApiError(err) && err.status === 401) live?.logout();
    } finally {
      setPending(false);
    }
  }

  return (
    <Card data-slot="exceptions-panel">
      <CardHeader className="border-b bg-muted/40 py-3">
        <CardTitle className="text-sm">Control exceptions</CardTitle>
        <p className="text-xs font-normal text-muted-foreground">
          Time-boxed, accountable waivers. Agents never grant these — a named approver decides, with a reason and an audit trail.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        {exceptions.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground">No control exceptions on file.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] border-collapse text-sm">
              <caption className="sr-only">Control exceptions and their status</caption>
              <thead className="border-b bg-muted/50 text-xs uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Control</th>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Requested by</th>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Reason</th>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {exceptions.map((e) => {
                  const badge = STATUS_BADGE[e.status];
                  return (
                    <tr key={e.id} data-slot="exception-row" className="border-b last:border-0 align-top">
                      <td className="px-4 py-2.5 font-mono text-xs">{e.controlId}</td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex rounded px-1.5 py-0.5 text-xs font-medium ${badge.className}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{e.requestedBy}</td>
                      <td className="max-w-[24rem] px-4 py-2.5 text-muted-foreground">{e.reason}</td>
                      <td className="px-4 py-2.5">
                        {canDecide && e.status === "requested" ? (
                          <div className="flex gap-1.5">
                            <Button size="sm" onClick={() => openDialog("approve", e.id, e.controlId)}>
                              Approve
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => openDialog("reject", e.id, e.controlId)}>
                              Reject
                            </Button>
                          </div>
                        ) : canDecide && e.status === "approved" ? (
                          <div className="flex gap-1.5">
                            <Button size="sm" variant="outline" onClick={() => openDialog("revoke", e.id, e.controlId)}>
                              Revoke
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => openDialog("renew", e.id, e.controlId)}>
                              Renew
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      <Dialog open={dialog !== null} onOpenChange={(open) => (open ? null : setDialog(null))}>
        <DialogContent data-slot="exception-dialog" className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{dialog ? ACTION_LABEL[dialog.kind] : ""}</DialogTitle>
            <DialogDescription>
              {dialog ? `${dialog.controlId} — a reason is recorded to the audit trail.` : ""}
            </DialogDescription>
          </DialogHeader>
          <textarea
            className="min-h-24 w-full rounded-md border border-input bg-transparent p-2 text-sm"
            placeholder="Reason (required)"
            aria-label="Exception decision reason"
            value={reason}
            maxLength={2000}
            onChange={(ev) => setReason(ev.target.value)}
            data-slot="exception-reason"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button disabled={pending} onClick={() => void confirm()} data-slot="exception-confirm">
              {pending ? "Recording…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
