# agents/ — Jeeves agent instruction corpus

This directory is the **source of truth for agent prompts and output contracts**. It is not
executable code — it is the content that `lib/agents/` adapters load at call time. Nothing in
here imports or is imported by TypeScript; the relationship is "documentation the adapter reads
(or a human keeps in sync with the adapter's inlined prompt)," not a module dependency.

## Why eve doesn't apply here

`plan.md` §4 records the P0 gate decision (2026-07-11): **Vercel AI SDK + Workflow SDK**, not eve
— see `agents-build-log.md` 04:40Z/04:45Z entries. Concretely, that means every agent invocation in
Jeeves is a single `generateText` (or equivalent) call with `Output.object` structured output
against an app-owned Zod schema, not an eve agent graph. The `agents/<name>/` directory-per-agent
layout is kept as **our own convention** for organizing prompts and their schemas — a filesystem
mirror of the `AgentPort` capability, not an eve artifact. If eve is reconsidered post-GA as an
optional adapter (plan.md §4, backlogged), this directory's content is what that adapter would also
need to load; nothing here is framework-specific.

## Directory-to-adapter mapping

Each subdirectory is one agent capability. Two files per agent:

| File | Role |
|---|---|
| `instructions.md` | The **system prompt**, verbatim. The adapter passes this as the `system` parameter to `generateText`. Nothing outside this file is prepended or appended except the per-call input payload (policy text, control rows, computed tier, etc. — all supplied as user/context content, never baked into the system prompt). |
| `schema.md` | Documents the **exact JSON shape** the call must return. This is the human-readable source; the load-bearing artifact is the corresponding Zod schema in `lib/agents/` (not yet written as of this commit — a separate worktree owns `lib/`). `schema.md` and the Zod schema must describe the same shape; if they drift, the Zod schema wins at runtime and `schema.md` is stale and should be fixed to match. |

Concretely, today's `AgentPort` (`lib/agents/ports.ts`) exposes three capability methods —
`draftReview`, `triageAssist`, `checkCompleteness` — with their own port-level input/output types.
The richer per-agent schemas documented under `agents/*/schema.md` (e.g. `reviewer/schema.md`'s
`assessmentMd` + `citations` + `evidenceRequests[]`) are what the underlying `generateText` call
actually returns; the adapter implementing `AgentPort.draftReview` is responsible for mapping that
richer shape down to the port's `DraftReviewOutput` (`draftMarkdown` / `recommendation` /
`suggestedConditions` / `missingEvidence`). The port stays stable even if a given agent's internal
schema gains fields, which is the point of the port boundary (AGENTS.md rule 4).

Other conventions every adapter must follow:

- **Model**: read from `process.env.OPENAI_MODEL` (`.env.example`: `OPENAI_MODEL=gpt-5.1`). No
  agent hardcodes a model id.
- **One invocation per draft.** Each `AgentPort` call is a single, complete `generateText` +
  `Output.object` round trip — no multi-turn tool loop, no hidden retries that silently change the
  output shape. If a call fails validation, the adapter surfaces a `PortFailure` (`ports.ts`); it
  does not paper over the failure with a second, different prompt.
- **Temperature low.** These are drafting/extraction tasks grounded in supplied text, not creative
  generation — low temperature (deterministic-leaning) keeps citations and structured fields
  stable across repeated runs on the same input, which matters for demo repeatability and for
  test fixtures that mock these calls (plan.md §8: "LLM calls mocked").
- **Context is passed in, never fetched.** An agent's `instructions.md` never instructs the model
  to look anything up. All policy text, control catalog rows, prior decisions, or query results
  the model needs are assembled by app code and included in the call's input content. This keeps
  every claim traceable to a specific input blob for testing and for the citation rules below.

## The never-approve rule (AGENTS.md rule 1)

Every agent in this directory drafts, recommends, routes, or explains. **None of them decide.**
Concretely:

- `reviewer` never outputs "approved" or "rejected" — only `ready-for-signature` or
  `return-with-gaps` (see `reviewer/schema.md`). A human reviewer signs; a named, accountable
  human approver approves or conditionally approves. The fast-lane path is a deterministic,
  pre-approved policy match computed in code (`fast-lane-policy.md` FL-2), not an agent decision,
  and it still names an accountable human approver (Angela Torres) on every record.
- `triage` never computes or overrides a tier — the tier and required-domains routing are
  deterministic code (`lib/triage`). The agent only narrates the rule that already fired.
- `intake` never invents an answer on the requester's behalf — it asks, flags gaps, and leaves
  blanks blank rather than guessing.
- `auditor` never recalls facts from training data or general knowledge — it answers only from
  structured query rows supplied in the call, and refuses otherwise.
- `ops-monitor` never decides that a breach occurred or that a deployment should pause — breach
  detection and the pause transition are deterministic code (`lib/controls/evaluate`). The agent
  only writes the human-readable summary of a detection that already happened.

If any adapter implementation is ever tempted to let a model's output directly flip a
`LifecycleState`, write a `ReviewDecision`, or move money/access/approval — that is a bug, not a
feature request. Authoritative state transitions live in application code + Postgres only
(AGENTS.md rule 4).
