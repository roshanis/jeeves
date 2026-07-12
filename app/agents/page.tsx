import { Bot, ShieldAlert, CircleCheck, CircleDashed } from "lucide-react";
import {
  GOVERNANCE_AGENTS,
  REVIEW_AGENTS,
  LIFECYCLE_AGENTS,
  OVERSIGHT_AGENTS,
  AGENT_GUARDRAIL,
  agentRuntimeStatus,
  type GovernanceAgent,
} from "@/lib/agents/registry";
import { DOMAIN_LABEL } from "@/components/jeeves/domain-labels";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// Governance Agents catalog (the "suite of agents" behind the console): the 8
// per-domain review agents plus the lifecycle + oversight agents, surfaced as
// a first-class product view. Every agent drafts/recommends/explains — none
// decide (AGENTS.md rule 1), which the page states plainly.

function AgentGroup({
  eyebrow,
  title,
  subtitle,
  agents,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  agents: GovernanceAgent[];
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b bg-muted/40 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">{eyebrow}</p>
        <CardTitle className="text-sm">{title}</CardTitle>
        <p className="text-xs font-normal text-muted-foreground">{subtitle}</p>
      </CardHeader>
      <CardContent className="divide-y p-0">
        {agents.map((a) => (
          <div key={a.id} data-slot="agent-row" data-agent-id={a.id} className="px-4 py-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <Bot className="h-4 w-4 shrink-0 text-primary" aria-hidden />
              <span className="font-medium">{a.name}</span>
              {a.domain ? (
                <Badge variant="secondary">{DOMAIN_LABEL[a.domain]}</Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground">
                  Cross-cutting
                </Badge>
              )}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                {a.capability}
              </code>
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground">{a.summary}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>
                Accountable reviewer:{" "}
                <span className="font-medium text-foreground">
                  {a.accountablePersonaName ?? "Rotational — no fixed reviewer"}
                </span>
              </span>
              {a.policyId ? (
                <span>
                  Policy: <span className="font-mono">{a.policyId}</span>
                </span>
              ) : null}
              {a.controlPrefix ? (
                <span>
                  Controls: <span className="font-mono">{a.controlPrefix}-*</span>
                </span>
              ) : null}
              <span className="font-mono">{a.instructionsPath}</span>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function AgentsPage() {
  const status = agentRuntimeStatus();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Agents</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Governance agents</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          The suite of AI agents behind Jeeves — one review agent per governance
          domain, plus the lifecycle and oversight agents. Each is grounded only
          in the context it is given (policy corpus, control catalog, the
          initiative intake) and drafts a structured, cited assessment for a
          named human to edit and sign.
        </p>
      </div>

      {/* Never-approve guardrail — the architectural invariant, stated up front. */}
      <div
        role="note"
        data-slot="agent-guardrail"
        className="flex items-start gap-2.5 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm"
      >
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">Agents draft — humans decide.</span>{" "}
          {AGENT_GUARDRAIL}
        </p>
      </div>

      {/* Runtime connector status — honest about mock vs live. */}
      <div
        data-slot="agent-runtime-status"
        className="flex items-start gap-2.5 rounded-lg border bg-card px-4 py-3 text-sm"
      >
        {status.connected ? (
          <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
        ) : (
          <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
        )}
        <div>
          <p className="font-medium">
            Runtime: {status.connected ? "OpenAI connected" : "Deterministic mock adapter"}{" "}
            <span className="font-mono text-xs text-muted-foreground">({status.model})</span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{status.detail}</p>
        </div>
      </div>

      <AgentGroup
        eyebrow="Review agents"
        title={`Per-domain review agents (${REVIEW_AGENTS.length})`}
        subtitle="One agent per governance domain — bound to that domain's policy corpus, control family, and accountable reviewer."
        agents={REVIEW_AGENTS}
      />
      <AgentGroup
        eyebrow="Lifecycle agents"
        title="Intake & triage"
        subtitle="Agents that assist the front of the governance lifecycle — deterministic code stays authoritative for tier and completeness."
        agents={LIFECYCLE_AGENTS}
      />
      <AgentGroup
        eyebrow="Oversight agents"
        title="Audit & monitoring"
        subtitle="Agents that explain the record and watch deployments — the state-changing actions remain deterministic code."
        agents={OVERSIGHT_AGENTS}
      />

      <p className="text-xs text-muted-foreground">
        {GOVERNANCE_AGENTS.length} agents total · Synthetic data — demo. Meridian
        Health is a fictional payer; not affiliated with any real organization.
      </p>
    </div>
  );
}
