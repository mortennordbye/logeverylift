import { dropsScheduledLine, endsRunningLine } from "@/lib/utils/cycle-start";
import { describe, expect, it } from "vitest";

const peak = { id: 7, name: "Strength peak", day: "2026-11-23", season: null };
const phase = { id: 8, name: "Build", day: "2026-11-16", season: { id: 4, name: "Jevnaker Half 2027" } };

describe("dropsScheduledLine", () => {
  it("names another standalone draft and the day it no longer starts", () => {
    expect(dropsScheduledLine(1, peak)).toBe("Strength peak no longer starts Mon 23 Nov.");
  });

  it("names the season that pauses when its next phase loses the start", () => {
    expect(dropsScheduledLine(1, phase)).toBe("Jevnaker Half 2027 pauses. Its next phase no longer starts Mon 16 Nov. You can resume it from the season.");
  });

  it("is null for no scheduled start, for the cycle itself, and for a start in the same season", () => {
    expect(dropsScheduledLine(1, null)).toBeNull();
    expect(dropsScheduledLine(7, peak)).toBeNull();
    expect(dropsScheduledLine(1, phase, 4)).toBeNull();
  });

  it("a new cycle with no id yet still names what it drops", () => {
    expect(dropsScheduledLine(null, peak)).toBe("Strength peak no longer starts Mon 23 Nov.");
  });

  it("has no colon and no em dash", () => {
    for (const s of [peak, phase]) expect(dropsScheduledLine(1, s)).not.toMatch(/[:—]/);
  });
});

describe("endsRunningLine", () => {
  it("names the running cycle and its week", () => {
    expect(endsRunningLine(1, { id: 2, name: "Upper / Lower", week: 3, totalWeeks: 6 })).toBe("This ends Upper / Lower at week 3 of 6.");
  });
});
