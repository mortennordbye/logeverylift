import {
  complianceBand,
  complianceRatio,
  consistency,
  countsInWeek,
  inIllness,
  isoWeekday,
  mondayOf,
  RETURN_RULE,
  returnInfo,
  SEE_DOCTOR_RULE,
  suggestMoveDay,
  type ConsistencySession,
  type IllnessPeriod,
} from "@/lib/utils/session-compliance";
import { describe, expect, it } from "vitest";

/** Planned vs done (docs/plans/workouts-and-compliance.md, section 6). 2026-11-09 is a Monday. */

describe("weeks", () => {
  it("finds the Monday and the ISO weekday", () => {
    expect(mondayOf("2026-11-15")).toBe("2026-11-09");
    expect(mondayOf("2026-11-09")).toBe("2026-11-09");
    expect(isoWeekday("2026-11-09")).toBe(1);
    expect(isoWeekday("2026-11-15")).toBe(7);
  });
});

describe("complianceRatio", () => {
  it("uses duration first, then distance", () => {
    expect(complianceRatio({ durationSeconds: 3600, distanceMeters: 10000 }, { durationSeconds: 2700, distanceMeters: 10000 })).toEqual({ ratio: 0.75, by: "duration" });
    expect(complianceRatio({ distanceMeters: 2000 }, { durationSeconds: 2700, distanceMeters: 1800 })).toEqual({ ratio: 0.9, by: "distance" });
    expect(complianceRatio({ durationSeconds: 3600 }, { distanceMeters: 9000 })).toBeNull();
    expect(complianceRatio({}, { durationSeconds: 100 })).toBeNull();
  });
});

describe("complianceBand", () => {
  it.each([
    [0.49, "orange"],
    [0.5, "yellow"],
    [0.79, "yellow"],
    [0.795, "green"],
    [0.8, "green"],
    [1.2, "green"],
    [1.21, "yellow"],
    [1.5, "yellow"],
    [1.51, "orange"],
  ])("%s is %s", (ratio, band) => {
    expect(complianceBand("done", ratio)).toBe(band);
  });

  it("names the other states", () => {
    expect(complianceBand("done", null)).toBe("done");
    expect(complianceBand("missed", null)).toBe("red");
    expect(complianceBand("illness", null)).toBe("illness");
    expect(complianceBand("skipped", null)).toBeNull();
    expect(complianceBand("planned", null)).toBeNull();
  });
});

describe("consistency", () => {
  const today = "2026-11-12"; // Thursday
  const s = (date: string, done: boolean, extra: Partial<ConsistencySession> = {}): ConsistencySession => ({ date, done, skipped: false, statusOn: null, ...extra });

  it("leaves a plan skip out and counts a later skip as a miss", () => {
    expect(countsInWeek(s("2026-11-03", false, { skipped: true, statusOn: "2026-11-01" }), today)).toBe(false);
    expect(countsInWeek(s("2026-11-03", false, { skipped: true, statusOn: "2026-11-03" }), today)).toBe(true);
    expect(countsInWeek(s("2026-11-03", false, { skipped: true }), today)).toBe(true);
  });

  it("counts today and later only when done", () => {
    expect(countsInWeek(s(today, false), today)).toBe(false);
    expect(countsInWeek(s(today, true), today)).toBe(true);
    expect(countsInWeek(s("2026-11-13", false), today)).toBe(false);
  });

  it("calls a week complete at 80%, and leaves empty weeks out", () => {
    const lastWeek = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"];
    const weekBefore = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"];
    const sessions = [
      ...lastWeek.map((d, i) => s(d, i < 4)), // 4 of 5: complete
      ...weekBefore.map((d, i) => s(d, i < 3)), // 3 of 5: not complete
      s("2026-11-10", true),
      s("2026-11-11", false),
      s(today, false),
    ];
    const c = consistency(sessions, today);
    expect(c.weeks).toHaveLength(12);
    expect(c.weeks.at(-1)).toEqual({ start: "2026-11-02", counted: 5, done: 4, complete: true });
    expect(c.weeks.at(-2)).toEqual({ start: "2026-10-26", counted: 5, done: 3, complete: false });
    expect(c.weeks[0].start).toBe("2026-08-17");
    expect(c).toMatchObject({ completeWeeks: 1, countedWeeks: 2, share: 0.5 });
    expect(c.thisWeek).toEqual({ start: "2026-11-09", counted: 2, done: 1 });
  });

  it("ignores sessions older than the window, and has no share with nothing counted", () => {
    const c = consistency([s("2026-01-05", true)], today);
    expect(c.share).toBeNull();
    expect(c.countedWeeks).toBe(0);
  });
});

