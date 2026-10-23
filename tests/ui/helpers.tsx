// Shared helpers for tests/ui component smoke tests. Not a test file itself
// (no .test. suffix) — vitest's include globs skip it.
import * as React from "react";
import { afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { RoleProvider } from "@/components/jeeves/role-context";
import { DeploymentModeProvider } from "@/lib/client/deployment-mode-context";
import type { DeploymentMode } from "@/lib/config/deployment-mode";
import { TooltipProvider } from "@/components/ui/tooltip";

// vitest globals are not enabled in this repo, so @testing-library/react
// cannot auto-register its afterEach cleanup — register it explicitly for
// every test file that imports these helpers, otherwise renders accumulate
// in the shared jsdom document and duplicate-element queries fail.
afterEach(cleanup);

// jsdom has no ResizeObserver; Recharts' ResponsiveContainer requires one.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

export function installResizeObserverStub(): void {
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver =
      ResizeObserverStub as unknown as typeof ResizeObserver;
  }
}

/**
 * Renders under the same providers app/layout.tsx supplies, including the
 * deployment mode: demo unless a case says otherwise (the context itself
 * defaults to production, so an unwrapped render shows no demo chrome).
 */
export function renderWithProviders(ui: React.ReactElement, options: { mode?: DeploymentMode } = {}) {
  return render(
    <DeploymentModeProvider mode={options.mode ?? "demo"}>
      <RoleProvider>
        <TooltipProvider>{ui}</TooltipProvider>
      </RoleProvider>
    </DeploymentModeProvider>,
  );
}
