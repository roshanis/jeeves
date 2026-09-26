# Deployment monitoring and incident narration

This document describes the deterministic implementation. It is not an active
LLM prompt, and there is no monitor method on `AgentPort`.

`lib/controls/evaluate.ts` evaluates observation series against the effective
control's threshold and sustained-window rules. `lib/services/monitor-service.ts`
records detected breaches, pauses deployments and opens reassessment review cycles.
Those application rules determine the response; an AI model does not decide it.

Incident narration is a fixed template naming the breached control and initiative,
then recording the pause and reassessment. It does not generate severity rankings,
reassessment scope or additional recommendations. Scope and review requirements
remain application-owned data.

The incident, pause and reassessment changes must remain transactional and
idempotent. A missing AI prompt, unavailable provider or absent API key must not
prevent deterministic monitoring. Human actions to change thresholds or resume a
deployment keep their authorization, reason and audit requirements.

All examples and records belong to the fictional Meridian Health demo. Never
introduce real patient or member information.
