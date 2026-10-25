import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Drizzle's migrator skips any migration whose journal timestamp is not newer
 * than the last one a database has applied. A migration generated out of order
 * therefore runs on fresh databases (CI, tests) and silently never on
 * production. That is how 0022 (workout_reactions) went missing in prod.
 */
describe("drizzle journal", () => {
  const journal = JSON.parse(
    readFileSync(path.resolve(__dirname, "../../drizzle/meta/_journal.json"), "utf8"),
  ) as { entries: { idx: number; tag: string; when: number }[] };

  // 0022 shipped out of order; 0067 recreates its table where it was skipped.
  // Do not add to this list: regenerate the migration instead.
  const KNOWN_OUT_OF_ORDER = ["0022_furry_nemesis"];

  it("gives every migration a newer timestamp than the one before", () => {
    const outOfOrder = journal.entries
      .filter((e, i) => i > 0 && e.when <= journal.entries[i - 1].when)
      .map((e) => e.tag);
    expect(outOfOrder).toEqual(KNOWN_OUT_OF_ORDER);
  });
});
