/**
 * Demo actor directory + fast-lane policy config (seed-spec §1).
 *
 * Server-side ONLY mapping from a session's `personaKey` to an `Actor`
 * `{id, role}`. Route handlers/services must resolve role from this
 * directory — NEVER trust a role claim in a request body (task brief §4;
 * plan.md AGENTS.md hard rule 4/5 — authoritative state lives in app code).
 */
import type { Actor, ActorRole, Domain } from "../domain/types";

/** Stable persona keys the demo session UI offers (seed-spec §1 actors). */
export type PersonaKey =
  | "priya-raman"
  | "dan-kowalski"
  | "elena-vasquez"
  | "marcus-webb"
  | "sofia-grant"
  | "james-liu"
  | "devon-clarke"
  | "wei-zhang"
  | "grace-kim"
  | "tom-brennan"
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
  "devon-clarke": { id: "devon-clarke", name: "Devon Clarke", role: "reviewer" },
  "wei-zhang": { id: "wei-zhang", name: "Wei Zhang", role: "reviewer" },
  "grace-kim": { id: "grace-kim", name: "Grace Kim", role: "reviewer" },
  "tom-brennan": { id: "tom-brennan", name: "Tom Brennan", role: "reviewer" },
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
 * Server-side mirror of `lib/client/personas.ts`'s `REVIEWER_DOMAIN` (seed-
 * spec §1): each of the 8 named reviewer personas owns exactly one
 * governance domain (one accountable reviewer per domain, so every required
 * review is signable — a precondition for the completeness-before-approval
 * gate). Must be kept identical to the client map — if one changes, update
 * both in the same change.
 */
const REVIEWER_DOMAIN: Record<string, Domain> = {
  "elena-vasquez": "clinical-safety",
  "marcus-webb": "privacy-hipaa",
  "sofia-grant": "responsible-ai",
  "james-liu": "legal",
  "devon-clarke": "security",
  "wei-zhang": "tech-architecture",
  "grace-kim": "data-governance",
  "tom-brennan": "procurement",
};

/**
 * The governance domain a reviewer persona is assigned to, or `null` if the
 * actor is not one of the 4 named reviewer personas (including non-reviewer
 * roles and reviewers with no standing assignment). Used by
 * `initiative-service.ts`'s `signReview`/`returnReview` to enforce that a
 * reviewer may only act on their own domain.
 */
export function reviewerDomainFor(actorId: string): Domain | null {
  return REVIEWER_DOMAIN[actorId] ?? null;
}

/**
 * Standing fast-lane policy (seed-spec §2 fast-lane counterpoint; plan §1
 * autonomy reframe). Named accountable approver is required by
 * `transition()`'s `requiresFastLanePolicy` rule — never invented per-call.
 */
export const FAST_LANE_POLICY = {
  policyId: "FL-2026-01",
  accountableApprover: "Angela Torres",
} as const;
