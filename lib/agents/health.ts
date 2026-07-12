/**
 * Live connector health probe for the agent runtime (the /agents "Test
 * connection" action). Distinct from `registry.ts#agentRuntimeStatus()`,
 * which only reports whether a key is *configured* (a cheap, synchronous
 * env check). This actually reaches the provider with a minimal call so a
 * user who just pasted an OPENAI_API_KEY can confirm it works.
 *
 * Honesty guarantee: when no key is configured, this makes NO network call
 * at all — it returns the mock-adapter status immediately (the demo runs
 * fully offline on the deterministic mock). A live call happens ONLY when a
 * key is present. The calling route is session- AND budget-gated so a public
 * visitor can never burn the key.
 */
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";

export interface ConnectorHealth {
  /** OPENAI_API_KEY is present and non-empty. */
  configured: boolean;
  /** A live probe call actually succeeded (always false for the mock — no call is made). */
  reachable: boolean;
  adapter: "openai" | "mock";
  model: string;
  /** Round-trip latency of the successful probe call, in ms. */
  latencyMs?: number;
  detail: string;
}

const DEFAULT_TIMEOUT_MS = 8000;

export async function probeConnector(options?: { timeoutMs?: number }): Promise<ConnectorHealth> {
  const model = process.env.OPENAI_MODEL ?? "gpt-5.1";
  const key = process.env.OPENAI_API_KEY;

  // No key -> mock adapter. Return immediately; make NO network call.
  if (!key || key.trim().length === 0) {
    return {
      configured: false,
      reachable: false,
      adapter: "mock",
      model,
      detail:
        "No OPENAI_API_KEY configured — running the deterministic mock adapter (zero external calls). Add a key to run the agents live.",
    };
  }

  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    await generateText({
      model: openai(model),
      prompt: "Health check. Reply with the single word: ok",
      maxRetries: 0,
      abortSignal: controller.signal,
    });
    const latencyMs = Date.now() - startedAt;
    return {
      configured: true,
      reachable: true,
      adapter: "openai",
      model,
      latencyMs,
      detail: `OpenAI reachable — ${model} responded in ${latencyMs}ms. The per-domain review agents will run live.`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      configured: true,
      reachable: false,
      adapter: "openai",
      model,
      detail: `A key is configured but the live probe failed: ${message}`,
    };
  } finally {
    clearTimeout(timer);
  }
}
