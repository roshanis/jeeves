import { describe, expect, it, beforeAll } from "vitest";
import { screen } from "@testing-library/react";
import { OperateTab } from "@/components/jeeves/operate-tab";
import { getProvider } from "@/lib/data";
import { installResizeObserverStub, renderWithProviders } from "./helpers";

beforeAll(() => {
  installResizeObserverStub();
});

describe("OperateTab — breach initiative (#4 member-chat-copilot)", () => {
  it("renders the Q-01 threshold value 0.08", async () => {
    const detail = await getProvider().getInitiativeDetail("member-chat-copilot");
    expect(detail).not.toBeNull();

    renderWithProviders(
      <OperateTab
        slug={detail!.summary.slug}
        telemetry={detail!.telemetry}
        deployments={detail!.deployments}
      />,
    );

    expect(screen.getByText("Q-01 threshold: 0.08")).toBeDefined();
  });

  it('labels every telemetry panel "Synthetic data — demo" with the Arize connector chip', async () => {
    const detail = await getProvider().getInitiativeDetail("member-chat-copilot");
    const { container } = renderWithProviders(
      <OperateTab
        slug={detail!.summary.slug}
        telemetry={detail!.telemetry}
        deployments={detail!.deployments}
      />,
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
    const provider = getProvider();
    const gpu = await provider.getInitiativeDetail("claims-ocr-coder");
    const chat = await provider.getInitiativeDetail("member-chat-copilot");

    expect(gpu!.telemetry.some((t) => t.kind === "gpu_util_pct")).toBe(true);
    expect(chat!.telemetry.some((t) => t.kind === "gpu_util_pct")).toBe(false);

    const { container } = renderWithProviders(
      <OperateTab
        slug={gpu!.summary.slug}
        telemetry={gpu!.telemetry}
        deployments={gpu!.deployments}
      />,
    );
    expect(
      container.querySelector('[data-kind="gpu_util_pct"]'),
    ).not.toBeNull();
  });
});
