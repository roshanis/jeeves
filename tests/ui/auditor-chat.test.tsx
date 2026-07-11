// AuditorChat (components/jeeves/auditor-chat.tsx) — natural-language audit
// chat (POST /api/chat/auditor). Security contract: `answerMd` is untrusted
// model output and must render as literal escaped text, never parsed as
// HTML/markdown — this suite's core assertion is that an HTML-shaped answer
// never produces a real DOM element.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./helpers";
import {
  LiveSessionProvider,
  resetLiveSessionForTests,
  useLiveSession,
} from "@/lib/client/session-context";
import { AuditorChat } from "@/components/jeeves/auditor-chat";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  resetLiveSessionForTests();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetLiveSessionForTests();
});

function renderChat() {
  return renderWithProviders(
    <LiveSessionProvider>
      <AuditorChat />
    </LiveSessionProvider>,
  );
}

describe("AuditorChat — no live session", () => {
  it("disables the question input and submit button with the passcode tooltip", () => {
    renderChat();
    const input = document.querySelector(
      '[data-slot="auditor-question-input"]',
    ) as HTMLInputElement;
    const submit = document.querySelector(
      '[data-slot="auditor-submit"]',
    ) as HTMLButtonElement;
    expect(input.disabled).toBe(true);
    expect(submit.disabled).toBe(true);
  });
});

describe("AuditorChat — live session", () => {
  // AuditorChat has no login UI of its own (session-gated only, no
  // passcode dialog) — mirror demo-mode-chip.test.tsx's fetch-mocked login
  // flow, but drive `login()` directly via a tiny capture component mounted
  // alongside AuditorChat under one shared LiveSessionProvider instance.
  let capturedLogin: ((passcode: string, personaKey: string) => Promise<unknown>) | null = null;

  function LoginCapture() {
    const { login } = useLiveSession();
    capturedLogin = login;
    return null;
  }

  async function renderLoggedIn() {
    const utils = renderWithProviders(
      <LiveSessionProvider>
        <LoginCapture />
        <AuditorChat />
      </LiveSessionProvider>,
    );

    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        token: "tok-live",
        workspaceId: "ws-1",
        expiresAt: Date.now() + 60_000,
      }),
    );
    await capturedLogin!("correct-pass", "priya-raman");

    return utils;
  }

  it("submits a question, renders the answer as literal text (never parsed as HTML), and shows citations + query used", async () => {
    await renderLoggedIn();

    const maliciousAnswer = "<img src=x onerror=alert(1)>ignored & <b>bold</b>";
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        answerMd: maliciousAnswer,
        citedEvents: ["evt-1", "evt-2"],
        queryUsed: "member-facing-phi",
        rows: [],
      }),
    );

    const input = document.querySelector(
      '[data-slot="auditor-question-input"]',
    ) as HTMLInputElement;
    expect(input.disabled).toBe(false);

    fireEvent.change(input, { target: { value: "who touches PHI?" } });
    const submit = document.querySelector('[data-slot="auditor-submit"]') as HTMLButtonElement;
    fireEvent.click(submit);

    await waitFor(() => {
      expect(document.querySelector('[data-slot="auditor-answer"]')).toBeTruthy();
    });

    const answerEl = document.querySelector('[data-slot="auditor-answer"]') as HTMLElement;
    // (a) the raw string is present as literal TEXT content.
    expect(answerEl.textContent).toBe(maliciousAnswer);
    // (b) no actual <img> element was injected anywhere in the document —
    // the string was never parsed as HTML.
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("b")).toBeNull();

    const cited = document.querySelector('[data-slot="auditor-cited-events"]') as HTMLElement;
    expect(cited.textContent).toContain("evt-1");
    expect(cited.textContent).toContain("evt-2");

    const queryUsed = document.querySelector('[data-slot="auditor-query-used"]') as HTMLElement;
    expect(queryUsed.textContent).toContain("member-facing-phi");
  });

  it("renders an empty-string answer without crashing", async () => {
    await renderLoggedIn();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { answerMd: "", citedEvents: [], queryUsed: "member-facing-phi", rows: [] }),
    );

    fireEvent.change(
      document.querySelector('[data-slot="auditor-question-input"]') as HTMLInputElement,
      { target: { value: "anything" } },
    );
    fireEvent.click(document.querySelector('[data-slot="auditor-submit"]') as HTMLButtonElement);

    await waitFor(() => {
      expect(document.querySelector('[data-slot="auditor-answer"]')).toBeTruthy();
    });
    expect(
      (document.querySelector('[data-slot="auditor-answer"]') as HTMLElement).textContent,
    ).toBe("");
  });
});
