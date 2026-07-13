/**
 * Telemetry connector status — the honesty pattern for observability
 * (mirrors `lib/agents/registry.ts#agentRuntimeStatus()`, which reports
 * "OpenAI connected" only when OPENAI_API_KEY is set, else "deterministic
 * mock"). Jeeves never wires a real external tracing backend for the demo;
 * this module reports the truth either way so the Monitoring page can never
 * imply a live integration that doesn't exist (project hard rule).
 *
 * Env vars (document here — the only two this module reads):
 *   PHOENIX_ENDPOINT      — presence alone flips `configured` to true. This
 *                            is the connector's "is a backend wired up?"
 *                            signal, analogous to OPENAI_API_KEY.
 *   PHOENIX_PROVIDER_NAME — optional human-readable provider name shown when
 *                            configured; falls back to a constant.
 *
 * No live network call is ever made from this module — flipping the env var
 * only changes what the status CARD says, never causes the demo to actually
 * reach out to a tracing backend. If a real connector is added later, its
 * failure must still fall back to the in-repo synthetic series (never break
 * the demo) — that fallback contract is documented in `detail` below.
 */

const DEFAULT_PROVIDER_NAME = "Phoenix (Arize)";

// Fixed synthetic base date (matches lib/data/mock-provider.ts BASE_DATE) so
// a "configured" connector's lastSync is deterministic across renders and
// hydration-safe — never derived from Date.now().
const SYNTHETIC_BASE_MS = Date.parse("2026-07-01T00:00:00.000Z");
const SYNTHETIC_LAST_SYNC_OFFSET_MS = 6 * 60 * 60 * 1000; // +6h into the demo day

export interface TelemetryConnectorStatus {
  configured: boolean;
  provider: string;
  lastSyncIso: string | null;
  detail: string;
}

export function telemetryConnectorStatus(): TelemetryConnectorStatus {
  const configured = !!process.env.PHOENIX_ENDPOINT;
  const providerName = process.env.PHOENIX_PROVIDER_NAME?.trim() || DEFAULT_PROVIDER_NAME;

  if (!configured) {
    return {
      configured: false,
      provider: "Synthetic telemetry (demo)",
      lastSyncIso: null,
      detail:
        "No external tracing backend is connected (PHOENIX_ENDPOINT is unset) — every series on this page is the in-repo synthetic dataset. Connector failure never breaks the demo: telemetry always falls back to this synthetic series.",
    };
  }

  return {
    configured: true,
    provider: providerName,
    lastSyncIso: new Date(SYNTHETIC_BASE_MS + SYNTHETIC_LAST_SYNC_OFFSET_MS).toISOString(),
    detail: `${providerName} connector configured (PHOENIX_ENDPOINT set) — last sync shown is a deterministic demo timestamp, not a live poll. Connector failure never breaks the demo: telemetry falls back to the in-repo synthetic series.`,
  };
}

/** A single synthetic OTel-shaped trace row for display only (no external link). */
export interface SyntheticTraceRow {
  traceId: string;
  span: string;
  durationMs: number;
}

// Deterministic span catalog — cycled by index, not randomized.
const SPAN_NAMES = [
  "review.draft",
  "monitor.evaluate",
  "intake.completeness_check",
  "triage.route",
  "auditor.answer",
] as const;

// Deterministic per-span duration bands (ms) — a pure function of index, no
// Math.random/Date.now, so renders and tests are stable.
const DURATION_BANDS_MS = [420, 180, 65, 30, 240] as const;

/** Deterministic hex-looking id from a string seed — display-only, not a real trace id. */
function syntheticHex(seed: string, length: number): string {
  let h1 = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h1 ^= seed.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193);
  }
  // Expand via repeated hashing so we can produce an id longer than one
  // 32-bit hash's hex representation, still a pure function of `seed`.
  let hex = "";
  let state = h1 >>> 0;
  while (hex.length < length) {
    state = Math.imul(state ^ (state >>> 15), 0x2545f491) >>> 0;
    hex += state.toString(16).padStart(8, "0");
  }
  return hex.slice(0, length);
}

/**
 * `count` synthetic OTel-shaped trace rows, deterministically derived from
 * `initiativeSlug` + row index — no Math.random, no Date.now. Same slug
 * always produces the same rows (stable across renders/tests/SSR-hydration).
 */
export function syntheticTraces(initiativeSlug: string, count = 5): SyntheticTraceRow[] {
  return Array.from({ length: count }, (_, i) => {
    const span = SPAN_NAMES[i % SPAN_NAMES.length];
    const band = DURATION_BANDS_MS[i % DURATION_BANDS_MS.length];
    const seed = `${initiativeSlug}:${i}:${span}`;
    // Duration jitter derived from the same seed hash, kept within +/-20% of
    // the span's base band — deterministic, not random.
    const jitterPct = (parseInt(syntheticHex(seed, 4), 16) % 41) - 20; // -20..20
    const durationMs = Math.max(1, Math.round(band * (1 + jitterPct / 100)));
    return {
      traceId: syntheticHex(seed, 32),
      span,
      durationMs,
    };
  });
}
