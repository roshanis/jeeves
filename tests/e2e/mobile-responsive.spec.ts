import { test, expect } from "@playwright/test";

/**
 * iPhone / iPad readiness guards (mobile pass 2026-08-04).
 *
 * These lock in the four failure modes found when the console was first
 * measured on Apple viewports. Each assertion exists because something
 * actually broke, not as a style preference:
 *
 *  1. HORIZONTAL OVERFLOW — every console route overflowed an iPhone SE by
 *     29px and an iPhone 15 by 11px (18 of 60 device x route combinations).
 *     The top bar's status cluster plus the search field could not compress
 *     below 404px.
 *  2. iOS FOCUS ZOOM — 66 form controls computed a 14px font. Safari zooms
 *     the viewport on focus for anything under 16px, with no way back but a
 *     manual pinch.
 *  3. TOUCH TARGETS — 43 distinct control shapes were under Apple's 44pt
 *     minimum, down to 16px table sort buttons.
 *  4. COLLAPSED / OVERLAPPING CHROME — on iPad portrait the search input
 *     flex-shrank to ~0 while its absolutely positioned icon and kbd hint
 *     stayed put and overlapped the breadcrumb. Note this produced NO
 *     overflow, so check 1 cannot catch it; it needs its own assertion.
 *
 * Touch targets are verified by HIT-TESTING rather than by measuring boxes:
 * dense controls legitimately stay small and expand their tappable area with
 * a transparent ::after overlay (`.touch-target` in globals.css), which never
 * appears in a bounding rect. The honest question is "if a finger lands here,
 * does this control receive the tap?".
 */

const IPHONE_SE = { width: 375, height: 667 };
const IPHONE_15 = { width: 393, height: 852 };
const IPAD_PORTRAIT = { width: 834, height: 1194 };

// Read-only routes only: these render from the frozen mock snapshot (see
// playwright.config.ts), so they do not care whether the live-loop spec has
// already created its extra initiative.
const ROUTES = ["/inbox", "/portfolio", "/controls", "/monitoring"] as const;

/** Document-level horizontal overflow, in CSS pixels. */
async function horizontalOverflow(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const d = document.documentElement;
    return d.scrollWidth - d.clientWidth;
  });
}

