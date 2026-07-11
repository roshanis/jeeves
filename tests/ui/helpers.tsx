// Shared helpers for tests/ui component smoke tests. Not a test file itself
// (no .test. suffix) — vitest's include globs skip it.
import * as React from "react";
import { afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { RoleProvider } from "@/components/jeeves/role-context";
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

/** Renders under the same providers app/layout.tsx supplies. */
export function renderWithProviders(ui: React.ReactElement) {
  return render(
    <RoleProvider>
      <TooltipProvider>{ui}</TooltipProvider>
    </RoleProvider>,
  );
}
