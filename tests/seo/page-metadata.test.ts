// Every page carries its own title and description.
//
// The root layout supplies a default, which is why this was easy to miss:
// nothing LOOKED broken. But a single shared title means every tab, every
// bookmark, every search result and every link preview for 18 different
// pages reads identically — "Jeeves — AI Governance Gateway" whether you are
// on the audit trail or a single initiative.
//
// Written as a sweep over the route tree rather than a list, so a page added
// tomorrow is covered without anyone remembering to add it here.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const APP_DIR = join(process.cwd(), "app");

function pageFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      pageFiles(full, found);
    } else if (entry === "page.tsx") {
      found.push(full);
    }
  }
  return found;
}

const PAGES = pageFiles(APP_DIR).sort();
const rel = (p: string) => p.slice(process.cwd().length + 1);

describe("page metadata", () => {
  it("finds the route tree (guards against this sweep silently matching nothing)", () => {
    expect(PAGES.length).toBeGreaterThan(10);
  });

  it.each(PAGES.map((p) => [rel(p), p]))("%s exports metadata", (_name, path) => {
    const src = readFileSync(path, "utf8");
    const hasMetadata =
      /export const metadata\b/.test(src) || /export async function generateMetadata\b/.test(src);
    expect(hasMetadata).toBe(true);
  });

  it.each(PAGES.map((p) => [rel(p), p]))("%s sets a description", (_name, path) => {
    const src = readFileSync(path, "utf8");
    // generateMetadata pages build theirs dynamically; a literal check would
    // be a false negative, so assert the field is referenced at all.
    expect(/description:/.test(src)).toBe(true);
  });
});

describe("site-wide head", () => {
  it("gives the root layout a title template so per-page titles stay branded", () => {
    const src = readFileSync(join(APP_DIR, "layout.tsx"), "utf8");
    expect(/template:/.test(src)).toBe(true);
  });

  it("declares a metadataBase so Open Graph URLs resolve absolutely", () => {
    const src = readFileSync(join(APP_DIR, "layout.tsx"), "utf8");
    expect(/metadataBase/.test(src)).toBe(true);
  });

  it("has a root not-found page, not just the console one", () => {
    // app/(console)/not-found.tsx only covers routes inside that group. A
    // typo'd marketing URL fell through to Next's unstyled default.
    expect(() => statSync(join(APP_DIR, "not-found.tsx"))).not.toThrow();
  });

  it("ships an Open Graph image", () => {
    expect(() => statSync(join(APP_DIR, "opengraph-image.tsx"))).not.toThrow();
  });

  it("ships an icon set beyond favicon.ico", () => {
    expect(() => statSync(join(APP_DIR, "icon.svg"))).not.toThrow();
    expect(() => statSync(join(APP_DIR, "apple-icon.tsx"))).not.toThrow();
  });

  it("ships a web app manifest", () => {
    expect(() => statSync(join(APP_DIR, "manifest.ts"))).not.toThrow();
  });
});
