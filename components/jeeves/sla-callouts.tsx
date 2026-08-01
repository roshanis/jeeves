import type { InitiativeSummary } from "@/lib/data/dto";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EvidenceLink } from "./evidence-link";
import { TriangleAlert } from "lucide-react";

interface Callout {
  slug: string;
  tab: "controls" | "reviews" | "operate" | "decisions";
  text: string;
}

/**
 * SLA / bottleneck callouts (ui-spec §2 item 5) — short list of the
 * seed-spec's known storyline flags, each linking straight into the
 * relevant initiative tab.
 */
export function SlaCallouts({ initiatives }: { initiatives: InitiativeSummary[] }) {
  const bySlug = new Map(initiatives.map((i) => [i.slug, i]));
  const callouts: Callout[] = [];

  const rejected = bySlug.get("social-sentiment-miner");
  if (rejected) {
    callouts.push({
      slug: rejected.slug,
      tab: "decisions",
      text: `Initiative rejected — ${rejected.title} (#${rejected.slug})`,
    });
  }

  const returned = bySlug.get("formulary-qa-bot");
  if (returned) {
    callouts.push({
      slug: returned.slug,
      tab: "reviews",
      text: `1 review returned >5d ago — ${returned.title}`,
    });
  }

  const overdue = bySlug.get("fwa-anomaly-detector");
  if (overdue) {
    callouts.push({
      slug: overdue.slug,
      tab: "controls",
      text: `Periodic review overdue — ${overdue.title}`,
    });
  }

  const exception = bySlug.get("hr-resume-screener");
  if (exception) {
    callouts.push({
      slug: exception.slug,
      tab: "controls",
      text: `1 exception request pending — ${exception.title}`,
    });
  }

  const trending = bySlug.get("member-chat-copilot");
  if (trending) {
    callouts.push({
      slug: trending.slug,
      tab: "operate",
      text: `Eval quality trending toward threshold — ${trending.title}`,
    });
  }

  return (
    <Card data-slot="sla-callouts" className="card-quiet">
      <CardHeader className="border-b py-2.5">
        <p className="kicker">SLA &amp; bottleneck callouts</p>
      </CardHeader>
      <CardContent className="divide-y p-0">
        {callouts.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground">No callouts right now.</p>
        ) : (
          callouts.map((c) => (
            <div key={`${c.slug}-${c.tab}`} className="flex items-start gap-2.5 px-4 py-2.5">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-status-warning-fg" aria-hidden />
              <EvidenceLink slug={c.slug} tab={c.tab} className="text-sm hover:text-primary hover:underline">
                {c.text}
              </EvidenceLink>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
