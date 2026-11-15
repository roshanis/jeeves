import { describe, expect, it, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { act, screen } from "@testing-library/react";
import {
  LiveSessionProvider,
  resetLiveSessionForTests,
  useLiveSession,
} from "@/lib/client/session-context";
import { EvalsTab, seriesYDomain } from "@/components/jeeves/operate-tab";
import { MockDataProvider } from "@/lib/data/mock-provider";
import { installResizeObserverStub, renderWithProviders } from "./helpers";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));

beforeAll(() => {
  installResizeObserverStub();
});

describe("EvalsTab — breach initiative (#4 member-chat-copilot)", () => {
  it("renders the Q-01 threshold value 0.08", async () => {
    const detail = await new MockDataProvider().getInitiativeDetail("member-chat-copilot");
    expect(detail).not.toBeNull();

    renderWithProviders(
      <EvalsTab slug={detail!.summary.slug} telemetry={detail!.telemetry} />,
    );

    expect(screen.getByText("Q-01 threshold: 0.08")).toBeDefined();
  });

  it('labels every telemetry panel "Synthetic data — demo" with the Arize connector chip', async () => {
    const detail = await new MockDataProvider().getInitiativeDetail("member-chat-copilot");
    const { container } = renderWithProviders(
      <EvalsTab slug={detail!.summary.slug} telemetry={detail!.telemetry} />,
    );

    const panels = container.querySelectorAll('[data-slot="telemetry-panel"]');
    expect(panels.length).toBeGreaterThan(0);
    const labels = screen.getAllByText("Synthetic data — demo");
    const chips = screen.getAllByText("Arize: not connected");
    // One label + one connector chip per panel — no exceptions.
    expect(labels).toHaveLength(panels.length);
    expect(chips).toHaveLength(panels.length);
  });

  it("only claims-ocr-coder gets a GPU panel", async () => {
    const provider = new MockDataProvider();
    const gpu = await provider.getInitiativeDetail("claims-ocr-coder");
    const chat = await provider.getInitiativeDetail("member-chat-copilot");

    expect(gpu!.telemetry.some((t) => t.kind === "gpu_util_pct")).toBe(true);
    expect(chat!.telemetry.some((t) => t.kind === "gpu_util_pct")).toBe(false);

    const { container } = renderWithProviders(
      <EvalsTab slug={gpu!.summary.slug} telemetry={gpu!.telemetry} />,
    );
    expect(
      container.querySelector('[data-kind="gpu_util_pct"]'),
    ).not.toBeNull();
  });
});

describe("EvalsTab — breach marker (review P3)", () => {
  it("marks the eval panel Threshold exceeded when #4's series crosses Q-01", async () => {
    const detail = await new MockDataProvider().getInitiativeDetail("member-chat-copilot");
    const { container } = renderWithProviders(
      <EvalsTab slug={detail!.summary.slug} telemetry={detail!.telemetry} />,
    );
    const evalPanel = container.querySelector('[data-kind="eval_hallucination"]');
    expect(evalPanel).not.toBeNull();
    expect(evalPanel!.querySelector('[data-slot="breach-marker"]')).not.toBeNull();
  });

  it("shows no breach marker for a healthy initiative (#12 callcenter-qa-scorer)", async () => {
    const detail = await new MockDataProvider().getInitiativeDetail("callcenter-qa-scorer");
    const { container } = renderWithProviders(
      <EvalsTab slug={detail!.summary.slug} telemetry={detail!.telemetry} />,
    );
    expect(container.querySelector('[data-slot="breach-marker"]')).toBeNull();
  });
});

describe("EvalsTab — Run monitor action (ui-shell-F11)", () => {
  let login: ((personaKey: string) => Promise<unknown>) | null = null;
  function LoginCapture() {
    login = useLiveSession().login;
    return null;
  }
  beforeEach(() => resetLiveSessionForTests());
  afterEach(() => {
    vi.unstubAllGlobals();
    resetLiveSessionForTests();
  });

  it("is enabled in a live session, not a permanently disabled button", async () => {
    const detail = await new MockDataProvider().getInitiativeDetail("member-chat-copilot");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ token: "tok", workspaceId: "ws-1", expiresAt: Date.now() + 60_000 }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    renderWithProviders(
      <LiveSessionProvider>
        <LoginCapture />
        <EvalsTab slug={detail!.summary.slug} telemetry={detail!.telemetry} />
      </LiveSessionProvider>,
    );
    await act(async () => {
      await login!("ray-chen");
    });
    const button = document.querySelector('[data-slot="run-monitor"]') as HTMLButtonElement;
    expect(button).not.toBeNull();
    expect(button.getAttribute("aria-disabled")).not.toBe("true");
  });
});

describe("seriesYDomain — threshold line stays visible (ui-shell-F13)", () => {
  it("raises the axis top to the threshold when the series sits well below it", () => {
    const [, top] = seriesYDomain("eval_hallucination", 0.08);
    expect((top as (max: number) => number)(0.0494)).toBeGreaterThanOrEqual(0.08);
  });
  it("keeps the fixed GPU scale", () => {
    expect(seriesYDomain("gpu_util_pct", 90)).toEqual([0, 100]);
  });
});
