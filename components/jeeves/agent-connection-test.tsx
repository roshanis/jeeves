"use client";

// Live connector "Test connection" control for the /agents catalog. Sends a
// minimal, budget-gated probe (POST /api/agents/health) so a user who just
// added an OPENAI_API_KEY can confirm the agents will run live. Requires a
// live demo session (the probe is session-gated); without one it points the
// user at the top-bar passcode login rather than failing silently.
import * as React from "react";
import { CircleCheck, CircleX, Loader2, PlugZap } from "lucide-react";
import { testAgentConnection, isApiError, apiErrorToMessage, type ConnectorHealth } from "@/lib/client/api";
import { useLiveSessionOptional } from "@/lib/client/session-context";

export function AgentConnectionTest() {
  const live = useLiveSessionOptional();
  const session = live?.session ?? null;
  const [pending, setPending] = React.useState(false);
  const [result, setResult] = React.useState<ConnectorHealth | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function handleTest() {
    if (!session) return;
    setPending(true);
    setError(null);
    try {
      const health = await testAgentConnection(session.token);
      setResult(health);
    } catch (err) {
      setError(isApiError(err) ? apiErrorToMessage(err) : "Connection test failed.");
      if (isApiError(err) && err.status === 401) live?.logout();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2" data-slot="agent-connection-test">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void handleTest()}
          disabled={pending || !session}
          data-slot="test-connection-button"
          className="inline-flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <PlugZap className="h-4 w-4" aria-hidden />
          )}
          {pending ? "Testing…" : "Test connection"}
        </button>
        {!session ? (
          <span className="text-xs text-muted-foreground">
            Enter the demo passcode in the top bar to run a live connection test.
          </span>
        ) : null}
      </div>

      {result ? (
        <div
          className="flex items-start gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs"
          data-slot="test-connection-result"
        >
          {result.reachable ? (
            <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
          ) : result.configured ? (
            <CircleX className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
          ) : (
            <PlugZap className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
          )}
          <span className="text-muted-foreground">{result.detail}</span>
        </div>
      ) : null}

      {error ? (
        <p className="text-xs text-destructive" data-slot="test-connection-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