describe("sick periods", () => {
  const period = (startedOn: string, endedOn: string | null, severity: IllnessPeriod["severity"] = "mild", id = 1): IllnessPeriod => ({ id, startedOn, endedOn, severity });

  it("an open period runs on from its first day", () => {
    expect(inIllness("2026-11-20", [period("2026-11-10", null)])).toBe(true);
    expect(inIllness("2026-11-09", [period("2026-11-10", null)])).toBe(false);
    expect(inIllness("2026-11-12", [period("2026-11-10", "2026-11-11")])).toBe(false);
  });

  it("is sick while a period covers today", () => {
    const r = returnInfo([period("2026-11-10", null)], "2026-11-12", []);
    expect(r).toMatchObject({ phase: "sick", periodId: 1, daysSinceEnd: null, seeDoctor: false });
    expect(r?.rule).toEqual(RETURN_RULE);
    expect(returnInfo([period("2026-11-10", "2026-11-12")], "2026-11-12", [])?.phase).toBe("sick");
  });

  it("is returning from the day after the end until the first done session", () => {
    const p = [period("2026-11-05", "2026-11-08")];
    expect(returnInfo(p, "2026-11-10", [])).toMatchObject({ phase: "returning", daysSinceEnd: 2, sessionsSinceEnd: 0 });
    expect(returnInfo(p, "2026-11-10", ["2026-11-07"])).toMatchObject({ phase: "returning", sessionsSinceEnd: 0 });
    expect(returnInfo(p, "2026-11-10", ["2026-11-09"])).toBeNull();
  });

  it("stops after 7 days in the app; the assistant gets 14 days and sees sessions", () => {
    const p = [period("2026-11-01", "2026-11-03")];
    expect(returnInfo(p, "2026-11-10", [])?.phase).toBe("returning");
    expect(returnInfo(p, "2026-11-11", [])).toBeNull();
    expect(returnInfo(p, "2026-11-17", ["2026-11-05"], { days: 14, untilFirstSession: false })).toMatchObject({ phase: "returning", sessionsSinceEnd: 1 });
    expect(returnInfo(p, "2026-11-18", [], { days: 14, untilFirstSession: false })).toBeNull();
  });

  it("uses the latest ended period", () => {
    const r = returnInfo([period("2026-10-01", "2026-10-03", "mild", 1), period("2026-11-05", "2026-11-08", "moderate", 2)], "2026-11-10", []);
    expect(r).toMatchObject({ periodId: 2, severity: "moderate" });
  });

  it("adds the doctor rule when severe or longer than 7 days", () => {
    expect(returnInfo([period("2026-11-05", "2026-11-08", "severe")], "2026-11-10", [])?.rule).toEqual([...RETURN_RULE, SEE_DOCTOR_RULE]);
    expect(returnInfo([period("2026-11-01", "2026-11-08", null)], "2026-11-10", [])?.seeDoctor).toBe(true);
    expect(returnInfo([period("2026-11-02", "2026-11-08", null)], "2026-11-10", [])?.seeDoctor).toBe(false);
    expect(returnInfo([period("2026-11-01", null, "mild")], "2026-11-12", [])?.seeDoctor).toBe(true);
  });

  it("says nothing with no period", () => {
    expect(returnInfo([], "2026-11-10", [])).toBeNull();
  });
});

describe("suggestMoveDay", () => {
  // Missed key session on Tuesday 2026-11-10; today is Wednesday 2026-11-11.
  const base = { missedDate: "2026-11-10", today: "2026-11-11" };
  const easy = (date: string) => ({ date, keyOrHard: false });
  const hard = (date: string) => ({ date, keyOrHard: true });

  it("picks the earliest free day not next to a hard day", () => {
    expect(suggestMoveDay({ ...base, load: [hard("2026-11-13")] })).toEqual({ date: "2026-11-11" });
    expect(suggestMoveDay({ ...base, load: [hard("2026-11-12")] })).toEqual({ date: "2026-11-14" });
  });

  it("never lands on or next to a key or hard day, done ones included", () => {
    expect(suggestMoveDay({ ...base, load: [hard("2026-11-11"), hard("2026-11-14")] })).toEqual({ date: null, reason: "No free day this week. Skip it and go on." });
  });

  it("prefers a day with no session over one with an easy session", () => {
    expect(suggestMoveDay({ ...base, load: [easy("2026-11-11"), easy("2026-11-12")] })).toEqual({ date: "2026-11-13" });
    const full = ["2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"].map(easy);
    expect(suggestMoveDay({ ...base, load: full })).toEqual({ date: "2026-11-11" });
  });

  it("stays in the missed session's week", () => {
    expect(suggestMoveDay({ missedDate: "2026-11-15", today: "2026-11-16", load: [] }).date).toBeNull();
    expect(suggestMoveDay({ missedDate: "2026-11-09", today: "2026-11-09", load: [] })).toEqual({ date: "2026-11-10" });
  });

  it("keeps to available days and out of sick periods", () => {
    expect(suggestMoveDay({ ...base, load: [], availableDays: [2, 6, 7] })).toEqual({ date: "2026-11-14" });
    expect(suggestMoveDay({ ...base, load: [], illness: [{ startedOn: "2026-11-10", endedOn: "2026-11-13" }] })).toEqual({ date: "2026-11-14" });
    expect(suggestMoveDay({ ...base, load: [], illness: [{ startedOn: "2026-11-10", endedOn: null }] }).date).toBeNull();
  });

  it("treats an empty list of available days as every day", () => {
    expect(suggestMoveDay({ ...base, load: [], availableDays: [] })).toEqual({ date: "2026-11-11" });
  });
});
