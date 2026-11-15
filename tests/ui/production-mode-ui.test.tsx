/**
 * The demo chrome is a demo property. In production the persona switcher, the
 * "Start demo" chip, the "Try the demo" button, the fictional-payer banner and
 * the synthetic-telemetry labels do not render; in demo every one of them
 * renders exactly as before.
 *
 * The mode reaches client components through DeploymentModeProvider, which the
 * root layout mounts from the SERVER-side deploymentMode() (the browser bundle
 * is never built to believe a mode). The root-layout cases at the bottom pin
 * that wiring: a layout that forgot the provider would show demo chrome on a
 * production install.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { RoleProvider } from "@/components/jeeves/role-context";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LiveSessionProvider, resetLiveSessionForTests } from "@/lib/client/session-context";
import { DeploymentModeProvider, useDeploymentMode } from "@/lib/client/deployment-mode-context";
import { DEMO_BANNER_TEXT, demoBannerFor } from "@/lib/demo-banner";
import { RoleSwitcher } from "@/components/jeeves/role-switcher";
import { DemoModeChip } from "@/components/jeeves/demo-mode-chip";
import { TryDemoButton } from "@/components/jeeves/try-demo-button";
import { SyntheticDataLabel } from "@/components/jeeves/synthetic-data-label";
import { AppTopBar } from "@/components/jeeves/app-topbar";
import { AppSidebar } from "@/components/jeeves/app-sidebar";
import ConsoleLayout from "@/app/(console)/layout";
import type { DeploymentMode } from "@/lib/config/deployment-mode";

vi.mock("next/navigation", () => ({
  usePathname: () => "/portfolio",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));
vi.mock("next/font/local", () => ({
  default: () => ({ variable: "--font-mock", className: "" }),
}));
vi.mock("@/components/jeeves/console-top-bar", () => ({
  ConsoleTopBar: () => null,
}));

if (typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  cleanup();
  resetLiveSessionForTests();
  vi.unstubAllEnvs();
});

function inMode(mode: DeploymentMode, ui: React.ReactElement) {
  return render(
    <DeploymentModeProvider mode={mode}>
      <RoleProvider>
        <LiveSessionProvider>
          <TooltipProvider>{ui}</TooltipProvider>
        </LiveSessionProvider>
      </RoleProvider>
    </DeploymentModeProvider>,
  );
}

function ModeProbe() {
  return <span data-testid="mode">{useDeploymentMode()}</span>;
}

describe("DeploymentModeProvider", () => {
  // A component rendered outside the provider must not show demo chrome (the
  // persona switcher, "Start demo", the fictional-payer banner): the safe
  // answer to "which mode?" when nobody said is production.
  it("fails closed: a component outside the provider sees production", () => {
    render(<ModeProbe />);
    expect(screen.getByTestId("mode").textContent).toBe("production");
  });

  it.each([
    ["RoleSwitcher", <RoleSwitcher key="a" />],
    ["DemoModeChip", <DemoModeChip key="b" />],
    ["TryDemoButton", <TryDemoButton key="c" />],
  ])("%s renders nothing outside the provider", (_name, element) => {
    const { container } = render(
      <RoleProvider>
        <LiveSessionProvider>
          <TooltipProvider>{element}</TooltipProvider>
        </LiveSessionProvider>
      </RoleProvider>,
    );
    expect(container.textContent).toBe("");
    expect(container.querySelector("button, select, input")).toBeNull();
  });

  it("hands the server-chosen mode to client components", () => {
    inMode("production", <ModeProbe />);
    expect(screen.getByTestId("mode").textContent).toBe("production");
    cleanup();
    inMode("demo", <ModeProbe />);
    expect(screen.getByTestId("mode").textContent).toBe("demo");
  });
});

describe("demoBannerFor", () => {
  it("is the exact required banner in demo and nothing in production", () => {
    expect(demoBannerFor("demo")).toBe(DEMO_BANNER_TEXT);
    expect(demoBannerFor("production")).toBeNull();
  });
});

describe("demo chrome", () => {
  it.each([
    ["RoleSwitcher", <RoleSwitcher key="a" />, () => document.querySelector('[data-slot="demo-persona-select"]')],
    ["DemoModeChip", <DemoModeChip key="b" />, () => document.querySelector('[data-slot="demo-mode-chip"]')],
    ["TryDemoButton", <TryDemoButton key="c" />, () => screen.queryByRole("button", { name: "Try the demo" })],
  ])("%s renders in demo", (_name, element, find) => {
    inMode("demo", element);
    expect(find()).not.toBeNull();
  });

  it.each([
    ["RoleSwitcher", <RoleSwitcher key="a" />],
    ["DemoModeChip", <DemoModeChip key="b" />],
    ["TryDemoButton", <TryDemoButton key="c" />],
  ])("%s renders nothing in production", (_name, element) => {
    const { container } = inMode("production", element);
    expect(container.textContent).toBe("");
    expect(container.querySelector("button, select, input")).toBeNull();
  });
});

describe("SyntheticDataLabel", () => {
  it("labels the telemetry panel in demo", () => {
    inMode("demo", <SyntheticDataLabel><p>cost series</p></SyntheticDataLabel>);
    expect(screen.getByText("Synthetic data — demo")).toBeTruthy();
    expect(screen.getByText("Arize: not connected")).toBeTruthy();
    expect(screen.getByText("cost series")).toBeTruthy();
  });

  // Telemetry has no source in production yet. A panel is therefore either
  // absent or, if one ever renders, it is not the demo's fabricated data under
  // a missing label: the wrapper is the single choke point for "no telemetry
  // chart without the label", so it removes the panel with the label.
  it("removes the whole panel in production rather than showing it unlabeled", () => {
    const { container } = inMode("production", <SyntheticDataLabel><p>cost series</p></SyntheticDataLabel>);
    expect(container.textContent).toBe("");
  });
});

describe("AppTopBar", () => {
  it("shows the banner, the demo chip and the persona picker in demo", () => {
    inMode("demo", <AppTopBar initiatives={[]} />);
    expect(screen.getByText(DEMO_BANNER_TEXT)).toBeTruthy();
    expect(document.querySelector('[data-slot="demo-mode-chip"]')).not.toBeNull();
    expect(document.querySelector('[data-slot="demo-persona-select"]')).not.toBeNull();
  });

  it("drops the banner, the chip and the picker in production, keeping the working header", () => {
    const { container } = inMode("production", <AppTopBar initiatives={[]} />);
    expect(screen.queryByText(DEMO_BANNER_TEXT)).toBeNull();
    expect(container.textContent).not.toMatch(/fictional|synthetic|demo/i);
    expect(document.querySelector('[data-slot="demo-mode-chip"]')).toBeNull();
    expect(document.querySelector('[data-slot="demo-persona-select"]')).toBeNull();
    expect(screen.queryByRole("button", { name: "Start demo" })).toBeNull();
    expect(document.querySelector('[data-slot="breadcrumb"]')?.textContent).toBe("Portfolio");
    expect(screen.getByRole("button", { name: /theme/i })).toBeTruthy();
  });
});

describe("AppSidebar", () => {
  it("labels the workspace as the synthetic Meridian demo in demo", () => {
    inMode("demo", <AppSidebar />);
    expect(screen.getByText("Meridian Health")).toBeTruthy();
    expect(screen.getByText("Synthetic demo workspace")).toBeTruthy();
  });

  it("does not call a production install a synthetic demo workspace", () => {
    const { container } = inMode("production", <AppSidebar />);
    expect(container.textContent).not.toMatch(/meridian|synthetic|demo/i);
    expect(screen.getByRole("link", { name: /inbox/i })).toBeTruthy();
  });
});

describe("ConsoleLayout footer", () => {
  it("keeps the fictional-demo disclaimer in demo", () => {
    vi.stubEnv("JEEVES_MODE", "demo");
    inMode("demo", <ConsoleLayout><p>page</p></ConsoleLayout>);
    expect(screen.getByText(/Fictional demo\. Synthetic data only/)).toBeTruthy();
  });

  it("drops it in production", () => {
    vi.stubEnv("JEEVES_MODE", undefined);
    inMode("production", <ConsoleLayout><p>page</p></ConsoleLayout>);
    expect(screen.queryByText(/Fictional demo/)).toBeNull();
    expect(screen.getByText("page")).toBeTruthy();
  });
});

describe("RootLayout mounts the server-chosen mode", () => {
  async function renderRoot(): Promise<HTMLElement> {
    const { default: RootLayout } = await import("@/app/layout");
    const { container } = render(
      <RootLayout>
        <RoleSwitcher />
        <ModeProbe />
      </RootLayout>,
    );
    return container;
  }

  it("shows demo chrome when the server is in demo", async () => {
    vi.stubEnv("JEEVES_MODE", "demo");
    await renderRoot();
    expect(screen.getByTestId("mode").textContent).toBe("demo");
    expect(document.querySelector('[data-slot="demo-persona-select"]')).not.toBeNull();
  });

  it("hides demo chrome when the server is in production, whatever the client defaults to", async () => {
    vi.stubEnv("JEEVES_MODE", undefined);
    await renderRoot();
    expect(screen.getByTestId("mode").textContent).toBe("production");
    expect(document.querySelector('[data-slot="demo-persona-select"]')).toBeNull();
  });

  it("treats a mistyped mode as production", async () => {
    vi.stubEnv("JEEVES_MODE", "Demo");
    await renderRoot();
    expect(screen.getByTestId("mode").textContent).toBe("production");
  });
});
