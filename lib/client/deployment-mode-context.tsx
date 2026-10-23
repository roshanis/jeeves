"use client";

/**
 * The deployment mode, for client components.
 *
 * The mode is decided on the SERVER (lib/config/deployment-mode.ts reads
 * JEEVES_MODE at request time) and handed down as a prop by the root layout.
 * It is deliberately not a NEXT_PUBLIC_ variable: the browser bundle must not
 * be something that can be built to believe it is the demo. Only the type is
 * imported here, so no server module reaches the client bundle.
 *
 * What it is for: hiding demo chrome (persona switcher, "Start demo", the
 * fictional-payer banner, synthetic-telemetry labels) in production. It is a
 * presentation switch, not a security control: the demo's doors are closed by
 * the server (404s, refused issuers), whatever the UI shows.
 *
 * The default is "demo" and only matters outside the root layout, which always
 * mounts the provider: it keeps isolated component renders (tests) showing the
 * demo they were written against. tests/ui/production-mode-ui.test.tsx pins
 * that the layout mounts the provider with the server's mode.
 */
import * as React from "react";
import type { DeploymentMode } from "@/lib/config/deployment-mode";

const DeploymentModeContext = React.createContext<DeploymentMode>("demo");

export function DeploymentModeProvider({
  mode,
  children,
}: {
  mode: DeploymentMode;
  children: React.ReactNode;
}) {
  return <DeploymentModeContext.Provider value={mode}>{children}</DeploymentModeContext.Provider>;
}

/** The mode the server rendered this page in. */
export function useDeploymentMode(): DeploymentMode {
  return React.useContext(DeploymentModeContext);
}
