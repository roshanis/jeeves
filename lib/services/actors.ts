/**
 * Demo actor directory + fast-lane policy config (seed-spec §1).
 *
 * Server-side ONLY mapping from a session's `personaKey` to an `Actor`
 * `{id, role}`. Route handlers/services must resolve role from this
 * directory — NEVER trust a role claim in a request body (task brief §4;
 * plan.md AGENTS.md hard rule 4/5 — authoritative state lives in app code).
 */
import type { Actor, ActorRole } from "../domain/types";

/** Stable persona keys the demo session UI offers (seed-spec §1 actors). */
export type PersonaKey =
  | "priya-raman"
  | "dan-kowalski"
  | "elena-vasquez"
  | "marcus-webb"
  | "sofia-grant"
  | "james-liu"
  | "angela-torres"
  | "ray-chen"
  | "nia-okafor";

interface ActorDirectoryEntry {
  readonly id: string;
  readonly name: string;
  readonly role: ActorRole;
}

/** seed-spec §1 — fictional demo actors, keyed by stable personaKey. */
export const ACTOR_DIRECTORY: Record<PersonaKey, ActorDirectoryEntry> = {
  "priya-raman": { id: "priya-raman", name: "Priya Raman", role: "requester" },
  "dan-kowalski": { id: "dan-kowalski", name: "Dan Kowalski", role: "requester" },
  "elena-vasquez": { id: "elena-vasquez", name: "Dr. Elena Vasquez", role: "reviewer" },
  "marcus-webb": { id: "marcus-webb", name: "Marcus Webb", role: "reviewer" },
  "sofia-grant": { id: "sofia-grant", name: "Sofia Grant", role: "reviewer" },
  "james-liu": { id: "james-liu", name: "James Liu", role: "reviewer" },
  "angela-torres": { id: "angela-torres", name: "Angela Torres", role: "approver" },
  "ray-chen": { id: "ray-chen", name: "Ray Chen", role: "admin" },
  "nia-okafor": { id: "nia-okafor", name: "Nia Okafor", role: "program" },
};

/** Type guard: is `value` a known persona key? */
export function isPersonaKey(value: string): value is PersonaKey {
  return Object.prototype.hasOwnProperty.call(ACTOR_DIRECTORY, value);
}

/**
 * Resolve a persona key (from the session, never from a mutation body) to
 * an `Actor` for `lib/lifecycle/transitions.ts`. Returns `null` for an
 * unknown key so callers can 401/400 rather than default to a role.
 */
export function resolveActor(personaKey: string): Actor | null {
  if (!isPersonaKey(personaKey)) return null;
  const entry = ACTOR_DIRECTORY[personaKey];
  return { id: entry.id, role: entry.role };
}

/** Display name for audit details, e.g. "Angela Torres" — resolveActor() only returns id/role. */
export function actorName(personaKey: string): string {
  if (!isPersonaKey(personaKey)) return personaKey;
  return ACTOR_DIRECTORY[personaKey].name;
}

/** system pseudo-actor for automated transitions (triage, fast-lane). */
export const SYSTEM_ACTOR: Actor = { id: "system", role: "system" };

/**
 * Standing fast-lane policy (seed-spec §2 fast-lane counterpoint; plan §1
 * autonomy reframe). Named accountable approver is required by
 * `transition()`'s `requiresFastLanePolicy` rule — never invented per-call.
 */
export const FAST_LANE_POLICY = {
  policyId: "FL-2026-01",
  accountableApprover: "Angela Torres",
} as const;
