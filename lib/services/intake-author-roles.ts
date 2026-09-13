/**
 * Roles permitted to author an intake: the demo `requester` personas, and
 * the passcode-free `public` submitter.
 *
 * Kept as one named set rather than three inline `||` checks so the public
 * surface is enumerable — these three routes are the entire list, and any
 * fourth would have to add itself here deliberately.
 */
export const INTAKE_AUTHOR_ROLES: ReadonlySet<string> = new Set(["requester", "public"]);
