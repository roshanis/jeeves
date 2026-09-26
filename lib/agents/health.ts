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
import { getAgentPort } from "./index";
import { AgentInitializationError } from "./initialization-error";
import { resolveAgentRuntimeConfig, type AgentRuntimeConfig } from "./runtime";

export interface ConnectorHealth extends AgentRuntimeConfig {
  /** A live probe call actually succeeded (always false for the mock — no call is made). */
  reachable: boolean;
  /** Compatibility alias for the reviewer model probed here. */
  model: string;
  /** Null for the keyless mock, where no live assets are needed or checked. */
  assetsReady: boolean | null;
  /** Round-trip latency of the successful probe call, in ms. */
  latencyMs?: number;
  detail: string;
}

const DEFAULT_TIMEOUT_MS = 8000;

export async function probeConnector(options?: { timeoutMs?: number }): Promise<ConnectorHealth> {
  const runtime = resolveAgentRuntimeConfig();
  // Probe the model used for draftReview. Agents SDK chat uses a separate
  // model; this one-word check does not verify chat or structured output.
  const model = runtime.reviewerModel;

  // No key -> mock adapter. Return immediately; make NO network call.
  if (!runtime.configured) {
    return {
      ...runtime,
      reachable: false,
      model,
      assetsReady: null,
      detail:
        "No OPENAI_API_KEY configured — running the deterministic mock adapter (zero external calls). Add a key to run the agents live.",
    };
  }

  try {
    // Initialize the selected runtime, including deep-policy preflight when
    // enabled. This performs local reads only, before any paid provider call.
    getAgentPort();
  } catch {
    return {
      ...runtime,
      reachable: false,
      model,
      assetsReady: false,
      detail: new AgentInitializationError().message,
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
      ...runtime,
      reachable: true,
      model,
      assetsReady: true,
      latencyMs,
      detail: `Agent assets loaded (${runtime.runtime}). AI SDK provider probe: OpenAI ${model} responded in ${latencyMs}ms. Structured reviews, the Agents SDK tool loop and chat were not tested.`,
    };
  } catch {
    return {
      ...runtime,
      reachable: false,
      model,
      assetsReady: true,
      detail: `Agent assets loaded (${runtime.runtime}), but the provider check failed. Check model access, credentials, quota, and connectivity.`,
    };
  } finally {
    clearTimeout(timer);
  }
}