for (const [label, viewport] of [
  ["iPhone SE", IPHONE_SE],
  ["iPhone 15", IPHONE_15],
  ["iPad portrait", IPAD_PORTRAIT],
] as const) {
  test.describe(`${label} (${viewport.width}x${viewport.height})`, () => {
    // NOTE: context options only — spreading devices["Desktop Chrome"] here
    // would drag in the worker-scoped defaultBrowserType, which Playwright
    // rejects inside a describe. The project config already applies the
    // Desktop Chrome descriptor.
    test.use({ viewport, isMobile: true, hasTouch: true });

    test(`no horizontal overflow on any console route`, async ({ page }) => {
      for (const route of ROUTES) {
        await page.goto(route);
        await page.waitForLoadState("networkidle");
        expect(await horizontalOverflow(page), `${route} overflows horizontally`).toBeLessThanOrEqual(0);
      }
    });

    test(`form controls never trigger iOS focus zoom`, async ({ page }) => {
      // Guard the guard: if the pointer is not emulated as coarse, the CSS
      // under test is not active and a pass here would be meaningless.
      await page.goto("/controls");
      expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);

      for (const route of ROUTES) {
        await page.goto(route);
        await page.waitForLoadState("networkidle");
        const tooSmall = await page.evaluate(() =>
          Array.from(document.querySelectorAll("input:not([type=hidden]), select, textarea"))
            .filter((el) => el.getAttribute("aria-hidden") !== "true")
            .map((el) => ({
              tag: el.tagName.toLowerCase(),
              size: parseFloat(getComputedStyle(el).fontSize),
            }))
            .filter((c) => c.size < 16),
        );
        expect(tooSmall, `${route} has controls under 16px`).toEqual([]);
      }
    });

    test(`interactive controls are reachable by a fingertip`, async ({ page }) => {
      for (const route of ROUTES) {
        await page.goto(route);
        await page.waitForLoadState("networkidle");

        const undersized = await page.evaluate(() => {
          const REQUIRED = 44;
          const SELECTOR =
            'a[href], button, [role="button"], input:not([type="hidden"]), select, textarea, [role="tab"]';
          const failures: string[] = [];

          for (const el of Array.from(document.querySelectorAll(SELECTOR))) {
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;

            const style = getComputedStyle(el);
            if (style.display === "none" || style.visibility === "hidden") continue;
            // Visually-hidden helpers (the skip link) are not pointer targets.
            if (el.closest(".sr-only") || (rect.width <= 2 && rect.height <= 2)) continue;
            // Disabled controls are inert by design: read-only mode renders
            // every mutation control visibly disabled inside a tooltip span
            // that is itself the focusable element.
            if ((el as HTMLButtonElement).disabled) continue;
            if (el.getAttribute("aria-disabled") === "true") continue;
            if (style.pointerEvents === "none") continue;
            // Links flowing inline within prose are exempt.
            if (
              el.tagName === "A" &&
              style.display.startsWith("inline") &&
              !el.className.toString().includes("flex")
            ) {
              continue;
            }

            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            const dx = Math.max(rect.width, REQUIRED) / 2 - 1;
            const dy = Math.max(rect.height, REQUIRED) / 2 - 1;

            // The probeable region is the viewport intersected with every
            // overflow-clipping ancestor's box: a control half-scrolled out
            // of a scroll pane (a wide table's trailing sort header, the
            // last item of the mobile nav strip) is reachable by scrolling
            // the pane, exactly like content below the viewport fold — its
            // clipped-away pixels cannot be probed and are not occlusions.
            // The 1px inset matters at the extremes: elementFromPoint
            // returns null on the last device pixel of the viewport.
            let clipL = 0;
            let clipT = 0;
            let clipR = innerWidth;
            let clipB = innerHeight;
            for (let p = el.parentElement; p; p = p.parentElement) {
              const pcs = getComputedStyle(p);
              if (/(auto|scroll|hidden|clip)/.test(pcs.overflowX + pcs.overflowY)) {
                const pr = p.getBoundingClientRect();
                clipL = Math.max(clipL, pr.left);
                clipT = Math.max(clipT, pr.top);
                clipR = Math.min(clipR, pr.right);
                clipB = Math.min(clipB, pr.bottom);
              }
            }

            let reachable = 0;
            const probes: [number, number][] = [
              [cx, cy - dy],
              [cx, cy + dy],
              [cx - dx, cy],
              [cx + dx, cy],
            ];
            for (const [px, py] of probes) {
              if (px < clipL + 1 || py < clipT + 1 || px > clipR - 1 || py > clipB - 1) {
                reachable++;
                continue;
              }
              const hit = document.elementFromPoint(px, py);
              // Only the control itself or its own descendants count. An
              // ancestor row receiving the tap is not this control being
              // reachable.
              if (hit && (hit === el || el.contains(hit))) reachable++;
            }

            if (reachable < probes.length) {
              const name = (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40);
              failures.push(
                `<${el.tagName.toLowerCase()}> "${name}" ${Math.round(rect.width)}x${Math.round(rect.height)} reachable ${reachable}/4`,
              );
            }
          }
          return failures;
        });

        expect(undersized, `${route} has controls a fingertip cannot hit`).toEqual([]);
      }
    });

    test(`top-bar chrome neither collapses nor overlaps`, async ({ page }) => {
      for (const route of ROUTES) {
        await page.goto(route);
        await page.waitForLoadState("networkidle");

        const problems = await page.evaluate(() => {
          const found: string[] = [];

          // A visible control squashed under 24px wide is collapsing.
          for (const el of Array.from(document.querySelectorAll("header input, header button, header a"))) {
            const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            if (cs.display === "none" || cs.visibility === "hidden") continue;
            if (el.closest(".sr-only")) continue;
            // Base UI form components mirror their value into a deliberately
            // 1x1 clip-path-hidden native input for form participation
            // (aria-hidden, tabindex=-1). That is not user chrome collapsing
            // — same exemption the focus-zoom check above applies.
            if (el.getAttribute("aria-hidden") === "true") continue;
            if (r.height > 0 && r.width > 0 && r.width < 24) {
              found.push(`collapsed <${el.tagName.toLowerCase()}> w=${r.width.toFixed(1)}`);
            }
          }

          // Top-bar landmarks must not intersect one another.
          const header = document.querySelector("header");
          const marks = Array.from(
            header?.querySelectorAll(
              "[data-slot=breadcrumb], [data-slot=mobile-brand], label, [data-slot=demo-mode-chip]",
            ) ?? [],
          );
          for (let i = 0; i < marks.length; i++) {
            for (let j = i + 1; j < marks.length; j++) {
              const a = marks[i]!.getBoundingClientRect();
              const b = marks[j]!.getBoundingClientRect();
              if (a.width === 0 || b.width === 0) continue;
              const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
              const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
              if (ox > 1 && oy > 1) {
                found.push(
                  `overlap ${marks[i]!.getAttribute("data-slot") ?? marks[i]!.tagName} / ${marks[j]!.getAttribute("data-slot") ?? marks[j]!.tagName} by ${Math.round(ox)}px`,
                );
              }
            }
          }
          return found;
        });

        expect(problems, `${route} top bar`).toEqual([]);
      }
    });
  });
}

test.describe("iPhone landscape dialogs", () => {
  // 393px tall: a centred dialog with no height cap overflowed equally off
  // the top and bottom here, hiding its own submit button with no way to
  // scroll to it.
  test.use({ viewport: { width: 852, height: 393 }, isMobile: true, hasTouch: true });

  test("a dialog fits the viewport and its submit stays reachable", async ({ page }) => {
    await page.goto("/inbox");
    await page.waitForLoadState("networkidle");
    await page.locator('[data-slot="demo-mode-chip"]').first().click();

    const dialog = page.locator('[data-slot="dialog-content"]');
    await expect(dialog).toBeVisible();

    const fits = await dialog.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, viewport: window.innerHeight };
    });
    expect(fits.top, "dialog runs off the top").toBeGreaterThanOrEqual(-1);
    expect(fits.bottom, "dialog runs off the bottom").toBeLessThanOrEqual(fits.viewport + 1);

    // The passcode field must not trigger Safari's focus zoom either.
    const fontSize = await page
      .locator('[data-slot="passcode-input"]')
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(fontSize).toBeGreaterThanOrEqual(16);

    await expect(page.locator('[data-slot="live-login-submit"]')).toBeInViewport();
  });
});
