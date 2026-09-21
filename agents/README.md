# Jeeves agent instructions and contracts

The Markdown files under this directory supply prompts and document model-output
shapes. Runtime validators live in `lib/agents/schemas.ts`; the intake payload
schema is shared with request validation in `lib/intake/schema.ts`.
Both schemas use one field definition list: saved drafts may omit historical
answers, while strict model output supplies every answer and uses `null` for unknowns.

## Implemented capabilities

`AgentPort` exposes three methods used by application callers:

- `draftReview`: prepares one domain review for a human to edit and sign.
- `intakeInterview`: continues an intake conversation; application code computes
  authoritative completeness from the returned payload.
- `auditorAnswer`: answers from structured query rows already fetched by the caller.

Tier selection, review routing and completeness checks are deterministic application
code. They do not invoke an AI triage/completeness method. Monitoring likewise uses
deterministic breach evaluation and incident narration; `ops-monitor/instructions.md`
records the narration specification, not an active LLM invocation.

The application owns fan-out, retries and persisted per-domain review progress.
There is no implemented generic `WorkflowPort`, workflow event stream or cancel
endpoint. Provider invocation cancellation/deadlines are distinct from durable
workflow cancellation.

## Runtime choices

Without an API key the mock adapter runs offline. With a configured key,
`JEEVES_AGENT_RUNTIME` selects the Vercel AI SDK adapter (`ai-sdk`, default) or the
OpenAI Agents SDK adapter (`agents-sdk`). Both implement the same application-owned
port; neither may approve, sign or change authoritative business state.

- Vercel uses `OPENAI_MODEL`, one structured-output call and `maxRetries: 0`.
- Agents SDK uses `OPENAI_LUNA_MODEL` for intake/auditor and `OPENAI_TERRA_MODEL`
  for drafting, with `OPENAI_REASONING_EFFORT` controlling reasoning effort.
- With Agents SDK, `JEEVES_DEEP_REVIEW=1` adds read-only policy-corpus tools to
  drafting, bounded by a maximum of 15 turns. Tracing is disabled unless
  `JEEVES_AGENT_TRACING=1`.

The shared invocation helper settles cancellation or a deadline even when a
provider ignores its abort signal. A late provider result cannot replace that
terminal outcome. This stops waiting locally; actual provider termination still
depends on its support for cancellation. SDK-specific errors are normalized by
adapters. Malformed model output is a non-retryable provider failure, including
in deep mode; validation failures mean rejected input before a provider call.

Prompts and policy files must be included in the deployed runtime. They are read
relative to the deployment's working directory. A successful minimal health probe
does not by itself verify review quality or every packaged asset.

## Review result preservation

The reviewer returns the rich shape documented in `reviewer/schema.md`.
`mapReviewerDraftToPortOutput` preserves policy anchors in `citations`, separately
from missing-evidence descriptions. Its human-editable `draftMarkdown` includes
control IDs with evidence requests and suggested conditions, plus any confidence
notes. Those details survive the existing Markdown persistence path without a
new database column. The recommendation remains advisory; only application-owned
human actions sign reviews and decide initiatives.

Shared reviewer instructions and the selected domain overlay form the system
prompt. Context supplied by the application belongs in the input payload. Deep
mode can additionally read full policy files, but model-directed retrieval alone
does not prove citation validity or access to current evidence. Neither runtime
may invent intake answers, evidence, policy anchors or approval authority.
