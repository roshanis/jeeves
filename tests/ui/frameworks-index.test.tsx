import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import FrameworksIndex from "@/app/(marketing)/frameworks/page";
import { FRAMEWORK_PAGES } from "@/lib/marketing/framework-mappings";

afterEach(cleanup);

describe("frameworks index", () => {
  it("renders each card's explicit summary, not a prose split at 'Art.'", () => {
    const { container } = render(<FrameworksIndex />);
    for (const page of FRAMEWORK_PAGES) {
      expect(container.textContent).toContain(page.summary);
    }
    expect(container.textContent).not.toMatch(/\(Art\.(?!\s*\d)/);
  });
});
