import { takeStartLines } from "@/lib/utils/season-start";
import { describe, expect, it } from "vitest";

describe("takeStartLines", () => {
  // A 7 week block from Mon 9 Nov.
  const running = { id: 20, name: "Base block", startDate: "2026-11-09", durationWeeks: 7, durationDays: null, seasonId: null };

  it("names the last week the running block runs, not the week it would enter (round 8)", () => {
    // A season start on Mon 16 Nov: the block runs only its week 1.
    expect(takeStartLines({ seasonId: null, day: "2026-11-16", running, scheduled: null })).toEqual(["This ends Base block at week 1 of 7."]);
    expect(takeStartLines({ seasonId: null, day: "2026-11-18", running, scheduled: null })).toEqual(["This ends Base block at week 2 of 7."]);
  });

  it("says nothing ends when the running block has ended before the start day (round 8)", () => {
    // The block's last day is Sun 27 Dec.
    expect(takeStartLines({ seasonId: null, day: "2026-12-28", running, scheduled: null })).toEqual([]);
    expect(takeStartLines({ seasonId: null, day: "2027-01-04", running, scheduled: null })).toEqual([]);
    expect(takeStartLines({ seasonId: null, day: "2026-12-27", running, scheduled: null })).toEqual(["This ends Base block at week 7 of 7."]);
  });
});
