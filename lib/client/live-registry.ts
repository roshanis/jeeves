/**
 * Session-scoped registry of initiatives created/triaged during the live
 * demo, keyed by slug.
 *
 * Why this exists: the read-model DTOs (lib/data/dto.ts) expose only the
 * slug — never the DB `initiativeId` or a review cycle's `cycleId` — but
 * every mutating API route is keyed by initiativeId (and sign/return by
 * cycleId). The create/triage responses DO return those ids, so the client
 * remembers them here (sessionStorage) and the detail-page live actions
 * look them up by slug.
 *
 * Implemented as a subscribable external store (for
 * `React.useSyncExternalStore`) so components read it without
 * setState-in-effect patterns and stay hydration-safe: the server snapshot
 * is always the empty registry, and subscribers re-render right after
 * hydration if sessionStorage has entries.
 *
 * Deliberately NOT cleared on logout/reset-to-read-only: ids are harmless
 * bookkeeping, and the demo storyline logs out (requester) and back in
 * (reviewer, then approver) against the same initiative — the follow-on
 * personas still need the cycleId. Cleared naturally when the browser
 * session ends (sessionStorage semantics).
 *
 * Consequence (documented judgment call): live actions only light up for
 * initiatives created during this browser session. The 12 seeded
 * initiatives have no client-reachable initiativeId/cycleId, so their
 * action buttons stay in the read-only disabled-with-tooltip state.
 */

export interface LiveInitiativeInfo {
  initiativeId: string;
  cycleId?: string;
}

type Registry = Readonly<Record<string, LiveInitiativeInfo>>;

const STORAGE_KEY = "jeeves_live_registry";
const EMPTY_REGISTRY: Registry = Object.freeze({});

let cachedRegistry: Registry | null = null;
const listeners = new Set<() => void>();

function loadRegistry(): Registry {
  if (typeof window === "undefined") return EMPTY_REGISTRY;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_REGISTRY;
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") return parsed as Registry;
    return EMPTY_REGISTRY;
  } catch {
    return EMPTY_REGISTRY;
  }
}

function persist(registry: Registry): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(registry));
  } catch {
    // sessionStorage unavailable (private-mode edge cases) — live actions
    // simply won't survive navigation; nothing to do.
  }
}

function emit(): void {
  for (const listener of listeners) listener();
}

/** useSyncExternalStore subscribe function. */
export function subscribeRegistry(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** useSyncExternalStore client snapshot (stable reference between writes). */
export function getRegistrySnapshot(): Registry {
  if (cachedRegistry === null) {
    cachedRegistry = loadRegistry();
  }
  return cachedRegistry;
}

/** useSyncExternalStore server snapshot — always empty (read-only SSR). */
export function getRegistryServerSnapshot(): Registry {
  return EMPTY_REGISTRY;
}

/** Record a freshly created initiative's id (from POST /api/initiatives). */
export function rememberInitiative(slug: string, initiativeId: string): void {
  const next: Registry = {
    ...getRegistrySnapshot(),
    [slug]: { ...getRegistrySnapshot()[slug], initiativeId },
  };
  cachedRegistry = next;
  persist(next);
  emit();
}

/** Record the review cycle opened by triage (or reported by draft-run). */
export function rememberCycle(slug: string, cycleId: string): void {
  const existing = getRegistrySnapshot()[slug];
  if (!existing) return;
  const next: Registry = {
    ...getRegistrySnapshot(),
    [slug]: { ...existing, cycleId },
  };
  cachedRegistry = next;
  persist(next);
  emit();
}

/** Non-hook lookup (event handlers, tests). */
export function getLiveInfo(slug: string): LiveInitiativeInfo | null {
  return getRegistrySnapshot()[slug] ?? null;
}

/** Test-only: drop the module cache (and stored value) between tests. */
export function resetRegistryForTests(): void {
  cachedRegistry = null;
  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
  emit();
}
