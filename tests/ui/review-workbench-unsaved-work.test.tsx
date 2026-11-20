import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import { render } from "@testing-library/react";
import { RoleProvider } from "@/components/jeeves/role-context";
import { DeploymentModeProvider } from "@/lib/client/deployment-mode-context";
import type { DeploymentMode } from "@/lib/config/deployment-mode";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./helpers";
const mocks = vi.hoisted(() => ({ run: vi.fn(), refresh: vi.fn(), mutate: vi.fn(), session: vi.fn(), logout: vi.fn(), packet: { id: null as string | null }, error: vi.fn(), info: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, info: mocks.info, error: mocks.error } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/lib/client/session-context", () => ({ useLiveSessionOptional: mocks.session }));
vi.mock("@/lib/client/api", async (original) => ({ ...await original<typeof import("@/lib/client/api")>(), runReviewAgent: mocks.run }));
vi.mock("@/lib/client/review-actions", async (original) => ({ ...await original<typeof import("@/lib/client/review-actions")>(), performReviewMutation: mocks.mutate }));
vi.mock("@/components/jeeves/review-evidence-workspace", () => ({ ReviewEvidenceWorkspace: ({ children }: { children: (props: unknown) => unknown }) => children({ signingBlock: null, cycleId: "cycle", cycleChanged: false, evidencePacketId: mocks.packet.id, evidenceLoading: false }) }));
import { ReviewWorkbench, type ReviewQueueRow } from "@/components/jeeves/review-workbench";
import { ApiError } from "@/lib/client/api";
import { readUnsavedReview, unsavedReviewKey, type UnsavedReview } from "@/lib/client/review-unsaved-store";

const marcus = { token: "t1", personaKey: "marcus-webb", personaLabel: "Marcus Webb", role: "reviewer", workspaceId: "w", expiresAt: 9999999999999 };
const james = { ...marcus, token: "t3", personaKey: "james-liu", personaLabel: "James Liu" };
type S = typeof marcus | null;
function setSession(session: S) { mocks.session.mockReturnValue({ session, logout: mocks.logout }); }
const baseReview: ReviewQueueRow["review"] = { cycleId: "cycle", revision: 4, domain: "privacy-hipaa", status: "drafted", reviewer: null, createdAt: "2026-09-19T12:00:00Z", signedAt: null, draftMd: "Existing server draft", citations: [] };
function makeRows(over: Partial<ReviewQueueRow["review"]> = {}): ReviewQueueRow[] {
  return ["one", "two"].map((slug) => ({ slug, title: `Case ${slug}`, tier: "high", isSeeded: false, review: { ...baseReview, ...over } }));
}
let rowsNow: ReviewQueueRow[] = makeRows();
function Harness() {
  const [slug, setSlug] = useState("one");
  return <><button onClick={() => setSlug("one")}>Back to first</button><button onClick={() => setSlug("two")}>Other review</button><ReviewWorkbench rows={rowsNow} selection={{ slug, domain: "privacy-hipaa" }} /></>;
}
const textarea = () => screen.getByLabelText("Assessment text") as HTMLTextAreaElement;
const offer = () => screen.queryByRole("region", { name: "Unsaved work from an earlier session" });
const type = (value: string) => fireEvent.change(textarea(), { target: { value } });
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const isDisabled = (name: string) => screen.getByRole("button", { name }).hasAttribute("disabled") || screen.getByRole("button", { name }).getAttribute("aria-disabled") === "true";
let modeNow: DeploymentMode = "demo";
const app = () => <DeploymentModeProvider mode={modeNow}><RoleProvider><TooltipProvider><Harness /></TooltipProvider></RoleProvider></DeploymentModeProvider>;
function mount(session: S = marcus) { setSession(session); return render(app()); }
function reenter(view: ReturnType<typeof mount>, session: S) { setSession(session); view.rerender(app()); }
function seed(over: Partial<UnsavedReview> = {}) {
  window.sessionStorage.setItem(unsavedReviewKey("marcus-webb", "one", "privacy-hipaa"), JSON.stringify({ v: 1, personaKey: "marcus-webb", personaLabel: "Marcus Webb", slug: "one", domain: "privacy-hipaa", cycleKey: "cycle", revision: 4, evidencePacketId: null, text: "Seeded finding", savedAt: "2026-09-19T12:00:00.000Z", ...over }));
}
const stored = () => readUnsavedReview({ personaKey: "marcus-webb", slug: "one", domain: "privacy-hipaa", cycleKey: "cycle" });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.packet.id = null;
  modeNow = "demo";
  window.sessionStorage.clear();
  rowsNow = makeRows();
  setSession(marcus);
});

