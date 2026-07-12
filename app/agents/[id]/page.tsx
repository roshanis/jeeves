import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { GOVERNANCE_AGENTS, AGENT_GUARDRAIL } from "@/lib/agents/registry";
import { DOMAIN_LABEL } from "@/components/jeeves/domain-labels";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// Per-agent detail page — the drill-down from the Governance agents catalog
// (app/agents/page.tsx). Reads the agent's actual instructions file(s) off
// disk server-side and renders them as pre-formatted text so a reviewer can
// see exactly what system prompt the adapter sends, with no markdown
// rendering dependency introduced.

const SHARED_REVIEWER_INSTRUCTIONS_PATH = "agents/reviewer/instructions.md";

function readInstructionsFile(repoRelativePath: string): string | null {
  const absolutePath = path.join(process.cwd(), repoRelativePath);
  if (!existsSync(absolutePath)) {
    return null;
  }
  return readFileSync(absolutePath, "utf-8");
}

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const agent = GOVERNANCE_AGENTS.find((a) => a.id === id);
  if (!agent) {
    notFound();
  }

  const isReviewer = agent.kind === "reviewer";
  const sharedInstructions = isReviewer
    ? readInstructionsFile(SHARED_REVIEWER_INSTRUCTIONS_PATH)
    : null;
  const primaryInstructions = readInstructionsFile(agent.instructionsPath);

  return (
    <div className="flex flex-col gap-6" data-slot="agent-detail" data-agent-id={agent.id}>
      <div>
        <Link
          href="/agents"
          className="text-xs font-medium text-muted-foreground hover:underline underline-offset-4"
        >
          ← All agents
        </Link>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Agents</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{agent.name}</h1>
          {agent.domain ? (
            <Badge variant="secondary">{DOMAIN_LABEL[agent.domain]}</Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              Cross-cutting
            </Badge>
          )}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
            {agent.capability}
          </code>
        </div>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{agent.summary}</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>
            Accountable reviewer:{" "}
            <span className="font-medium text-foreground">
              {agent.accountablePersonaName ?? "Rotational — no fixed reviewer"}
            </span>
          </span>
          <span>
            Policy: <span className="font-mono">{agent.policyId ?? "—"}</span>
          </span>
          <span>
            Controls:{" "}
            <span className="font-mono">
              {agent.controlPrefix ? `${agent.controlPrefix}-*` : "—"}
            </span>
          </span>
          <span className="font-mono">{agent.instructionsPath}</span>
        </div>
      </div>

      {/* Never-approve guardrail — same styling as the catalog page. */}
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

      {isReviewer ? (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Run this agent</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Reviewers run this agent on demand from the Reviews workbench for a
            specific initiative.{" "}
            <Link href="/reviews" className="font-medium text-primary hover:underline underline-offset-4">
              Go to the Reviews workbench →
            </Link>
          </CardContent>
        </Card>
      ) : null}

      {isReviewer ? (
        <>
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm">Shared reviewer instructions</CardTitle>
              <p className="text-xs font-normal text-muted-foreground">{SHARED_REVIEWER_INSTRUCTIONS_PATH}</p>
            </CardHeader>
            <CardContent>
              <PromptBody content={sharedInstructions} fallbackSummary={agent.summary} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm">Domain track overlay</CardTitle>
              <p className="text-xs font-normal text-muted-foreground">{agent.instructionsPath}</p>
            </CardHeader>
            <CardContent>
              <PromptBody content={primaryInstructions} fallbackSummary={agent.summary} />
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">System prompt</CardTitle>
            <p className="text-xs font-normal text-muted-foreground">{agent.instructionsPath}</p>
          </CardHeader>
          <CardContent>
            <PromptBody content={primaryInstructions} fallbackSummary={agent.summary} />
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        Synthetic data — demo. Meridian Health is a fictional payer; not
        affiliated with any real organization.
      </p>
    </div>
  );
}

/** Renders instruction-file content as pre-formatted text, or a fallback note when the path isn't a readable file (e.g. the completeness agent's inline prompt). */
function PromptBody({
  content,
  fallbackSummary,
}: {
  content: string | null;
  fallbackSummary: string;
}) {
  if (content === null) {
    return (
      <div>
        <p className="text-sm text-muted-foreground">{fallbackSummary}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          System prompt is defined inline in code (lib/intake/completeness.ts).
        </p>
      </div>
    );
  }
  return (
    <div className="max-h-[32rem] overflow-y-auto overflow-x-auto rounded-md border bg-muted/30">
      <pre className="whitespace-pre-wrap break-words p-3 font-mono text-xs text-foreground">
        {content}
      </pre>
    </div>
  );
}
