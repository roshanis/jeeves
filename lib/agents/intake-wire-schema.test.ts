// @vitest-environment node
import { createOpenAI } from "@ai-sdk/openai";
import { describe, expect, it, vi } from "vitest";
import { createOpenAIAgentPortWithModel } from "./openai-adapter";
import { CHAMPION_PREFILL_PAYLOAD } from "../intake/champion-prefill";
import { EMPTY_INTAKE_PAYLOAD } from "../intake/defaults";
import { intakePayloadSchema } from "../intake/schema";

const historicalAnswers = [
  ["useCase", "currentWorkflow"],
  ["useCase", "successMetrics"],
  ["data", "vendorDataReuse"],
  ["populationImpact", "evaluationPlan"],
  ["deployment", "operationalOwner"],
  ["deployment", "humanReviewProcess"],
  ["deployment", "monitoringPlan"],
  ["deployment", "fallbackPlan"],
] as const;

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected an object in the captured request schema");
  }
  return value as Record<string, unknown>;
}

function expectStrictObjects(node: unknown, path = "$", objects: string[] = []): string[] {
  if (Array.isArray(node)) {
    node.forEach((child, index) => expectStrictObjects(child, `${path}[${index}]`, objects));
  } else if (node !== null && typeof node === "object") {
    const schema = object(node);
    expect(schema, path).not.toHaveProperty("default");
    if (schema.type === "object") {
      objects.push(path);
      expect(schema.additionalProperties, path).toBe(false);
      const fields = Object.keys(object(schema.properties));
      expect(schema.required, path).toEqual(expect.arrayContaining(fields));
    }
    for (const [key, child] of Object.entries(schema)) {
      expectStrictObjects(child, `${path}.${key}`, objects);
    }
  }
  return objects;
}

function permitsNull(node: unknown): boolean {
  const schema = object(node);
  return schema.type === "null"
    || (Array.isArray(schema.type) && schema.type.includes("null"))
    || [schema.anyOf, schema.oneOf].some((variants) => Array.isArray(variants) && variants.some(permitsNull));
}

describe("intake model request schema", () => {
  it.each(["responses", "chat"] as const)("sends a strict %s schema with required, nullable unanswered fields", async (api) => {
    const capturedRequests: Record<string, unknown>[] = [];
    // Exercise the real provider serializer; this stub never delegates to fetch.
    // Its synthetic 400 stops after capture, without claiming provider acceptance.
    const localFetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      capturedRequests.push(object(JSON.parse(String(init?.body))));
      return new Response(JSON.stringify({ error: { message: "Local request capture complete", type: "invalid_request_error" } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    });
    const provider = createOpenAI({
      apiKey: "synthetic-local-test-key",
      baseURL: "https://local-capture.invalid/v1",
      fetch: localFetch,
    });
    const port = createOpenAIAgentPortWithModel(provider[api]("gpt-5.4"));
    const result = await port.intakeInterview({
      conversation: [{ role: "user", content: "I have not answered the intake questions yet." }],
      partialPayload: EMPTY_INTAKE_PAYLOAD,
    });

    expect(result).toMatchObject({ ok: false, error: { kind: "provider", retryable: false } });
    expect(localFetch).toHaveBeenCalledOnce();
    const request = capturedRequests[0];
    const format = api === "responses"
      ? object(object(request.text).format)
      : object(object(request.response_format).json_schema);
    expect(format.strict).toBe(true);
    const schema = object(format.schema);
    expect(expectStrictObjects(schema)).toContain("$.properties.payload.properties.overlay");

    const sections = object(object(object(schema.properties).payload).properties);
    for (const [section, field] of historicalAnswers) {
      const sectionSchema = object(sections[section]);
      expect(sectionSchema.required, `${section}.${field}`).toContain(field);
      expect(permitsNull(object(sectionSchema.properties)[field]), `${section}.${field}`).toBe(true);
    }
    for (const [field, fieldSchema] of Object.entries(object(object(sections.overlay).properties))) {
      expect(permitsNull(fieldSchema), `overlay.${field}`).toBe(true);
    }
  });

  it("still accepts historical omissions at the storage boundary as unanswered", () => {
    const parsed = intakePayloadSchema.parse(CHAMPION_PREFILL_PAYLOAD);
    for (const [section, field] of historicalAnswers) {
      expect(object(CHAMPION_PREFILL_PAYLOAD[section])).not.toHaveProperty(field);
      expect(object(parsed[section])[field], `${section}.${field}`).toBeNull();
    }
  });
});
