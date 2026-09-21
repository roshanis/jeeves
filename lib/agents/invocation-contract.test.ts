// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { createOpenAIAgentPortWithModel } from "./openai-adapter";
import { createOpenAiAgentsAdapterWithRunner } from "./openai-agents-adapter";
import type { AgentPort, DraftReviewInput } from "./ports";

const input: DraftReviewInput = {
  reviewCycleId: "cycle-contract",
  domain: "security",
  intake: { initiativeId: "initiative-contract", intakeVersionId: "intake-contract", answers: {} },
};
const output = {
  assessmentMd: "Synthetic assessment.",
  citations: ["SYN-POLICY v1 §2"],
  evidenceRequests: [],
  suggestedConditions: [],
  recommendation: "ready-for-signature",
  confidenceNotes: "Synthetic fixture.",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const factories: { name: string; create: (wait: (signal?: AbortSignal) => Promise<void>) => AgentPort }[] = [
  {
    name: "Vercel AI SDK",
    create: (wait) => createOpenAIAgentPortWithModel(new MockLanguageModelV4({
      doGenerate: async ({ abortSignal }) => {
        await wait(abortSignal);
        return {
          content: [{ type: "text", text: JSON.stringify(output) }],
          finishReason: { unified: "stop", raw: "stop" },
          usage: {
            inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 10, text: 10, reasoning: undefined },
          },
          warnings: [],
        };
      },
    })),
  },
  {
    name: "OpenAI Agents SDK",
    create: (wait) => createOpenAiAgentsAdapterWithRunner(async (_agent, _prompt, options) => {
      await wait(options?.signal);
      return { finalOutput: output };
    }),
  },
];

describe.each(factories)("$name invocation contract", ({ create }) => {
  it("settles caller cancellation before a provider that ignores abort and later succeeds", async () => {
    const provider = deferred<void>();
    const started = deferred<void>();
    let providerSignal: AbortSignal | undefined;
    const port = create((signal) => {
      providerSignal = signal;
      started.resolve();
      return provider.promise;
    });
    const controller = new AbortController();
    const call = port.draftReview(input, { signal: controller.signal, timeoutMs: 500 });
    await started.promise;
    controller.abort();
    const observed = await Promise.race([
      call,
      new Promise<"still pending">((resolve) => setTimeout(() => resolve("still pending"), 30)),
    ]);
    provider.resolve();
    const settled = await call;
    expect(providerSignal?.aborted).toBe(true);
    expect(observed).toEqual({ ok: false, error: { kind: "cancelled" } });
    expect(settled).toEqual(observed);
  });

  it("keeps timeout terminal when the ignored provider later rejects", async () => {
    const provider = deferred<void>();
    const port = create(() => provider.promise);
    const call = port.draftReview(input, { timeoutMs: 5 });
    const result = await call;
    provider.reject(new Error("late provider failure"));
    expect(result).toMatchObject({ ok: false, error: { kind: "timeout" } });
    expect(await call).toEqual(result);
  });
});
