import { test, expect, type Locator, type Page } from "@playwright/test";

/**
 * A disabled action explains itself, and the explanation stays on screen.
 *
 * A mutating control the visitor may not use renders aria-disabled with its
 * reason in a tooltip ("Start the demo to try this action"). The press that
 * asks about the action used to close that tooltip: a click hid the reason
 * that hover had shown, Enter hid the reason that focus had shown, and a
 * second tap hid the reason that the first tap had opened.
 * components/jeeves/role-gate.tsx now pins a reason that a tap, a click or
 * a key asked for until the visitor dismisses it: the press itself no longer
 * closes it (the tap, click and key tests fail without that), and it stays
 * when the mouse leaves (the click test fails without that).
 *
 * The component test in jsdom reproduces only the mouse-leave half: there a
 * press on the button does not close the tooltip, with or without the fix.
 * These run in a real browser, and like the rest of the suite in Chromium
 * only. Safari does not focus a button that is clicked: the last test takes
 * that default away from Chromium, for the one line that exists for Safari.
 *
 * Presses go to coordinates or to the keyboard, not through locator.click()
 * or locator.tap(): Playwright waits for an element to be enabled before it
 * acts, and aria-disabled is not.
 */

const REASON = "Start the demo to try this action";

// A press that closes the reason does so at once: looking again a second later is the test.
const SETTLE_MS = 1_000;

/** The reason tooltip. /admin without a session has one disabled action, so never more than one. */
const reasonOf = (page: Page) => page.locator('[data-slot="tooltip-content"]');

/** Plain text on the page: a press here is a press elsewhere, and it navigates nowhere. */
const elsewhere = (page: Page) => page.getByRole("heading", { name: "Admin console" });

/** Open /admin with no session and return its disabled "Run monitor" action. */
async function disabledAction(page: Page) {
  await page.goto("/admin");
  const action = page.locator('[data-slot="run-monitor"]').first();
  await expect(action).toHaveAttribute("aria-disabled", "true");
  return action;
}

/** The centre of the action, measured now and clear of the page's fixed bars. */
async function centreOf(action: Locator) {
  await action.evaluate((el) => el.scrollIntoView({ block: "center" }));
  const box = await action.boundingBox();
  if (!box) throw new Error("the Run monitor action has no box");
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  // Guard the guard: a press on something that covers the action would prove nothing.
  const onTop = await action.evaluate((el, at) => el.contains(document.elementFromPoint(at.x, at.y)), centre);
  expect(onTop, "the action is the top element at its centre").toBe(true);
  return centre;
}

/**
 * goto() returns before React has hydrated the page, and a hover that arrives
 * before then is lost for good (seen with the CPU slowed twenty times). The
 * gesture that first shows the reason is therefore repeated until it works.
 * That a first press shows the reason at all is pinned by the component test:
 * here it would only show as this helper timing out.
 */
async function showReason(page: Page, gesture: () => Promise<void>) {
  await expect(async () => {
    await gesture();
    await expect(reasonOf(page)).toHaveText(REASON, { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
}

/** Move the mouse off the action and onto it. */
const hoverOnto = (page: Page, action: Locator) => async () => {
  await elsewhere(page).hover();
  await action.hover();
};

test.describe("a disabled action on a touch screen", () => {
  test.use({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });

  test("a tap shows the reason and keeps it until a tap elsewhere", async ({ page }) => {
    const action = await disabledAction(page);
    const tapAction = async () => {
      const { x, y } = await centreOf(action);
      await page.touchscreen.tap(x, y);
    };

    await showReason(page, tapAction);
    await page.waitForTimeout(SETTLE_MS);
    await expect(reasonOf(page)).toBeVisible();

    // A second tap on the action is not a dismissal.
    await tapAction();
    await page.waitForTimeout(SETTLE_MS);
    await expect(reasonOf(page)).toBeVisible();

    await elsewhere(page).tap();
    await expect(reasonOf(page)).toBeHidden();
  });
});

test.describe("a disabled action with a mouse and a keyboard", () => {
  test("a click keeps the reason that hovering showed", async ({ page }) => {
    const action = await disabledAction(page);
    await showReason(page, hoverOnto(page, action));

    // A click where the mouse already is.
    await page.mouse.down();
    await page.mouse.up();
    await elsewhere(page).hover();
    await page.waitForTimeout(SETTLE_MS);
    await expect(reasonOf(page)).toBeVisible();

    await elsewhere(page).click();
    await expect(reasonOf(page)).toBeHidden();

    // The pin went with the dismissal: hover alone behaves as before.
    await action.hover();
    await expect(reasonOf(page)).toBeVisible();
    await elsewhere(page).hover();
    await expect(reasonOf(page)).toBeHidden();
  });

  test("hovering without a click still hides the reason when the mouse leaves", async ({ page }) => {
    const action = await disabledAction(page);
    await showReason(page, hoverOnto(page, action));

    await elsewhere(page).hover();
    await expect(reasonOf(page)).toBeHidden();
  });

  test("Enter keeps the reason that focus showed, Escape dismisses it, Space asks again, Tab moves on", async ({ page }) => {
    const action = await disabledAction(page);
    await showReason(page, async () => {
      await action.blur();
      await action.focus();
    });

    await page.keyboard.press("Enter");
    await page.waitForTimeout(SETTLE_MS);
    await expect(reasonOf(page)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(reasonOf(page)).toBeHidden();

    // Focus is still on the action: Space asks again, and the answer stays.
    await page.keyboard.press("Space");
    await expect(reasonOf(page)).toBeVisible();
    await page.waitForTimeout(SETTLE_MS);
    await expect(reasonOf(page)).toBeVisible();

    // Focus leaving the action dismisses. The next tab stop is not another disabled action.
    await page.keyboard.press("Tab");
    await expect(action).not.toBeFocused();
    await expect(reasonOf(page)).toBeHidden();
  });

  test("Tab dismisses a clicked reason where a click does not focus the button", async ({ page }) => {
    // Safari does not focus a button that is clicked. With no focus on the action, Tab has nothing
    // to take focus from and the reason would stay. Cancelling the default of mousedown keeps
    // Chromium from focusing the button too. It simulates that one difference, not Safari.
    await page.addInitScript(() => {
      window.addEventListener("mousedown", (event) => event.preventDefault(), true);
    });
    const action = await disabledAction(page);
    await showReason(page, hoverOnto(page, action));

    await page.mouse.down();
    await page.mouse.up();
    await elsewhere(page).hover();
    await page.waitForTimeout(SETTLE_MS);
    await expect(reasonOf(page)).toBeVisible();

    await page.keyboard.press("Tab");
    await expect(reasonOf(page)).toBeHidden();
  });
});
