# Reviewer agent — output schema

This is the structured object every `reviewer` invocation must return via `Output.object`. The
authoritative type is the Zod schema in `lib/agents/` (owned by a separate worktree at the time
this document was written); this file is the human-readable spec that schema must match.

```ts
interface ReviewerDraftOutput {
  /**
   * The draft assessment itself, Markdown, written for a human reviewer to
   * edit before signing. Concise and bulleted, <= 400 words (instructions.md).
   * Every requirement claim inside this text must carry an inline citation
   * in the format documented below (e.g. "... per MP-H v3 §MP-H-2.1.").
   */
  assessmentMd: string;

  /**
   * Every citation used anywhere in this output (assessmentMd, evidenceRequests
   * descriptions, suggestedConditions text), deduplicated, in the exact format
   * "<Policy ID> §<anchor>", e.g. "MP-H v3 §MP-H-2.1". Every entry here must be
   * a section anchor that verifiably appeared in the policy text supplied for
   * this call — never a citation invented or recalled from another domain.
   */
  citations: string[];

  /**
   * Structured, actionable evidence gaps. One entry per missing or
   * insufficient artifact the policy/control catalog requires that was not
   * present in the supplied intake + evidence status. Every applicable
   * control with a gap must appear here, even if also mentioned in prose.
   */
  evidenceRequests: {
    controlId: string;     // e.g. "H-01" — must match a control id supplied in this call
    description: string;   // what's missing and why it's required (may include a citation)
  }[];

  /**
   * The draft recommendation. Never "approved"/"rejected" — see
   * instructions.md. This is advisory input to a human reviewer's own
   * sign/return decision, not a decision itself.
   */
  recommendation: "ready-for-signature" | "return-with-gaps";

  /**
   * Optional conditions the accountable approver could attach to a
   * conditional approval, only when the domain's policy text supports
   * conditional approval for this fact pattern (e.g. MP-C-4.2/MP-C-5.2).
   * Empty array when not applicable — do not invent conditions for domains
   * whose policy text has no conditional-approval mechanism.
   */
  suggestedConditions: {
    text: string;        // concrete, controllable condition (e.g. a sampling rate, a cadence)
    controlId: string;   // the control this condition is linked to
  }[];

  /**
   * Free-text notes on the agent's own confidence/uncertainty: ambiguous
   * intake answers, policy language that seems to admit more than one
   * reading, or grounds-for-rejection language that the human reviewer
   * and accountable approver need to weigh (this agent does not resolve
   * such judgment calls itself). Not shown as a citation-bearing claim —
   * this is where genuine hedging belongs, kept out of assessmentMd.
   */
  confidenceNotes: string;
}
```

## Field-level notes

- `assessmentMd` and `citations` must be consistent: every citation string that appears inline in
  `assessmentMd` should also appear in the `citations` array, and the array should not contain
  citations that appear nowhere in the output (assessmentMd, evidenceRequests descriptions, or
  suggestedConditions text).
- `evidenceRequests` may be empty (`[]`) only when `recommendation` is `ready-for-signature` and no
  applicable control has an outstanding gap. A non-empty `evidenceRequests` array does not by
  itself force `recommendation` to `return-with-gaps` if the domain's policy treats the gap as
  advisory rather than gating — but in practice, most populated `evidenceRequests` entries
  correspond to gate controls and will co-occur with `return-with-gaps`.
- `controlId` values in both `evidenceRequests` and `suggestedConditions` must be ids that were
  supplied in the control catalog rows for this call — never a control id from a different domain
  or an invented id.
- Keep `confidenceNotes` short (a few sentences) — it is a signal to the human reviewer, not a
  second assessment.
