import { withPlannedStarts } from "@/lib/utils/calendar-cycles";
import { describe, expect, it } from "vitest";

/**
 * The calendar places a cycle by its start date. A draft that is scheduled,
 * or is a later phase of a season, gets the day it will start, so the plan
 * ahead shows before it runs.
 */

const cycle = (id: number, status: "draft" | "active" | "completed", startDate: string | null, scheduledStartDate: string | null = null) => ({
  id,
  status,
  startDate,
  scheduledStartDate,
});

describe("withPlannedStarts", () => {
  it("gives a scheduled draft its scheduled day", () => {
    expect(withPlannedStarts([cycle(1, "draft", null, "2026-11-16")], new Map())[0].startDate).toBe("2026-11-16");
  });

  it("gives a later season phase its start from the season timeline", () => {
    expect(withPlannedStarts([cycle(2, "draft", null)], new Map([[2, "2027-01-11"]]))[0].startDate).toBe("2027-01-11");
  });

  it("prefers the scheduled day over the timeline", () => {
    expect(withPlannedStarts([cycle(3, "draft", null, "2026-11-20")], new Map([[3, "2026-11-16"]]))[0].startDate).toBe("2026-11-20");
  });

  it("leaves a draft with no planned start, and started cycles, as they are", () => {
    const cycles = [cycle(4, "draft", null), cycle(5, "active", "2026-11-02"), cycle(6, "completed", "2026-09-14")];
    expect(withPlannedStarts(cycles, new Map([[5, "2030-01-01"], [6, "2030-01-01"]])).map((c) => c.startDate)).toEqual([null, "2026-11-02", "2026-09-14"]);
  });
});
