import { afterEach, describe, expect, it } from "vitest";
import { localPgliteDirectory } from "./client";

const originalDirectory = process.env.JEEVES_PGLITE_DIR;

afterEach(() => {
  if (originalDirectory === undefined) delete process.env.JEEVES_PGLITE_DIR;
  else process.env.JEEVES_PGLITE_DIR = originalDirectory;
});

describe("localPgliteDirectory", () => {
  it("keeps the existing repo-local default", () => {
    delete process.env.JEEVES_PGLITE_DIR;
    expect(localPgliteDirectory()).toBe("./.pglite");
  });

  it("uses an explicit disposable runner directory", () => {
    process.env.JEEVES_PGLITE_DIR = "/tmp/jeeves-playwright-example";
    expect(localPgliteDirectory()).toBe("/tmp/jeeves-playwright-example");
  });

  it("does not accept a blank override", () => {
    process.env.JEEVES_PGLITE_DIR = "   ";
    expect(localPgliteDirectory()).toBe("./.pglite");
  });
});
