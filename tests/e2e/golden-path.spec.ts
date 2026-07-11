import { test, expect } from "@playwright/test";

// plan.md §8 test 12 — Playwright golden path (required, AGENTS.md hard rule
// 8): a read-only champion storyline covering the home pipeline board, an
// initiative detail page's Intake/Operate tabs, the audit query console, and
// the control catalog. This suite is read-only end to end — it never
// submits, signs, approves, or mutates anything (AGENTS.md hard rule 2: the
// public/demo surfaces this test drives are read-only for every role).
test.describe("champion storyline: read-only golden path", () => {
  test("home shows the 12 seeded initiatives and the exact demo banner", async ({
    page,
  }) => {
    await page.goto("/");

    // Exact required banner string (chrome.tsx DEMO_BANNER_TEXT / ui-spec §7-8.1).
    await expect(
      page.getByText(
        "Fictional demo — synthetic data. Meridian Health is a fictional payer; not affiliated with any real organization.",
        { exact: true },
      ),
    ).toBeVisible();

    // Pipeline board renders all 12 seeded initiatives as cards.
    const board = page.locator('[data-slot="pipeline-board"]');
    await expect(board).toBeVisible();
    await expect(
      board.locator('[data-slot="pipeline-card"]'),
    ).toHaveCount(12);
  });

  test("prior-auth-summarizer shows the Critical tier badge and the Intake completeness gap", async ({
    page,
  }) => {
    await page.goto("/initiatives/prior-auth-summarizer");

    // Critical tier badge in the initiative's own page header (next to the
    // title/lifecycle badge) — scoped past the site nav <header> and the
    // Overview tab's own TierBadge via the heading-adjacent test id.
    await expect(
      page.getByRole("heading", { name: "Prior-Auth Clinical Summarizer" }),
    ).toBeVisible();
    const pageHeader = page.locator("h1", {
      hasText: "Prior-Auth Clinical Summarizer",
    }).locator("..");
    await expect(
      pageHeader.locator('[data-slot="tier-badge"]'),
    ).toHaveText("Critical");

    // Intake tab (default query param) — completeness gap on
    // data.retentionIntent per the champion's still-draft intake.
    await page.getByRole("tab", { name: "Intake" }).click();
    const intakeTab = page.locator('[data-slot="intake-tab"]');
    await expect(intakeTab).toBeVisible();
    await expect(intakeTab).toContainText(
      "Completeness check: missing data.retentionIntent",
    );
  });

  test("member-chat-copilot Operate tab shows the Synthetic data — demo label", async ({
    page,
  }) => {
    await page.goto("/initiatives/member-chat-copilot");

    await page.getByRole("tab", { name: "Operate" }).click();
    const operateTab = page.locator('[data-slot="operate-tab"]');
    await expect(operateTab).toBeVisible();
    await expect(
      operateTab.getByText("Synthetic data — demo").first(),
    ).toBeVisible();
  });

  test("audit console: member-facing-phi canned query returns exactly 4 rows", async ({
    page,
  }) => {
    await page.goto("/audit");

    await page
      .getByRole("button", { name: "Member-facing initiatives touching PHI" })
      .click();

    const rows = page.locator('[data-slot="audit-result-row"]');
    await expect(rows).toHaveCount(4);
  });

  test("controls catalog page reports 17 controls", async ({ page }) => {
    await page.goto("/controls");

    await expect(page.getByText(/17 controls/)).toBeVisible();
  });
});
