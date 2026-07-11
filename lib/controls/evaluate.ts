import type { Observation, Tier } from "../domain/types";

/**
 * The versioned, per-deployment control configuration used to evaluate a
 * breach candidate. This is the "effective control" from plan §5 —
 * threshold already resolved (see `resolveThreshold`) and attached to a
 * specific deployment.
 */
export interface EffectiveControl {
  deploymentId: string;
  controlId: string;
  threshold: number;
  /** Number of consecutive observations above threshold required to breach (Q-01: 3). */
  sustainedWindow: number;
}

/**
 * A breach candidate produced by `evaluateControl`. Carries a deterministic
 * identity key so repeated evaluations (e.g. an admin re-running the
 * monitor) do not create duplicate incidents — the caller can upsert on
 * `identityKey` instead of blindly inserting.
 */
export interface ControlEvaluationResult {
  breached: boolean;
  deploymentId: string;
  controlId: string;
  /**
   * Timestamp (ms) of the first observation in the sustained breaching
   * window. `null` when no breach is found.
   */
  windowStartTs: number | null;
  /**
   * Deterministic identity key: `${deploymentId}:${controlId}:${windowStartTs}`.
   * `null` when there is no breach (no window to key off of).
   */
  identityKey: string | null;
  /** The observations (in window) that triggered the breach, if any. */
  breachingObservations: Observation[];
}

/**
 * Evaluate a control against an observation series for sustained-threshold
 * breach (seed-spec Q-01: 3 consecutive points strictly above threshold).
 *
 * Detection rule: scan observations in ascending timestamp order; a breach
 * fires the moment `sustainedWindow` consecutive points (by time order,
 * not necessarily contiguous days — "consecutive" means consecutive
 * *observations* in the series) are strictly greater than the threshold.
 * The window start is the timestamp of the first observation in that
 * run. Only observations at or before `nowTs` are considered, so a
 * caller can replay history deterministically.
 *
 * `nowTs` is an argument, never read from the wall clock, so results are
 * reproducible in tests and safe for idempotent re-runs.
 */
export function evaluateControl(
  control: EffectiveControl,
  observations: Observation[],
  nowTs: number,
): ControlEvaluationResult {
  const relevant = observations
    .filter((o) => o.ts <= nowTs)
    .slice()
    .sort((a, b) => a.ts - b.ts);

  let runStartIndex = -1;
  let runLength = 0;
  let breachStartIndex = -1;

  for (let i = 0; i < relevant.length; i++) {
    const obs = relevant[i]!;
    if (obs.value > control.threshold) {
      if (runLength === 0) {
        runStartIndex = i;
      }
      runLength += 1;
      if (runLength >= control.sustainedWindow && breachStartIndex === -1) {
        breachStartIndex = runStartIndex;
        break;
      }
    } else {
      runLength = 0;
      runStartIndex = -1;
    }
  }

  const breached = breachStartIndex !== -1;
  const breachWindowStart = breached ? relevant[breachStartIndex]!.ts : null;
  const breachingObservations = breached
    ? relevant.slice(breachStartIndex, breachStartIndex + control.sustainedWindow)
    : [];

  return {
    breached,
    deploymentId: control.deploymentId,
    controlId: control.controlId,
    windowStartTs: breached ? breachWindowStart : null,
    identityKey: breached
      ? `${control.deploymentId}:${control.controlId}:${breachWindowStart}`
      : null,
    breachingObservations,
  };
}

/** Per-tier default thresholds plus an optional per-project/deployment override. */
export interface ThresholdDefinition {
  tierDefaults: Record<Tier, number>;
}

/**
 * Resolve the effective threshold for a control: project override wins if
 * present (including `0`, which is falsy but a valid override — only
 * `undefined`/`null` mean "no override"), else the tier default.
 */
export function resolveThreshold(
  definition: ThresholdDefinition,
  tier: Tier,
  projectOverride: number | null | undefined,
): number {
  if (projectOverride !== null && projectOverride !== undefined) {
    return projectOverride;
  }
  return definition.tierDefaults[tier];
}
