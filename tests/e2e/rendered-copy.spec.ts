import { test, expect } from "@playwright/test";

/**
 * Rendered-copy guards that a unit test cannot provide.
 *
 * JSX joins a multi-line text node by trimming each line, so a literal space
 * written between an expression and the prose that follows it can be dropped
 * — depending on the transform. The Next.js production build DOES drop it;
 * vitest's transform does NOT. A jsdom component test therefore passes while
 * the deployed page is wrong, which is exactly what happened here:
 * components/jeeves/eval-comparison.tsx rendered "Hallucination ratecompared:"
 * on /promotions while its unit test was green.
 *
 * These assertions run against `next build` (see playwright.config.ts), so
 * they see what a visitor sees. Keep them for any copy that interpolates a
 * value directly into a sentence.
 */
test.describe("rendered copy survives the production JSX transform", () => {
  test("eval comparison keeps the space between metric label and prose", async ({
    page,
  }) => {
    await page.goto("/promotions");

    const panel = page.locator('[data-slot="eval-comparison"]').first();
    await expect(panel).toBeVisible();

    const text = (await panel.textContent()) ?? "";
    expect(text).toContain("Hallucination rate compared:");
    // The exact regression: the label and the next word fused together.
    expect(text).not.toContain("ratecompared");
  });
});
