// Signed-out wording that differs by deployment mode. Type-only import, so
// this is safe in client components.
import type { DeploymentMode } from "@/lib/config/deployment-mode";

/** The existing sign-in page; production's answer to every "start the demo" prompt. */
export const SIGN_IN_HREF = "/sign-in";

/** "Start the demo to <action>" in demo, "Sign in to <action>" in production. */
export function signInPrompt(mode: DeploymentMode, action: string): string {
  return mode === "demo" ? `Start the demo to ${action}` : `Sign in to ${action}`;
}

export function sessionExpiredMessage(mode: DeploymentMode): string {
  return mode === "demo" ? "Your session expired. Start the demo again." : "Your session expired. Sign in again.";
}
