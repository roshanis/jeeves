import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { intakeChatMock, sessionRef } = vi.hoisted(() => ({
  intakeChatMock: vi.fn(),
  sessionRef: { role: "requester" as string },
}));
vi.mock("@/lib/client/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/client/api")>()),
  intakeChat: intakeChatMock,
}));
vi.mock("@/lib/client/session-context", () => ({
  useLiveSession: () => ({
    session: { token: "token", role: sessionRef.role, personaLabel: "Priya Raman" },
    logout: vi.fn(),
  }),
}));

import { IntakeChat } from "@/components/jeeves/intake-chat";

const PLACEHOLDER = "Tell the assistant about your initiative…";

describe("IntakeChat", () => {
  beforeEach(() => { intakeChatMock.mockReset(); sessionRef.role = "requester"; });
  afterEach(cleanup);

  it("tells a public (real request) visitor to use the structured form, not to switch persona", () => {
    sessionRef.role = "public";
    render(<IntakeChat />);
    expect(document.body.textContent).not.toMatch(/switch to a requester persona|viewing as/i);
    expect(document.body.textContent).toMatch(/structured form/i);
    expect(screen.queryByPlaceholderText(PLACEHOLDER)).toBeNull();
  });
});
