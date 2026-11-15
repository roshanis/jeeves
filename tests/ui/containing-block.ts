/**
 * Whether a visually hidden (`sr-only`, position: absolute) element is
 * positioned against something inside `scroller`.
 *
 * An absolutely positioned element is clipped by an overflow container only
 * when that container is, or contains, its containing block: the nearest
 * positioned ancestor. When nothing between the element and the scroll region
 * is positioned, the containing block is outside the region, so text in a
 * column scrolled out of view escapes the clipping and widens the page
 * (measured at 135 to 153 px on a phone, tests/e2e/mobile-responsive.spec.ts).
 *
 * jsdom has no layout and does not load the stylesheet, so this reads the
 * Tailwind position classes rather than computed styles.
 */
export function positionedInside(el: Element, scroller: Element): boolean {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (["relative", "absolute", "fixed", "sticky"].some((c) => p!.classList.contains(c))) {
      return scroller.contains(p);
    }
    if (p === scroller) return false;
  }
  return false;
}
