import { test, expect } from "@playwright/test";

// plan.md §8 test 12 — Playwright golden path (required, AGENTS.md hard rule
// 8): a read-only champion storyline covering the home pipeline board, an
// initiative detail page's Intake/Operate tabs, the audit query console, and
// the control catalog. This suite is read-only end to end — it never
// submits, signs, approves, or mutates anything (AGENTS.md hard rule 2: the
// public/demo surfaces this test drives are read-only for every role).
test.describe("champion storyline: read-only golden path", () => {
  test("landing page renders the hero and the exact demo banner", async ({
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

    // Landing hero + primary CTA into the console.
    await expect(
      page.getByRole("heading", { name: /every AI project/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Enter the console/i }),
    ).toBeVisible();
  });

  test("dashboard shows the 12 seeded initiatives", async ({ page }) => {
    await page.goto("/dashboard");

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

// Live demo loop (task: wire live mode into the UI) — the full mutation
// storyline through the real /api/** routes: requester creates + submits
// the champion intake, runs triage (Critical, 8 domains), fans a 4-domain
// draft run out to the mock agent adapter and watches rows flip to
// Drafted; a reviewer signs Privacy/HIPAA; the approver conditionally
// approves with one condition; the Audit tab shows the decision event.
//
// Requires DEMO_PASSCODE in the RUNNER environment (the webServer's own
// env sets it for the server side — see playwright.config.ts). Without it
// this describe self-skips and the read-only suite above is unaffected:
//   DEMO_PASSCODE=e2e-test-pass npm run test:e2e
test.describe("live demo loop: create → triage → draft run → sign → decide", () => {
  test.skip(!process.env.DEMO_PASSCODE, "requires DEMO_PASSCODE in the runner env");

  /** Log in through the demo-mode chip dialog as the given persona. */
  async function loginAs(page: import("@playwright/test").Page, personaKey: string) {
    await page.locator('[data-slot="demo-mode-chip"]').click();
    await page.locator('[data-slot="passcode-input"]').fill(process.env.DEMO_PASSCODE!);
    await page.locator('[data-slot="persona-select"]').selectOption(personaKey);
    await page.locator('[data-slot="live-login-submit"]').click();
    await expect(page.getByText("Live demo (session workspace)")).toBeVisible();
  }

  async function resetToReadOnly(page: import("@playwright/test").Page) {
    await page.locator('[data-slot="live-reset"]').click();
    await expect(page.getByText("Read-only (public)")).toBeVisible();
  }

  test("full live loop across requester, reviewer, and approver personas", async ({
    page,
  }) => {
    // Generous budget: this single test walks the whole governance loop
    // including a polled draft run.
    test.setTimeout(180_000);

    // --- Requester: live session + champion intake -----------------------
    await page.goto("/initiatives/new");
    await loginAs(page, "priya-raman");

    await page.locator('[data-slot="load-champion"]').click();

    // Live tier preview: rule 1 -> Critical, all 8 domains.
    const preview = page.locator('[data-slot="tier-preview"]');
    await expect(preview).toContainText("Critical");
    await expect(preview).toContainText("8 required domains");

    // Completeness meter: RFT-02 retention gap flagged, submit not blocked.
    const meter = page.locator('[data-slot="completeness-meter"]');
    await expect(meter).toContainText("RFT-02");
    await expect(meter).toContainText("Submission is not blocked");

    // Submit: create -> submit -> redirect to the new initiative's page
    // (slug gets a random suffix; assert on the prefix).
    await page.locator('[data-slot="submit-intake"]').click();
    await expect(page).toHaveURL(/\/initiatives\/prior-auth-clinical-summarizer-/, {
      timeout: 30_000,
    });
    await expect(
      page.getByRole("heading", { name: "Prior-Auth Clinical Summarizer" }),
    ).toBeVisible();

    // --- Triage: Critical, 8 required domains, review branch -------------
    await page.locator('[data-slot="run-triage"]').click();
    const triageResult = page.locator('[data-slot="triage-result"]');
    await expect(triageResult).toBeVisible({ timeout: 30_000 });
    await expect(triageResult).toContainText("Critical");
    await expect(triageResult).toContainText("8 required domains");
    await expect(triageResult).toContainText("Review");

    // --- Draft run: 4 of 8 domains (incl. privacy-hipaa) -----------------
    await page.getByRole("tab", { name: "Reviews" }).click();
    const draftPanel = page.locator('[data-slot="draft-run-panel"]');
    await expect(draftPanel).toBeVisible({ timeout: 30_000 });

    // All pending domains start checked; uncheck 4 so exactly
    // security, privacy-hipaa, clinical-safety, data-governance run.
    for (const domain of ["legal", "procurement", "tech-architecture", "responsible-ai"]) {
      await draftPanel
        .locator(`[data-slot="draft-domain-checkbox"][data-domain="${domain}"]`)
        .uncheck();
    }
    await expect(draftPanel.locator('[data-slot="start-draft-run"]')).toContainText(
      "4 domains",
    );
    await draftPanel.locator('[data-slot="start-draft-run"]').click();

    // Rows flip to Drafted as the 1.5s poll reports progress (mock agent
    // adapter drafts deterministically; allow several poll cycles).
    await expect(async () => {
      const drafted = await page
        .locator('[data-slot="review-row"] [data-slot="review-status"][data-status="drafted"]')
        .count();
      expect(drafted).toBeGreaterThanOrEqual(4);
    }).toPass({ timeout: 60_000 });

    // --- Reviewer: sign privacy-hipaa ------------------------------------
    await resetToReadOnly(page);
    await loginAs(page, "elena-vasquez");

    const phiRow = page.locator('[data-slot="review-row"][data-domain="privacy-hipaa"]');
    await expect(phiRow.getByRole("button", { name: "Sign" })).toBeEnabled({
      timeout: 15_000,
    });
    await phiRow.getByRole("button", { name: "Sign" }).click();
    await expect(
      phiRow.locator('[data-slot="review-status"][data-status="signed"]'),
    ).toBeVisible({ timeout: 30_000 });

    // --- Approver: conditionally approve with one condition --------------
    await resetToReadOnly(page);
    await loginAs(page, "angela-torres");

    await page.locator('[data-slot="record-decision"]').click();
    await page.locator('[data-slot="decide-select"]').selectOption("conditionally_approved");
    await page.locator('[data-slot="add-condition"]').click();
    await page
      .locator('[data-slot="condition-text"]')
      .fill("Human-review sampling at 100% during the pilot period");
    await page.locator('[data-slot="condition-control-id"]').fill("C-01");
    await page.locator('[data-slot="decide-confirm"]').click();

    // Dialog closes; the server-rendered lifecycle badge flips after the
    // refresh.
    await expect(page.locator('[data-slot="decide-dialog"]')).toHaveCount(0, {
      timeout: 30_000,
    });

    // --- Audit tab shows the decision event ------------------------------
    await page.getByRole("tab", { name: "Audit" }).click();
    const auditTab = page.locator('[data-slot="audit-tab"]');
    await expect(auditTab).toBeVisible({ timeout: 30_000 });
    await expect(auditTab).toContainText("conditionally_approved by angela-torres", {
      timeout: 30_000,
    });
    await expect(auditTab).toContainText("1 condition(s)");
  });
});
