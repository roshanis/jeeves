// Browser-tab mirror of a reviewer's unsaved work on one review, so that an
// expired session does not discard a typed assessment. sessionStorage only:
// nothing is sent to the server, every access is guarded (a blocked storage
// must never break the page), and the key carries the persona but no token so
// the same persona can be offered the work back after re-entry.
import type { Domain } from "@/lib/domain/types";

export const REVIEW_TEXT_MAX = 20_000;
export const REASON_MAX = 2_000;
const PREFIX = "jeeves:review-unsaved:v1:";

export interface UnsavedReview {
  v: 1;
  personaKey: string;
  personaLabel: string;
  slug: string;
  domain: Domain;
  /** row.review.cycleId ?? row.review.createdAt: the discriminator draftKey uses. */
  cycleKey: string;
  revision: number | null;
  evidencePacketId: string | null;
  text?: string;
  returnReason?: string;
  abstainReason?: string;
  savedAt: string;
}

export function unsavedReviewKey(personaKey: string, slug: string, domain: Domain): string {
  return `${PREFIX}${encodeURIComponent(personaKey)}:${encodeURIComponent(slug)}:${domain}`;
}

function safeStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function remove(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    /* blocked storage: nothing to clean */
  }
}

function pruneOldest(storage: Storage, keep: string): void {
  try {
    const entries: { key: string; savedAt: string }[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key || !key.startsWith(PREFIX) || key === keep) continue;
      let savedAt = "";
      try {
        const parsed = JSON.parse(storage.getItem(key) ?? "") as { savedAt?: unknown };
        if (typeof parsed.savedAt === "string") savedAt = parsed.savedAt;
      } catch {
        /* unreadable entries sort oldest */
      }
      entries.push({ key, savedAt });
    }
    entries.sort((a, b) => a.savedAt.localeCompare(b.savedAt));
    for (const { key } of entries.slice(0, Math.ceil(entries.length / 2))) storage.removeItem(key);
  } catch {
    /* best effort */
  }
}

function isQuotaError(err: unknown): boolean {
  const e = err as { name?: unknown; code?: unknown } | null;
  return e !== null && typeof e === "object" && (e.name === "QuotaExceededError" || e.code === 22);
}

/** Returns true only when a non-empty entry was stored. An entry with no text
 *  and no reason removes the key instead. */
export function writeUnsavedReview(entry: Omit<UnsavedReview, "v" | "savedAt">): boolean {
  const storage = safeStorage();
  if (!storage) return false;
  const key = unsavedReviewKey(entry.personaKey, entry.slug, entry.domain);
  if (!entry.text && !entry.returnReason && !entry.abstainReason) {
    remove(storage, key);
    return false;
  }
  const body = JSON.stringify({ ...entry, v: 1, savedAt: new Date().toISOString() });
  try {
    storage.setItem(key, body);
    return true;
  } catch (err) {
    if (!isQuotaError(err)) return false;
    pruneOldest(storage, key);
    try {
      storage.setItem(key, body);
      return true;
    } catch {
      return false;
    }
  }
}

export function readUnsavedReview(id: { personaKey: string; slug: string; domain: Domain; cycleKey: string }): UnsavedReview | null {
  const storage = safeStorage();
  if (!storage) return null;
  const key = unsavedReviewKey(id.personaKey, id.slug, id.domain);
  try {
    const raw = storage.getItem(key);
    if (raw === null) return null;
    const entry = JSON.parse(raw) as Partial<UnsavedReview> | null;
    const valid = entry !== null && typeof entry === "object" && entry.v === 1 &&
      entry.personaKey === id.personaKey && entry.slug === id.slug && entry.domain === id.domain &&
      entry.cycleKey === id.cycleKey && typeof entry.personaLabel === "string" &&
      (entry.revision === null || typeof entry.revision === "number") &&
      (entry.evidencePacketId === null || typeof entry.evidencePacketId === "string") &&
      (entry.text === undefined || (typeof entry.text === "string" && entry.text.length <= REVIEW_TEXT_MAX)) &&
      (entry.returnReason === undefined || (typeof entry.returnReason === "string" && entry.returnReason.length <= REASON_MAX)) &&
      (entry.abstainReason === undefined || (typeof entry.abstainReason === "string" && entry.abstainReason.length <= REASON_MAX)) &&
      Boolean(entry.text || entry.returnReason || entry.abstainReason);
    if (!valid) {
      remove(storage, key);
      return null;
    }
    return entry as UnsavedReview;
  } catch {
    remove(storage, key);
    return null;
  }
}

export function clearUnsavedReview(personaKey: string, slug: string, domain: Domain): void {
  const storage = safeStorage();
  if (storage) remove(storage, unsavedReviewKey(personaKey, slug, domain));
}

/** Removes the stored return reason only when it still equals the one that was
 *  just recorded, keeping any text or abstention reason beside it. */
export function dropStoredReturnReason(id: { personaKey: string; slug: string; domain: Domain; cycleKey: string }, reason: string): void {
  const entry = readUnsavedReview(id);
  if (!entry || entry.returnReason !== reason) return;
  writeUnsavedReview({
    personaKey: entry.personaKey, personaLabel: entry.personaLabel, slug: entry.slug, domain: entry.domain, cycleKey: entry.cycleKey,
    revision: entry.revision, evidencePacketId: entry.evidencePacketId, text: entry.text, abstainReason: entry.abstainReason,
  });
}
