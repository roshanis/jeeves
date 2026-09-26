import type { ActorRole, Domain } from "../domain/types";

interface DemoPersona {
  readonly id: string;
  readonly name: string;
  readonly role: Exclude<ActorRole, "system">;
  readonly reviewDomain: Domain | null;
}

/** Public fictional identities. Server callers still enforce session roles and domains. */
export const DEMO_PERSONAS = [
  { id: "priya-raman", name: "Priya Raman", role: "requester", reviewDomain: null },
  { id: "dan-kowalski", name: "Dan Kowalski", role: "requester", reviewDomain: null },
  { id: "elena-vasquez", name: "Dr. Elena Vasquez", role: "reviewer", reviewDomain: "clinical-safety" },
  { id: "marcus-webb", name: "Marcus Webb", role: "reviewer", reviewDomain: "privacy-hipaa" },
  { id: "sofia-grant", name: "Sofia Grant", role: "reviewer", reviewDomain: "responsible-ai" },
  { id: "james-liu", name: "James Liu", role: "reviewer", reviewDomain: "legal" },
  { id: "devon-clarke", name: "Devon Clarke", role: "reviewer", reviewDomain: "security" },
  { id: "wei-zhang", name: "Wei Zhang", role: "reviewer", reviewDomain: "tech-architecture" },
  { id: "grace-kim", name: "Grace Kim", role: "reviewer", reviewDomain: "data-governance" },
  { id: "tom-brennan", name: "Tom Brennan", role: "reviewer", reviewDomain: "procurement" },
  { id: "angela-torres", name: "Angela Torres", role: "approver", reviewDomain: null },
  { id: "ray-chen", name: "Ray Chen", role: "admin", reviewDomain: null },
  { id: "nia-okafor", name: "Nia Okafor", role: "program", reviewDomain: null },
] as const satisfies readonly DemoPersona[];

export type PersonaKey = (typeof DEMO_PERSONAS)[number]["id"];
export const DEMO_PERSONA_DIRECTORY = Object.fromEntries(
  DEMO_PERSONAS.map((persona) => [persona.id, persona]),
) as Readonly<Record<PersonaKey, DemoPersona & { readonly id: PersonaKey }>>;

export const REVIEWER_DOMAIN: Readonly<Record<string, Domain>> = Object.fromEntries(
  DEMO_PERSONAS.flatMap((persona) => persona.reviewDomain ? [[persona.id, persona.reviewDomain]] : []),
);

export function reviewerDomainForPersona(personaKey: string): Domain | null {
  return DEMO_PERSONAS.find((persona) => persona.id === personaKey)?.reviewDomain ?? null;
}

export function reviewerNameForDomain(domain: Domain): string {
  const persona = DEMO_PERSONAS.find((entry) => entry.reviewDomain === domain);
  if (!persona) throw new Error(`No demo reviewer assigned to ${domain}`);
  return persona.name;
}
