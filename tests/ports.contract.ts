// Checked by `tsc --noEmit`; these are type contracts, not runtime simulations.
import type { createMockAgentPort } from "@/lib/agents/mock-adapter";
import type { createOpenAIAgentPort } from "@/lib/agents/openai-adapter";
import type { createOpenAiAgentsAdapter } from "@/lib/agents/openai-agents-adapter";
import type { AgentPort, DraftReviewOutput, WorkflowRunHandle } from "@/lib/agents/ports";

type Assert<T extends true> = T;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

export type MockAdapterContract = Assert<ReturnType<typeof createMockAgentPort> extends AgentPort ? true : false>;
export type OpenAIAdapterContract = Assert<ReturnType<typeof createOpenAIAgentPort> extends AgentPort ? true : false>;
export type RecommendationContract = Assert<Same<DraftReviewOutput["recommendation"], "recommend-sign-off" | "recommend-conditional" | "recommend-return">>;
export type WorkflowHandleContract = Assert<Same<keyof WorkflowRunHandle<unknown, unknown, unknown>, "runId" | "events" | "result" | "resume" | "cancel">>;

export type OpenAIAgentsAdapterContract = Assert<ReturnType<typeof createOpenAiAgentsAdapter> extends AgentPort ? true : false>;
