import { test, expect } from "@playwright/test";
import { ADDITIONAL_ANSWERS, EXPANDED_INTAKE } from "../fixtures/expanded-intake";

// plan.md §8 test 12 — Playwright golden path (required, AGENTS.md hard rule
// 8): a read-only champion storyline covering the public landing page, the
// home pipeline board, an initiative detail page's Intake/Evals tabs, the
// audit query console, and the control catalog. This suite is read-only end
// to end — it never submits, signs, approves, or mutates anything
// (AGENTS.md hard rule 2: the public/demo surfaces this test drives are
// read-only for every role).
test.describe("champion storyline: read-only golden path", () => {
  test("landing page shows the hero and routes into the console", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: /every ai initiative/i }),
    ).toBeVisible();

    // Exact required banner string (lib/demo-banner.ts DEMO_BANNER_TEXT /
    // ui-spec §7-8.1) — the landing page renders the same disclaimer strip
    // as the console's app-topbar.
    await expect(
      page.getByText(
        "Fictional demo — synthetic data. Meridian Health is a fictional payer; not affiliated with any real organization.",
        { exact: true },
      ),
    ).toBeVisible();

    await page.getByRole("button", { name: "Try the demo" }).first().click();
    await expect(page).toHaveURL(/\/initiatives\/new$/);
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "Demo persona" })).toHaveValue("priya-raman");
    await page.goto("/inbox");
    await expect(
      page.getByRole("heading", { name: /what needs attention/i }),
    ).toBeVisible();
  });

  // Ops Inbox moved from "/" to "/inbox" (the public landing page now owns
  // "/" — see the test above), wrapped by the console chrome in
  // app/(console)/layout.tsx.
  test("inbox renders the operations dashboard and the exact demo banner", async ({
    page,
  }) => {
    await page.goto("/inbox");

    // Exact required banner string (app-topbar DEMO_BANNER_TEXT / ui-spec §7-8.1).
    await expect(
      page.getByText(
        "Fictional demo — synthetic data. Meridian Health is a fictional payer; not affiliated with any real organization.",
        { exact: true },
      ),
    ).toBeVisible();

    // Operations console inbox — attention heading + a needs-attention table.
    await expect(
      page.getByRole("heading", { name: /what needs attention/i }),
    ).toBeVisible();
    await expect(page.locator('[data-slot="initiative-table"]').first()).toBeVisible();
  });

  test("portfolio lists all 12 seeded initiatives", async ({ page }) => {
    await page.goto("/portfolio");

    // "All" saved view shows every seeded initiative as a table row.
    const table = page.locator('[data-slot="initiative-table"]');
    await expect(table).toBeVisible();
    await expect(table.locator('[data-slot="initiative-row"]')).toHaveCount(12);
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

  test("member-chat-copilot Evals tab shows the Synthetic data — demo label", async ({
    page,
  }) => {
    await page.goto("/initiatives/member-chat-copilot");

    await page.getByRole("tab", { name: "Evals" }).click();
    const evalsTab = page.locator('[data-slot="evals-tab"]');
    await expect(evalsTab).toBeVisible();
    await expect(
      evalsTab.getByText("Synthetic data — demo").first(),
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

  test("agent catalog confirms the deterministic offline runtime", async ({ page }) => {
    await page.goto("/agents");
    await expect(page.locator('[data-slot="agent-runtime-status"]')).toContainText(
      "Runtime: Deterministic mock adapter",
    );
  });

  test("case-file tabs preserve URL state across keyboard, reload, Back, and Forward", async ({
    page,
  }) => {
    await page.goto("/initiatives/member-chat-copilot?tab=intake");
    const intake = page.getByRole("tab", { name: "Intake" });
    const reviews = page.getByRole("tab", { name: "Reviews" });

    await expect(intake).toHaveAttribute("aria-selected", "true");
    await reviews.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\?tab=reviews$/);
    await expect(reviews).toHaveAttribute("aria-selected", "true");

    await page.reload();
    await expect(page).toHaveURL(/\?tab=reviews$/);
    await expect(reviews).toHaveAttribute("aria-selected", "true");
    await page.goBack();
    await expect(page).toHaveURL(/\?tab=intake$/);
    await expect(intake).toHaveAttribute("aria-selected", "true");
    await page.goForward();
    await expect(page).toHaveURL(/\?tab=reviews$/);
    await expect(reviews).toHaveAttribute("aria-selected", "true");
  });

  test("narrow console header remains visible without horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/inbox");
    await expect(page.locator("header")).toBeVisible();
    await expect(page.locator('[data-slot="demo-mode-chip"]')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  // Monetization M1 (marketing pages): read-only, no forms/mutations —
  // covers the NIST AI RMF crosswalk (heading + a real catalog control chip)
  // and the pilot one-pager (heading + "Contact for pricing" since no
  // NEXT_PUBLIC_PILOT_PRICE is set in the test env).
  test("framework and pilot pages render", async ({ page }) => {
    await page.goto("/frameworks/nist-ai-rmf");
    await expect(
      page.getByRole("heading", {
        name: "Jeeves and the NIST AI Risk Management Framework",
      }),
    ).toBeVisible();
    await expect(page.getByText("C-01").first()).toBeVisible();

    await page.goto("/pilot");
    await expect(
      page.getByRole("heading", { name: "Procurement-readiness pilot" }),
    ).toBeVisible();
    await expect(page.getByText("Contact for pricing")).toBeVisible();
  });
});

// Live demo loop (task: wire live mode into the UI) — the full mutation
// storyline through the real /api/** routes: requester creates + submits
// the champion intake, runs triage (Critical, 8 domains), fans ALL 8
// domains out to the mock agent adapter in one draft run and watches rows
// flip to Drafted; a reviewer signs Privacy/HIPAA; the approver
// conditionally approves with one condition; the Audit tab shows the
// decision event. (8-domain honesty: every required domain is drafted
// live, not 4-live-plus-4-seeded.)
//
// Passwordless visitor entry is mandatory and never self-skips.
test.describe("live demo loop: create → triage → draft run → sign → decide", () => {
  /** Enter directly, then explore roles without leaving the workspace. */
  async function loginAs(page: import("@playwright/test").Page, personaKey: string) {
    if (await page.getByRole("button", { name: "Start demo", exact: true }).isVisible()) {
      await page.getByRole("button", { name: "Start demo", exact: true }).click();
      await expect(page.getByRole("button", { name: "Exit demo" })).toBeVisible();
    }
    const picker = page.getByRole("combobox", { name: "Demo persona" });
    if (await picker.inputValue() !== personaKey) await picker.selectOption(personaKey);
    await expect(picker).toHaveValue(personaKey);
    await expect(picker).toBeEnabled();
    await expect(page.getByText("Live demo (session workspace)")).toBeVisible();
  }

  test("additional intake answers survive reopening, editing, and submission", async ({ page }) => {
    test.setTimeout(60_000);
    // This is a separate client journey. Keep its requests (and retries) out
    // of the existing full-loop test's shared, persistent rate-limit bucket.
    const clientHeaders = { "x-forwarded-for": `192.0.2.${10 + test.info().retry}` };
    await page.context().setExtraHTTPHeaders(clientHeaders);
    const errors: { phase: string; message: string }[] = [];
    let phase = "new intake";
    page.on("pageerror", (error) => errors.push({ phase, message: error.message }));
    await page.goto("/initiatives/new");
    const sessionResponse = page.waitForResponse((response) => response.url().endsWith("/api/session") && response.request().method() === "POST");
    await loginAs(page, "priya-raman");
    const { token } = await (await sessionResponse).json();
    const created = await page.request.post("/api/initiatives", {
      headers: { ...clientHeaders, authorization: `Bearer ${token}` },
      data: { payload: { ...EXPANDED_INTAKE, basics: { ...EXPANDED_INTAKE.basics, title: "Optional intake review example" } }, requestId: "e2e-optional-intake-questions" },
    });
    expect(created.ok()).toBe(true);
    const { slug } = await created.json();
    phase = "reopen draft";
    await page.goto(`/initiatives/${slug}/edit`);
    for (const [question, answer] of ADDITIONAL_ANSWERS) {
      await expect(page.getByRole("textbox", { name: question, exact: true })).toHaveValue(answer);
    }
    await page.getByRole("textbox", { name: ADDITIONAL_ANSWERS[0][0], exact: true })
      .locator('xpath=ancestor::*[@data-slot="card"][1]')
      .screenshot({ path: test.info().outputPath("intake-use-case-desktop.png") });
    await page.getByRole("textbox", { name: ADDITIONAL_ANSWERS[2][0], exact: true })
      .locator('xpath=ancestor::*[@data-slot="card"][1]')
      .screenshot({ path: test.info().outputPath("intake-data-desktop.png") });
    await page.setViewportSize({ width: 393, height: 852 });
    const fallback = page.getByRole("textbox", { name: ADDITIONAL_ANSWERS[7][0], exact: true });
    await fallback.scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath("intake-mobile.png") });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const revisedFallback = "The on-call team pauses generation and restores the manual queue.";
    await fallback.fill(revisedFallback);
    phase = "submit draft";
    await page.locator('[data-slot="submit-intake"]').click();
    await expect(page).toHaveURL(new RegExp(`/initiatives/${slug}$`));
    phase = "open intake tab";
    await page.getByRole("tab", { name: "Intake", exact: true }).click();
    await expect(page).toHaveURL(/\?tab=intake$/);
    await expect(page.getByRole("tabpanel", { name: "Intake", exact: true })).toBeVisible();
    phase = "reload submitted intake";
    await page.reload();
    for (const [question, answer] of ADDITIONAL_ANSWERS) {
      const row = page.locator('[data-slot="intake-tab"]').getByRole("row").filter({ hasText: question });
      await expect(row).toContainText(question === ADDITIONAL_ANSWERS[7][0] ? revisedFallback : answer);
    }
    // Authenticated detail-page hydration also emits #418 on unchanged main,
    // including Overview without ever opening Intake. Keep that existing issue
    // visible in the report while failing new errors and checking every answer.
    const baselineHydrationWarnings = errors.filter(
      (error) => error.phase === "reload submitted intake" && error.message.startsWith("Minified React error #418;"),
    );
    expect(baselineHydrationWarnings.length).toBeLessThanOrEqual(1);
    if (baselineHydrationWarnings.length > 0) {
      test.info().annotations.push({ type: "known-baseline-issue", description: "React #418 on authenticated detail reload also reproduces on unchanged main." });
      await test.info().attach("baseline-detail-hydration-warning", {
        body: JSON.stringify(baselineHydrationWarnings, null, 2),
        contentType: "application/json",
      });
    }
    expect(errors.filter((error) => !baselineHydrationWarnings.includes(error))).toEqual([]);
  });

  test("full live loop across requester, reviewer, and approver personas", async ({
    page,
  }) => {
    // Generous budget: this single test walks the whole governance loop
    // including a full eight-domain draft run.
    test.setTimeout(180_000);

    // --- Requester: live session + champion intake -----------------------
    await page.goto("/initiatives/new");
    await loginAs(page, "priya-raman");

    await page.locator('[data-slot="load-champion"]').click();

    for (const [question, answer] of ADDITIONAL_ANSWERS) {
      await page.getByRole("textbox", { name: question, exact: true }).fill(answer);
    }

    // Exercise the real mocked chat route and the shared payload handoff.
    // The structured champion answers must survive a Chat round-trip and
    // return to the form unchanged when the assistant marks intake done.
    await page.getByRole("tab", { name: "Chat with intake assistant" }).click();
    const chat = page.locator('[data-slot="intake-chat"]');
    await chat.locator('[data-slot="intake-chat-input"]').fill("Review the current answers.");
    await chat.locator('[data-slot="intake-chat-submit"]').click();
    await expect(chat.locator('[data-slot="intake-chat-done"]')).toBeVisible({
      timeout: 30_000,
    });
    await chat.getByRole("button", { name: "Review and submit" }).click();
    await expect(page.getByRole("tab", { name: "Structured form" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("textbox", { name: "Initiative title" })).toHaveValue(
      "Prior-Auth Clinical Summarizer",
    );
    for (const [question, answer] of ADDITIONAL_ANSWERS) {
      await expect(page.getByRole("textbox", { name: question, exact: true })).toHaveValue(answer);
    }

    // Live tier preview: rule 1 -> Critical, all 8 domains.
    const preview = page.locator('[data-slot="tier-preview"]');
    await expect(preview).toContainText("Critical");
    await expect(preview).toContainText("8 required domains");

    // Completeness meter: RFT-02 retention gap flagged, submit not blocked.
    const meter = page
      .locator('[data-slot="intake-form"]')
      .locator('[data-slot="completeness-meter"]');
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
    await page.getByRole("tab", { name: "Intake", exact: true }).click();
    for (const [question, answer] of ADDITIONAL_ANSWERS) {
      const row = page.locator('[data-slot="intake-tab"]').getByRole("row").filter({ hasText: question });
      await expect(row).toContainText(answer);
    }
    await page.locator('[data-slot="run-triage"]').click();
    const triageResult = page.locator('[data-slot="triage-result"]');
    await expect(triageResult).toBeVisible({ timeout: 30_000 });
    await expect(triageResult).toContainText("Critical");
    await expect(triageResult).toContainText("8 required domains");
    await expect(triageResult).toContainText("Review");

    // --- Draft run: ALL 8 domains live -----------------------------------
    await page.getByRole("tab", { name: "Reviews" }).click();
    const draftPanel = page.locator('[data-slot="draft-run-panel"]');
    await expect(draftPanel).toBeVisible({ timeout: 30_000 });

    // All 8 pending domains start checked — leave them all checked so the
    // whole Critical review set is agent-drafted live in one run (bounded
    // concurrency handles the fan-out). No 4-live-plus-4-seeded split.
    await expect(draftPanel.locator('[data-slot="start-draft-run"]')).toContainText(
      "8 domains",
    );
    // A packaging/configuration failure must give the presenter a concrete
    // recovery action, leave the domains selected and allow a clean retry.
    await page.route("**/api/initiatives/*/draft-run", route => route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Agent runtime could not initialize.", code: "AGENT_INITIALIZATION_FAILED" }),
    }), { times: 1 });
    await draftPanel.locator('[data-slot="start-draft-run"]').click();
    await expect(page.getByText("Agents could not start. Test the connection on the Agents page, then retry.")).toBeVisible();
    await expect(draftPanel.locator('[data-slot="start-draft-run"]')).toBeEnabled();
    const draftResponsePromise = page.waitForResponse(response => response.url().includes('/draft-run') && response.request().method() === 'POST');
    await draftPanel.locator('[data-slot="start-draft-run"]').click();
    const draftResponse = await draftResponsePromise;
    const draftBody = await draftResponse.text();
    expect(draftResponse.status(), draftBody).toBe(200);

    // The synchronous run returns after the deterministic mock adapter has
    // drafted every selected domain; the refreshed rows must show all 8.
    await expect(async () => {
      const drafted = await page
        .locator('[data-slot="review-row"] [data-slot="review-status"][data-status="drafted"]')
        .count();
      expect(drafted).toBeGreaterThanOrEqual(8);
    }).toPass({ timeout: 90_000 });

    // --- Reviewer: sign privacy-hipaa ------------------------------------
    // Sign as the Privacy/HIPAA reviewer (Marcus Webb) — reviewer-domain
    // assignment (M2.5 inc.3) only lets a reviewer sign their own domain, so
    // Elena Vasquez (Clinical Safety) could not sign this row.
    await loginAs(page, "marcus-webb");

    const phiRow = page.locator('[data-slot="review-row"][data-domain="privacy-hipaa"]');
    const clinicalRow = page.locator('[data-slot="review-row"][data-domain="clinical-safety"]');
    await expect(phiRow.getByRole("button", { name: "Sign" })).toBeEnabled({
      timeout: 15_000,
    });
    await expect(clinicalRow.getByRole("button", { name: "Sign" })).toBeDisabled({
      timeout: 15_000,
    });
    await phiRow.getByRole("button", { name: "Sign" }).click();
    await expect(
      phiRow.locator('[data-slot="review-status"][data-status="signed"]'),
    ).toBeVisible({ timeout: 30_000 });

    // --- Approver: conditionally approve with one condition --------------
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

    // --- Deployments + Controls: the live decision generates them too ----
    // (external-review finding #4: "the live champion workflow stops
    // before control generation" — decide() now creates the placeholder
    // deployment and its effective controls in the SAME transaction as the
    // decision, not just the lifecycle-state flip asserted above).
    await page.getByRole("tab", { name: "Deployments" }).click();
    const deploymentsTab = page.locator('[data-slot="deployments-tab"]');
    await expect(deploymentsTab).toBeVisible({ timeout: 30_000 });
    await expect(deploymentsTab).toContainText("v1.0");
    await expect(deploymentsTab).toContainText("Awaiting promotion sign-off");

    await page.getByRole("tab", { name: "Controls" }).click();
    const controlsTab = page.locator('[data-slot="controls-tab"]');
    await expect(controlsTab).toBeVisible({ timeout: 30_000 });
    await expect(controlsTab.locator("tbody tr").first()).toBeVisible();
  });
});

// A real browser -> authenticated API -> private DB document loop; no LLM calls.
test('requester evidence: upload, return, revision, acceptance and download history', async ({page}) => {
  test.setTimeout(120_000);
  await page.setExtraHTTPHeaders({'x-forwarded-for':'evidence-browser-test'});
  async function login(persona: string) {
    const start = page.getByRole("button", { name: "Start demo", exact: true });
    if (await start.isVisible()) {
      await start.click();
      await expect(page.getByRole("button", { name: "Exit demo" })).toBeVisible();
    }
    const picker = page.getByRole("combobox", { name: "Demo persona" });
    if (await picker.inputValue() !== persona) await picker.selectOption(persona);
    await expect(picker).toHaveValue(persona);
    await expect(picker).toBeEnabled();
  }
  async function switchPersona(persona: string) { await login(persona); }
  await page.goto('/initiatives/new');await login('priya-raman');
  await page.locator('[data-slot="load-champion"]').click();
  await page.getByRole('textbox',{name:'Initiative title'}).fill('Evidence browser journey');
  await page.locator('[data-slot="submit-intake"]').click();
  await expect(page).toHaveURL(/\/initiatives\/evidence-browser-journey-/,{timeout:30000});
  const caseUrl = page.url();
  await page.locator('[data-slot="run-triage"]').click();
  await expect(page.locator('[data-slot="triage-result"]')).toBeVisible({timeout:30000});
  await page.getByRole('tab',{name:'Evidence',exact:true}).click();
  const panel=page.locator('[data-slot="evidence-tab"]');
  const pdf=Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n');
  async function upload(name:string) {
    await panel.getByLabel('Choose document',{exact:true}).setInputFiles({name,mimeType:'application/pdf',buffer:pdf});
    await panel.getByRole('checkbox',{name:/This document is fictional/}).check();
    await panel.getByRole('button',{name:'Upload document',exact:true}).click();
    await expect(panel.getByRole('status')).toContainText('Document saved privately');
  }
  await upload('retention-v1.pdf');
  const requirement=panel.getByRole('article',{name:/^H-01 /});
  await requirement.getByRole('combobox',{name:'Document for H-01',exact:true}).selectOption({label:'retention-v1.pdf · v1'});
  await requirement.getByLabel('Relevant pages for H-01 (optional)').fill('1–2');
  await requirement.getByLabel('What this demonstrates for H-01').fill('Fictional retention policy for review.');
  await panel.getByRole('button',{name:'Save evidence draft',exact:true}).click();
  await expect(panel.getByRole('status')).toContainText('Draft saved');
  await page.reload();
  await expect(requirement.getByLabel('What this demonstrates for H-01')).toHaveValue('Fictional retention policy for review.');
  await panel.getByRole('button',{name:'Submit evidence for review',exact:true}).click();
  await expect(panel.getByRole('status')).toContainText('Evidence submitted');
  await switchPersona('marcus-webb');
  await requirement.getByLabel('Reviewer reason for H-01').fill('Specify the retention duration.');
  await requirement.getByRole('button',{name:'Request changes',exact:true}).click();
  await expect(requirement).toContainText('Changes requested');
  await switchPersona('priya-raman');
  await panel.getByLabel('Document version',{exact:true}).selectOption({label:'New version of retention-v1.pdf (v1)'});
  await upload('retention-v2.pdf');
  await requirement.getByLabel('What this demonstrates for H-01').fill('Retention duration is 30 days for this fictional example.');
  await panel.getByRole('button',{name:'Submit revised evidence',exact:true}).click();
  await expect(panel.getByRole('status')).toContainText('Evidence submitted');
  await switchPersona('marcus-webb');
  const reviewErrors: string[] = [];
  const recordReviewError = (error: Error) => reviewErrors.push(error.message);
  page.on('pageerror', recordReviewError);
  await page.locator('aside').getByRole('link', {name:'Reviews', exact:true}).click();
  await expect(page).toHaveURL(/\/reviews$/);
  await page.getByRole('button', {name:'Open Privacy/HIPAA review for Evidence browser journey', exact:true}).click();
  const workbench = page.locator('[data-slot="evidence-review-workspace"]');
  const selectedSource = workbench.getByRole('region', {name:'Selected evidence source'});
  await expect(selectedSource.getByRole('heading', {name:'retention-v2.pdf', exact:true})).toBeVisible();
  await expect(selectedSource).toContainText('Retention duration is 30 days for this fictional example.');
  await expect(selectedSource).toContainText('1–2');
  await workbench.getByRole('button', {name:'Run agent to draft', exact:true}).click();
  await expect(workbench.getByLabel('Assessment text')).toBeEnabled({timeout:30_000});
  await workbench.getByLabel('Assessment text').fill('Human finding based on the submitted retention policy.');
  await workbench.getByRole('button', {name:/Arize evaluations/}).click();
  await expect(selectedSource.getByRole('heading', {name:'Evaluation evidence is not connected'})).toBeVisible();
  await expect(workbench.getByLabel('Assessment text')).toHaveValue('Human finding based on the submitted retention policy.');
  await workbench.getByRole('button', {name:/W&B training provenance/}).click();
  await expect(selectedSource.getByRole('heading', {name:'Training provenance is not connected'})).toBeVisible();
  await workbench.getByRole('button', {name:/H-01 ·/}).click();
  await selectedSource.getByLabel('Evidence assessment reason').fill('The duration and scope are documented.');
  await selectedSource.getByRole('button', {name:'Accept evidence', exact:true}).click();
  await expect(selectedSource.getByRole('region', {name:'Recorded evidence assessment'})).toContainText('Reviewer accepted');
  // H-02 is still missing: accepting this document never signs the domain.
  await expect(workbench.getByRole('button', {name:'Sign', exact:true})).toBeDisabled();
  const submittedDownload = page.waitForEvent('download');
  await selectedSource.getByRole('button', {name:'Download submitted document', exact:true}).click();
  expect((await submittedDownload).suggestedFilename()).toBe('retention-v2.pdf');
  await page.setViewportSize({width:1600, height:1100});
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({path:'test-results/review-evidence-desktop.png', fullPage:true});
  await page.setViewportSize({width:390, height:844});
  await expect(workbench.getByRole('heading', {name:'Your assessment', exact:true})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({path:'test-results/review-evidence-mobile.png', fullPage:true});
  page.off('pageerror', recordReviewError);
  expect(reviewErrors).toEqual([]);
  await page.goto(`${caseUrl}?tab=evidence`);
  await expect(requirement).toContainText('Reviewer accepted');
  await panel.getByText('Document library and version history (2)',{exact:true}).click();
  const downloaded=page.waitForEvent('download');
  await panel.getByRole('button',{name:'Download retention-v1.pdf v1',exact:true}).click();
  expect((await downloaded).suggestedFilename()).toBe('retention-v1.pdf');
  await panel.getByText('Submission history (2)',{exact:true}).click();
  await expect(panel).toContainText('Specify the retention duration.');
  await page.setViewportSize({width:390,height:844});
  await expect(panel.getByRole('heading',{name:'Evidence',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
  await page.screenshot({path:'test-results/evidence-mobile.png',fullPage:true});
});
