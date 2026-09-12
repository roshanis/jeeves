import { BellRing, MailWarning } from "lucide-react";
import type { ReviewNotificationRow, TransportStatus } from "@/lib/services/notification-service";
import { DOMAIN_LABEL } from "@/lib/domain/labels";
import type { Domain } from "@/lib/domain/types";

// Outbound review-request queue.
//
// triage() opens every required domain's review at once, and now records the
// ask alongside it. This is where those asks become visible — without a
// surface, "we recorded it" would be its own version of the problem it was
// meant to fix.
//
// The panel's job is as much honesty as information: with no transport
// configured, every row here is an ask that exists inside the system and has
// reached nobody outside it. Saying that plainly is the point. Same posture
// as the telemetry connector card, which reports "not connected" rather than
// implying a feed.
export function ReviewRequestQueue({
  notifications,
  transport,
}: {
  notifications: ReviewNotificationRow[];
  transport: TransportStatus;
}) {
  return (
    <div className="panel overflow-hidden" data-slot="review-request-queue">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <BellRing className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="kicker">Review requests</span>
        {notifications.length > 0 ? (
          <span className="stat-value text-xs text-foreground">{notifications.length}</span>
        ) : null}
        {/* Status word, not a reassurance: these have not been delivered. */}
        <span
          className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-status-warning-bg px-2 py-0.5 text-xs font-medium text-status-warning-fg"
          data-slot="transport-status"
        >
          <MailWarning className="size-3" aria-hidden />
          {transport.configured ? `Delivering via ${transport.channel}` : "Not delivered"}
        </span>
      </div>

      <div className="border-b border-border bg-muted/40 px-4 py-2.5">
        <p className="text-xs text-muted-foreground">{transport.detail}</p>
      </div>

      {notifications.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted-foreground">
          No review requests recorded yet. Triaging an initiative opens one per
          required domain and records the ask here.
        </p>
      ) : (
        <ul className="divide-y">
          {notifications.map((n) => (
            <li key={n.id} className="flex items-start gap-3 px-4 py-2.5">
              <span className="mt-0.5 shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {DOMAIN_LABEL[n.domain as Domain] ?? n.domain}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{n.subject}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {/* ISO date, sliced — the same thing audit-console.tsx does.
                      formatShortDate exists but only as a private helper
                      duplicated inside three chart components; adding a
                      fourth copy to format one date would be worse. */}
                  Recorded {n.createdAt.toISOString().slice(0, 10)} · never delivered
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
