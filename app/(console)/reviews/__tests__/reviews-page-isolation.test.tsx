// @vitest-environment node
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, closeTestDb, type TestDb } from "@/lib/db/test-client";
import { ReviewRequestQueue } from "@/components/jeeves/review-request-queue";
import { CHAMPION_PREFILL_PAYLOAD } from "@/lib/intake/champion-prefill";
import type { Actor } from "@/lib/domain/types";
import type { ReviewNotificationRow } from "@/lib/services/notification-service";

/**
 * Read isolation for the outbound review-request queue on /reviews.
 *
 * Each notification's subject and body embed the initiative's title, and every
 * playground visitor has a workspace of their own. The page used to render the
 * unscoped queue, so any visitor saw the titles of everyone else's initiatives.
 * It must render the viewer's own asks plus the shared examples' and nothing
 * else.
 */
let testDb: TestDb;
vi.mock("@/lib/db/client", () => ({ getDb: () => testDb }));

// The page is behind the viewer gate, which needs a request scope. Stand in for
// the viewer it resolves; everything else in the module stays real.
const viewer = vi.hoisted(() => ({ workspaceId: null as string | null }));
vi.mock("@/app/_lib/data-provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/_lib/data-provider")>()),
  getCurrentWorkspaceId: async () => viewer.workspaceId,
}));

const svc = await import("@/lib/services/initiative-service");
const { default: ReviewsPage } = await import("../page");

const REQUESTER: Actor = { id: "priya-raman", role: "requester" };
const PROGRAM: Actor = { id: "nia-okafor", role: "program" };
const SYSTEM: Actor = { id: "system", role: "system" };

async function triaged(workspaceId: string | null, title: string): Promise<void> {
  const draft = await svc.createDraft(testDb, {
    payload: { ...CHAMPION_PREFILL_PAYLOAD, basics: { ...CHAMPION_PREFILL_PAYLOAD.basics, title } },
    requesterActor: REQUESTER,
    requesterName: "Priya Raman",
    workspaceId,
  });
  await svc.submitIntake(testDb, draft.initiativeId, REQUESTER, workspaceId);
  await svc.startQc(testDb, draft.initiativeId, PROGRAM, workspaceId);
  await svc.triage(testDb, draft.initiativeId, SYSTEM, workspaceId);
}

beforeAll(async () => {
  testDb = await createTestDb();
  await triaged("ws_alpha", "Alpha Ward Copilot");
  await triaged("ws_bravo", "Bravo Ward Copilot");
  await triaged(null, "Shared Example Copilot");
});

afterAll(async () => closeTestDb(testDb));

afterEach(() => {
  vi.unstubAllEnvs();
});

function findQueue(node: ReactNode): ReactElement<{ notifications: ReviewNotificationRow[] }> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findQueue(child);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const element = node as ReactElement<{ notifications: ReviewNotificationRow[]; children?: ReactNode }>;
  if (element.type === ReviewRequestQueue) return element;
  return findQueue(element.props.children);
}

/** What the page hands the queue panel when `workspaceId` is looking. */
async function queueSeenBy(workspaceId: string | null): Promise<string> {
  vi.stubEnv("DATA_PROVIDER", "db");
  viewer.workspaceId = workspaceId;
  const queue = findQueue(await ReviewsPage());
  expect(queue, "the page renders the review-request queue").not.toBeNull();
  return queue!.props.notifications.map((n) => `${n.subject} ${n.body}`).join("\n");
}

describe("/reviews review-request queue", () => {
  it("shows a playground visitor their own initiative and the shared example, not another visitor's", async () => {
    const seen = await queueSeenBy("ws_alpha");
    expect(seen).toContain("Alpha Ward Copilot");
    expect(seen).toContain("Shared Example Copilot");
    expect(seen).not.toContain("Bravo Ward Copilot");
  });

  it("is symmetric: the other visitor sees theirs and not the first's", async () => {
    const seen = await queueSeenBy("ws_bravo");
    expect(seen).toContain("Bravo Ward Copilot");
    expect(seen).not.toContain("Alpha Ward Copilot");
  });

  it("shows a visitor with no workspace only the shared examples", async () => {
    const seen = await queueSeenBy(null);
    expect(seen).toContain("Shared Example Copilot");
    expect(seen).not.toContain("Alpha Ward Copilot");
    expect(seen).not.toContain("Bravo Ward Copilot");
  });
});
