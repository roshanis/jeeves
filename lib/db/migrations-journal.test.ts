import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Entry = { idx: number; when: number; tag: string };
const journal = JSON.parse(readFileSync("./drizzle/meta/_journal.json", "utf8")) as { entries: Entry[] };

describe("drizzle migration journal invariants", () => {
  it("has contiguous idx values starting at 0", () => {
    expect(journal.entries.map((e) => e.idx)).toEqual(journal.entries.map((_, i) => i));
  });

  // drizzle skips any entry whose `when` is not greater than the newest applied one.
  it("has strictly increasing, unique `when` values", () => {
    journal.entries.forEach((entry, i) => {
      if (i > 0) expect(entry.when, entry.tag).toBeGreaterThan(journal.entries[i - 1]!.when);
    });
  });

  it("has one .sql file per entry and no unlisted .sql file", () => {
    const files = readdirSync("./drizzle").filter((f) => f.endsWith(".sql")).sort();
    expect(files).toEqual(journal.entries.map((e) => `${e.tag}.sql`).sort());
  });
});
