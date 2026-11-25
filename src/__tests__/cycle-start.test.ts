import { dropsScheduledLine, endsRunningLine, runningOn, startDayProblem } from "@/lib/utils/cycle-start";
import { afterAll, describe, expect, it, vi } from "vitest";

// The fixed 2026 dates here read without a year only while the clock is in
// 2026 (yearSuffix in src/lib/utils/date-label.ts). Pinned at load, before any
// fixture below is built.
vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(new Date("2026-11-25T12:00:00Z"));
afterAll(() => vi.useRealTimers());

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

describe("runningOn", () => {
  const running = { id: 2, name: "Upper / Lower hypertrophy", week: 3, totalWeeks: 6, startDate: "2026-10-31", durationDays: null };

  it("gives the last week the running cycle runs: the week of the day before the start day (round 8)", () => {
    // Started Sat 31 Oct: Fri 13 Nov is its last day in week 2; Sat 14 Nov would begin week 3.
    expect(runningOn(running, "2026-11-14")?.week).toBe(2);
    expect(runningOn(running, "2026-11-15")?.week).toBe(3);
    expect(runningOn(running, "2026-12-07")?.week).toBe(6);
    // A start on its own first day ends it in week 1.
    expect(runningOn(running, "2026-10-31")?.week).toBe(1);
  });

  it("is null from the first day after the running cycle", () => {
    expect(runningOn(running, "2026-12-12")).toBeNull();
    expect(runningOn(null, "2026-11-14")).toBeNull();
  });
});

describe("startDayProblem", () => {
  it("allows today up to 120 days ahead", () => {
    expect(startDayProblem("2026-11-14", "2026-11-14")).toBeNull();
    expect(startDayProblem("2027-03-14", "2026-11-14")).toBeNull();
    expect(startDayProblem("2026-11-13", "2026-11-14")).toBe("past");
    expect(startDayProblem("2027-03-15", "2026-11-14")).toBe("too_far");
  });
});
