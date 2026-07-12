/**
 * POST /api/agents/health — live connector health probe (the /agents "Test
 * connection" action). Session-gated AND budget-gated (`runMutationGuard`) so
 * a public visitor can never trigger a call against the configured key.
 *
 * When no key is configured, `probeConnector` returns the mock status WITHOUT
 * any network call; when a key is set, it makes one minimal, bounded live
 * call and reports latency (or the failure).
 *
 * 200: ConnectorHealth
 * 401/429: no/invalid session, rate limit, or budget exhausted.
 */
import { runMutationGuard } from "@/lib/services/route-guard";
import { probeConnector } from "@/lib/agents/health";

/** Tiny reserve — a health ping is a single minimal call. */
const ESTIMATED_TOKENS = 50;

export async function POST(req: Request): Promise<Response> {
  const guard = await runMutationGuard(req, undefined, {
    requiresBudget: true,
    estimatedTokens: ESTIMATED_TOKENS,
  });
  if (!guard.ok) {
    return Response.json({ error: guard.failure.message }, { status: guard.failure.status });
  }

  const health = await probeConnector();
  return Response.json(health, { status: 200 });
}
