import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearUnsavedReview,
  dropStoredReturnReason,
  readUnsavedReview,
  unsavedReviewKey,
  writeUnsavedReview,
  type UnsavedReview,
} from "./review-unsaved-store";

const id = { personaKey: "marcus-webb", slug: "case-one", domain: "privacy-hipaa" as const, cycleKey: "cycle-a" };
const entry: Omit<UnsavedReview, "v" | "savedAt"> = {
  ...id, personaLabel: "Marcus Webb", revision: 4, evidencePacketId: null, text: "My finding",
};
const key = unsavedReviewKey(id.personaKey, id.slug, id.domain);

beforeEach(() => window.sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("review unsaved store", () => {
  it("builds a token-free key from persona, slug and domain", () => {
    expect(key).toBe("jeeves:review-unsaved:v1:marcus-webb:case-one:privacy-hipaa");
  });

  it("round-trips an entry for the same persona, review and cycle", () => {
    expect(writeUnsavedReview(entry)).toBe(true);
    expect(readUnsavedReview(id)).toMatchObject({ v: 1, text: "My finding", revision: 4, personaLabel: "Marcus Webb" });
  });

  it("writes nothing and removes the key when there is no text and no reason", () => {
    writeUnsavedReview(entry);
    expect(writeUnsavedReview({ ...entry, text: undefined, returnReason: "" })).toBe(false);
    expect(window.sessionStorage.length).toBe(0);
  });

  it.each([
    ["a persona mismatch", (e: UnsavedReview) => ({ ...e, personaKey: "james-liu" })],
    ["a version mismatch", (e: UnsavedReview) => ({ ...e, v: 2 })],
    ["a cycle mismatch", (e: UnsavedReview) => ({ ...e, cycleKey: "cycle-b" })],
    ["over-cap text", (e: UnsavedReview) => ({ ...e, text: "x".repeat(20_001) })],
    ["an over-cap reason", (e: UnsavedReview) => ({ ...e, returnReason: "x".repeat(2_001) })],
    ["an empty entry", (e: UnsavedReview) => ({ ...e, text: undefined })],
  ])("rejects and removes %s", (_name, mutate) => {
    writeUnsavedReview(entry);
    const stored = JSON.parse(window.sessionStorage.getItem(key)!) as UnsavedReview;
    window.sessionStorage.setItem(key, JSON.stringify(mutate(stored)));
    expect(readUnsavedReview(id)).toBeNull();
    expect(window.sessionStorage.getItem(key)).toBeNull();
  });

  it("rejects and removes invalid JSON", () => {
    window.sessionStorage.setItem(key, "{not json");
    expect(readUnsavedReview(id)).toBeNull();
    expect(window.sessionStorage.getItem(key)).toBeNull();
  });

  it("never throws when the storage methods throw", () => {
    for (const method of ["getItem", "setItem", "removeItem"] as const) {
      vi.spyOn(Storage.prototype, method).mockImplementation(() => { throw new Error("blocked"); });
    }
    expect(writeUnsavedReview(entry)).toBe(false);
    expect(readUnsavedReview(id)).toBeNull();
    expect(() => clearUnsavedReview(id.personaKey, id.slug, id.domain)).not.toThrow();
  });

  it("never throws when reading window.sessionStorage itself throws", () => {
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => { throw new DOMException("denied", "SecurityError"); });
    expect(writeUnsavedReview(entry)).toBe(false);
    expect(readUnsavedReview(id)).toBeNull();
    expect(() => clearUnsavedReview(id.personaKey, id.slug, id.domain)).not.toThrow();
  });

  it("prunes the oldest entries and retries once on QuotaExceededError", () => {
    const old = unsavedReviewKey("old-persona", "old", "legal");
    window.sessionStorage.setItem(old, JSON.stringify({ v: 1, savedAt: "2020-01-01T00:00:00.000Z", text: "old" }));
    const real = Storage.prototype.setItem;
    let first = true;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
      if (first) { first = false; throw new DOMException("full", "QuotaExceededError"); }
      return real.call(this, k, v);
    });
    expect(writeUnsavedReview(entry)).toBe(true);
    expect(window.sessionStorage.getItem(old)).toBeNull();
    expect(readUnsavedReview(id)?.text).toBe("My finding");
  });

  it("drops a stored return reason only when it equals the recorded one, keeping the rest", () => {
    writeUnsavedReview({ ...entry, returnReason: "Recorded reason" });
    dropStoredReturnReason(id, "Another reason");
    expect(readUnsavedReview(id)?.returnReason).toBe("Recorded reason");
    dropStoredReturnReason(id, "Recorded reason");
    expect(readUnsavedReview(id)).toMatchObject({ text: "My finding" });
    expect(readUnsavedReview(id)?.returnReason).toBeUndefined();
    writeUnsavedReview({ ...entry, text: undefined, returnReason: "Only reason" });
    dropStoredReturnReason(id, "Only reason");
    expect(window.sessionStorage.getItem(key)).toBeNull();
  });
});
