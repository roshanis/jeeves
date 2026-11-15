import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { FrameworkMappingTable } from "@/components/jeeves/framework-mapping-table";
import { FRAMEWORK_PAGES } from "@/lib/marketing/framework-mappings";

describe("FrameworkMappingTable ordering", () => {
  afterEach(cleanup);
  it("orders NIST refs numerically: MEASURE 2.7 before 2.10 before 2.11", () => {
    const page = FRAMEWORK_PAGES.find((p) => p.slug === "nist-ai-rmf")!;
    const { container } = render(<FrameworkMappingTable page={page} />);
    const refs = [...container.querySelectorAll("h3 > span")].map((s) => s.textContent);
    const at = (r: string) => refs.indexOf(r);
    expect(at("MEASURE 2.7")).toBeGreaterThanOrEqual(0);
    expect(at("MEASURE 2.7")).toBeLessThan(at("MEASURE 2.10"));
    expect(at("MEASURE 2.10")).toBeLessThan(at("MEASURE 2.11"));
  });
});