afterEach(() => { vi.restoreAllMocks(); });

describe("unsaved review work after the session ends", () => {
  it("keeps the typed assessment after a 401 on Sign and offers it back as the same persona", async () => {
    mocks.mutate.mockRejectedValue(new ApiError(401, "expired"));
    const view = mount();
    type("My careful finding");
    click("Sign");
    await act(async () => {});
    expect(mocks.logout).toHaveBeenCalledOnce();
    expect(mocks.error).toHaveBeenCalledTimes(1);
    expect(mocks.error).toHaveBeenCalledWith(expect.stringMatching(/kept in this browser tab/));
    reenter(view, null);
    expect(textarea().value).toBe("Existing server draft");
    expect(offer()).toBeNull();
    reenter(view, { ...marcus, token: "t2" });
    expect(offer()?.textContent).toContain("Marcus Webb has unsaved work for this review from an earlier session: assessment edits. It was kept in this browser tab only. Restore it to keep working, or discard it.");
    expect(mocks.info).toHaveBeenCalledWith(expect.stringMatching(/Unsaved work/), expect.objectContaining({ id: "unsaved-review-offer" }));
    expect(textarea().value).toBe("Existing server draft");
    expect(isDisabled("Sign")).toBe(true);
    click("Restore unsaved work");
    expect(textarea().value).toBe("My careful finding");
    expect(offer()).toBeNull();
    expect(document.activeElement).toBe(textarea());
    expect(isDisabled("Sign")).toBe(false);
  });

  it("restores the text after a 401 on Run agent", async () => {
    mocks.run.mockRejectedValue(new ApiError(401, "expired"));
    const view = mount();
    type("Text before the agent run");
    click("Re-run agent");
    await act(async () => {});
    expect(mocks.logout).toHaveBeenCalledOnce();
    reenter(view, { ...marcus, token: "t2" });
    click("Restore unsaved work");
    expect(textarea().value).toBe("Text before the agent run");
  });

  it("keeps both the text and the return reason after a 401 on Return", async () => {
    mocks.mutate.mockRejectedValue(new ApiError(401, "expired"));
    const view = mount();
    type("Text before the return");
    click("Return");
    fireEvent.change(screen.getByLabelText("Reason (required)"), { target: { value: "Needs the retention policy" } });
    click("Return review");
    await act(async () => {});
    expect(mocks.logout).toHaveBeenCalledOnce();
    expect(mocks.error).toHaveBeenCalledTimes(1);
    reenter(view, { ...marcus, token: "t2" });
    expect(offer()?.textContent).toMatch(/assessment edits and a typed return reason/);
    click("Restore unsaved work");
    expect(textarea().value).toBe("Text before the return");
    click("Return");
    expect((screen.getByLabelText("Reason (required)") as HTMLTextAreaElement).value).toBe("Needs the retention policy");
  });

  it("keeps the abstention reason after a 401 on Abstain", async () => {
    mocks.mutate.mockRejectedValue(new ApiError(401, "expired"));
    const view = mount();
    click("Abstain");
    fireEvent.change(screen.getByLabelText("Reason (required)"), { target: { value: "Conflict of interest" } });
    click("Record abstention");
    await act(async () => {});
    expect(mocks.logout).toHaveBeenCalledOnce();
    reenter(view, { ...marcus, token: "t2" });
    expect(offer()?.textContent).toMatch(/an abstention reason whose submission failed/);
    click("Restore unsaved work");
    click("Abstain");
    expect((screen.getByLabelText("Reason (required)") as HTMLTextAreaElement).value).toBe("Conflict of interest");
  });

  it("offers the work back when the session simply expires with no request", () => {
    const view = mount();
    type("Typed just before expiry");
    reenter(view, null);
    reenter(view, { ...marcus, token: "t2" });
    expect(offer()).toBeTruthy();
    click("Restore unsaved work");
    expect(textarea().value).toBe("Typed just before expiry");
  });

  it("offers nothing after a switch to a reviewer of another domain and offers the work back on switching back", () => {
    const view = mount();
    type("Marcus private text");
    reenter(view, james);
    expect(offer()).toBeNull();
    expect(textarea().value).toBe("Existing server draft");
    reenter(view, { ...marcus, token: "t4" });
    expect(offer()?.textContent).toContain("Marcus Webb");
  });

  it("does not offer old-cycle work on a new cycle and removes it", () => {
    const view = mount();
    type("Older cycle finding");
    rowsNow = makeRows({ cycleId: "cycle-b", draftMd: "New cycle draft" });
    reenter(view, marcus);
    click("Other review"); click("Back to first");
    expect(offer()).toBeNull();
    expect(textarea().value).toBe("New cycle draft");
    expect(window.sessionStorage.getItem(unsavedReviewKey("marcus-webb", "one", "privacy-hipaa"))).toBeNull();
  });

  it("discards the stored work, focuses the textarea and stays discarded after a remount", () => {
    seed();
    const view = mount();
    click("Discard unsaved work");
    expect(offer()).toBeNull();
    expect(stored()).toBeNull();
    expect(textarea().value).toBe("Existing server draft");
    expect(document.activeElement).toBe(textarea());
    view.unmount();
    mount();
    expect(offer()).toBeNull();
  });

  it("forces re-review of restored work written against another revision", () => {
    seed({ revision: 3 });
    mount();
    click("Restore unsaved work");
    expect(screen.getByText(/This review or its evidence changed/)).toBeTruthy();
    expect(isDisabled("Sign")).toBe(true);
    click("I reviewed the refreshed draft and evidence");
    expect(isDisabled("Sign")).toBe(false);
    mocks.mutate.mockResolvedValue({ status: "signed" });
    click("Sign");
    expect(mocks.mutate).toHaveBeenCalledWith("t1", "cycle", "privacy-hipaa", expect.objectContaining({ kind: "sign", editedDraftMd: "Seeded finding" }));
  });

  it("does not resurrect a recorded return reason after a successful Return", async () => {
    mocks.mutate.mockResolvedValueOnce({ status: "returned" });
    const view = mount();
    click("Return");
    fireEvent.change(screen.getByLabelText("Reason (required)"), { target: { value: "Already recorded reason" } });
    click("Return review");
    await act(async () => {});
    type("More text after the return");
    reenter(view, null);
    reenter(view, { ...marcus, token: "t2" });
    const text = offer()?.textContent ?? "";
    expect(text).toMatch(/assessment edits/);
    expect(text).not.toMatch(/return reason/);
  });

  it("does not repeat the offer after an abstain-only restore and a round trip", () => {
    seed({ text: undefined, abstainReason: "Conflict of interest" });
    mount();
    click("Restore unsaved work");
    click("Other review"); click("Back to first");
    expect(offer()).toBeNull();
  });

  it("stores nothing and keeps the generic toast when nothing was typed", async () => {
    mocks.mutate.mockRejectedValue(new ApiError(401, "expired"));
    const view = mount();
    type("changed"); type("Existing server draft");
    expect(window.sessionStorage.length).toBe(0);
    type("changed"); type("Existing server draft");
    // Sign is blocked on a blank text only; text equals the draft here so it is allowed.
    click("Sign");
    await act(async () => {});
    expect(window.sessionStorage.length).toBe(0);
    expect(mocks.error).toHaveBeenCalledWith(expect.stringMatching(/start the demo again/));
    reenter(view, { ...marcus, token: "t2" });
    expect(offer()).toBeNull();
  });

  it("keeps working and shows the generic toast when storage is blocked", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    mocks.mutate.mockRejectedValue(new ApiError(401, "expired"));
    mount();
    type("Typed with blocked storage");
    expect(textarea().value).toBe("Typed with blocked storage");
    click("Sign");
    await act(async () => {});
    expect(mocks.logout).toHaveBeenCalledOnce();
    expect(mocks.error).toHaveBeenCalledWith(expect.stringMatching(/start the demo again/));
    vi.restoreAllMocks();
  });

  it("clears the stored work after a successful Sign and shows no offer in-session", async () => {
    mocks.mutate.mockResolvedValue({ status: "signed" });
    mount();
    type("Finding to sign");
    expect(stored()?.text).toBe("Finding to sign");
    click("Other review"); click("Back to first");
    expect(offer()).toBeNull();
    click("Sign");
    await act(async () => {});
    expect(stored()).toBeNull();
  });

  it("never reads or writes the store for a public session", () => {
    seed();
    const get = vi.spyOn(Storage.prototype, "getItem");
    const set = vi.spyOn(Storage.prototype, "setItem");
    const del = vi.spyOn(Storage.prototype, "removeItem");
    mount({ ...marcus, role: "public" } as unknown as typeof marcus);
    expect(offer()).toBeNull();
    for (const spy of [get, set, del]) expect(spy.mock.calls.filter(([key]) => String(key).startsWith("jeeves:review-unsaved:"))).toEqual([]);
  });

  it("reads only the active persona's key on a persona switch and leaves the other persona's work alone", () => {
    const view = mount();
    type("Marcus private text");
    const get = vi.spyOn(Storage.prototype, "getItem");
    reenter(view, james);
    expect(offer()).toBeNull();
    const reads = get.mock.calls.map(([key]) => String(key)).filter((key) => key.startsWith("jeeves:review-unsaved:"));
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every((key) => key.includes(":james-liu:"))).toBe(true);
    expect(stored()?.text).toBe("Marcus private text");
  });

  it("reads and writes nothing in production mode", () => {
    modeNow = "production";
    seed();
    const get = vi.spyOn(Storage.prototype, "getItem");
    const set = vi.spyOn(Storage.prototype, "setItem");
    const view = mount();
    expect(offer()).toBeNull();
    type("Typed in production");
    for (const spy of [get, set]) expect(spy.mock.calls.filter(([key]) => String(key).startsWith("jeeves:review-unsaved:"))).toEqual([]);
    view.unmount();
    expect(window.sessionStorage.getItem(unsavedReviewKey("marcus-webb", "one", "privacy-hipaa"))).toContain("Seeded finding");
  });

  it("drops the stored return reason when a Return succeeds after the pane unmounted", async () => {
    let finish!: (value: unknown) => void;
    mocks.mutate.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const view = mount();
    type("Text typed before the return");
    click("Return");
    fireEvent.change(screen.getByLabelText("Reason (required)"), { target: { value: "Recorded after the pane left" } });
    click("Return review");
    expect(stored()?.returnReason).toBe("Recorded after the pane left");
    view.unmount();
    await act(async () => { finish({ status: "returned" }); });
    expect(stored()?.returnReason).toBeUndefined();
    expect(stored()?.text).toBe("Text typed before the return");
    mount();
    const text = offer()?.textContent ?? "";
    expect(text).toMatch(/assessment edits/);
    expect(text).not.toMatch(/return reason/);
  });

  it("keeps a newer stored return reason when an older Return succeeds after unmount", async () => {
    let finish!: (value: unknown) => void;
    mocks.mutate.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const view = mount();
    click("Return");
    fireEvent.change(screen.getByLabelText("Reason (required)"), { target: { value: "First reason" } });
    click("Return review");
    view.unmount();
    seed({ text: undefined, returnReason: "A different, newer reason" });
    await act(async () => { finish({ status: "returned" }); });
    expect(stored()?.returnReason).toBe("A different, newer reason");
  });

  it("clears the stored work when a Sign succeeds after the pane unmounted", async () => {
    let finish!: (value: unknown) => void;
    mocks.mutate.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const view = mount();
    type("Finding signed after unmount");
    click("Sign");
    expect(stored()?.text).toBe("Finding signed after unmount");
    view.unmount();
    await act(async () => { finish({ status: "signed" }); });
    expect(stored()).toBeNull();
  });

  it("records the packet that was current when the work was typed, even when that was none", () => {
    const view = mount();
    type("Typed while no evidence packet existed");
    mocks.packet.id = "p1";
    reenter(view, marcus);
    expect(screen.getByText(/This review or its evidence changed/)).toBeTruthy();
    type("Typed again after the packet appeared");
    expect(stored()?.evidencePacketId).toBeNull();
    reenter(view, null);
    reenter(view, { ...marcus, token: "t2" });
    click("Restore unsaved work");
    expect(screen.getByText(/This review or its evidence changed/)).toBeTruthy();
  });
});
