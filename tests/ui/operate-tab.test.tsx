import { describe, expect, it, beforeAll } from "vitest";
import { screen } from "@testing-library/react";
import { EvalsTab } from "@/components/jeeves/operate-tab";
import { getProvider } from "@/lib/data";
import { installResizeObserverStub, renderWithProviders } from "./helpers";

beforeAll(() => {
  installResizeObserverStub();
});

describe("EvalsTab — breach initiative (#4 member-chat-copilot)", () => {
  it("renders the Q-01 threshold value 0.08", async () => {
    const detail = await getProvider().getInitiativeDetail("member-chat-copilot");
    expect(detail).not.toBeNull();

    renderWithProviders(
      <EvalsTab slug={detail!.summary.slug} telemetry={detail!.telemetry} />,
    );

    expect(screen.getByText("Q-01 threshold: 0.08")).toBeDefined();
  });

  it('labels every telemetry panel "Synthetic data — demo" with the Arize connector chip', async () => {
    const detail = await getProvider().getInitiativeDetail("member-chat-copilot");
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
    const provider = getProvider();
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
    const detail = await getProvider().getInitiativeDetail("member-chat-copilot");
    const { container } = renderWithProviders(
      <EvalsTab slug={detail!.summary.slug} telemetry={detail!.telemetry} />,
    );
    const evalPanel = container.querySelector('[data-kind="eval_hallucination"]');
    expect(evalPanel).not.toBeNull();
    expect(evalPanel!.querySelector('[data-slot="breach-marker"]')).not.toBeNull();
  });

  it("shows no breach marker for a healthy initiative (#12 callcenter-qa-scorer)", async () => {
    const detail = await getProvider().getInitiativeDetail("callcenter-qa-scorer");
    const { container } = renderWithProviders(
      <EvalsTab slug={detail!.summary.slug} telemetry={detail!.telemetry} />,
    );
    expect(container.querySelector('[data-slot="breach-marker"]')).toBeNull();
  });
});
