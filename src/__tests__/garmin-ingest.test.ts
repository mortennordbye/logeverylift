import { DAY_ENDPOINTS, GARMIN_ENDPOINTS, RANGE_ENDPOINTS, dateOf, isEmptyAnswer } from "@/lib/garmin/endpoints";
import { parseFit } from "@/lib/garmin/fit";
import { readZipEntry } from "@/lib/garmin/zip";
import { chunkRange } from "@/lib/garmin/dates";
import { describe, expect, it } from "vitest";
import { buildFit, buildZip } from "./helpers/garmin-files";

describe("readZipEntry", () => {
  it("returns the .fit entry of a deflated zip", () => {
    const content = Buffer.from("hello fit");
    expect(readZipEntry(buildZip("123_ACTIVITY.fit", content), ".fit")?.toString()).toBe("hello fit");
  });

  it("returns null when no entry has the extension", () => {
    expect(readZipEntry(buildZip("notes.txt", Buffer.from("x")), ".fit")).toBeNull();
  });

  it("refuses something that isn't a zip", () => {
    expect(() => readZipEntry(Buffer.from("not a zip at all, just text"), ".fit")).toThrow(/not a zip/);
  });
});

describe("parseFit", () => {
  const parsed = parseFit(buildFit());

  it("turns records into aligned streams, with seconds from the start", () => {
    expect(parsed.streams.t).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(parsed.streams.hr).toEqual([120, 121, 122, 123, 124, 125, 126, 127, 128, 129]);
    expect(parsed.streams.distance?.[9]).toBe(72);
    expect(parsed.streams.power).toBeUndefined();
  });

  it("converts GPS from semicircles to degrees", () => {
    expect(parsed.streams.lat?.[0]).toBeCloseTo(59.9, 5);
    expect(parsed.streams.lng?.[0]).toBeCloseTo(10.7, 5);
  });

  it("keeps sport, session and strength sets as JSON-safe values", () => {
    expect(parsed.sport).toBe("cycling");
    expect(parsed.subSport).toBe("indoorCycling");
    expect(parsed.startTime).toBe("2026-11-04T06:00:00.000Z");
    expect(parsed.sets).toHaveLength(2);
    expect(parsed.sets[0]).toMatchObject({ repetitions: 5, weight: 100, setType: "active" });
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(parsed);
  });

  it("refuses a file that isn't FIT", () => {
    expect(() => parseFit(Buffer.from("definitely not a fit file"))).toThrow();
  });
});

describe("endpoint registry", () => {
  it("has each kind once, and covers the 22 day, range and snapshot endpoints", () => {
    const kinds = GARMIN_ENDPOINTS.map((e) => e.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(kinds).toHaveLength(22);
  });

  it("keeps every range call within 28 days, inside Garmin's smallest limit", () => {
    expect(RANGE_ENDPOINTS.every((e) => e.maxDays <= 28)).toBe(true);
  });

  it("finds the date under the field names Garmin uses", () => {
    expect(dateOf({ calendarDate: "2026-11-04" })).toBe("2026-11-04");
    expect(dateOf({ summaryDate: "2026-11-04T00:00:00.0" })).toBe("2026-11-04");
    expect(dateOf({ date: "2026-11-04" })).toBe("2026-11-04");
    expect(dateOf({ calendarDate: null })).toBeNull();
  });

  it("splits HRV, daily and stress answers into one row per date and drops rows without one", () => {
    const hrv = RANGE_ENDPOINTS.find((e) => e.kind === "hrv")!;
    expect(hrv.split({ hrvSummaries: [{ calendarDate: "2026-11-03" }, { calendarDate: "2026-11-04" }, {}] }, "2026-11-03", "2026-11-04").map((r) => r.date)).toEqual([
      "2026-11-03",
      "2026-11-04",
    ]);
    const daily = RANGE_ENDPOINTS.find((e) => e.kind === "daily")!;
    expect(daily.split({ data: [{ calendarDate: "2026-11-04", x: 1 }] }, "2026-11-04", "2026-11-04")).toEqual([{ date: "2026-11-04", data: { calendarDate: "2026-11-04", x: 1 } }]);
    const stress = RANGE_ENDPOINTS.find((e) => e.kind === "stress")!;
    expect(stress.split([{ calendarDate: "2026-11-04", values: { overallStressLevel: 27 } }], "2026-11-04", "2026-11-04")).toHaveLength(1);
  });

  it("groups several weight entries on one day into one row", () => {
    const entries = RANGE_ENDPOINTS.find((e) => e.kind === "weight_entries")!;
    const rows = entries.split([{ date: "2026-11-04", w: 1 }, { date: "2026-11-04", w: 2 }, { date: "2026-11-05", w: 3 }], "2026-11-04", "2026-11-05");
    expect(rows).toEqual([
      { date: "2026-11-04", data: { items: [{ date: "2026-11-04", w: 1 }, { date: "2026-11-04", w: 2 }] } },
      { date: "2026-11-05", data: { items: [{ date: "2026-11-05", w: 3 }] } },
    ]);
  });

  it("stores the weight goal only when one is set", () => {
    const goal = RANGE_ENDPOINTS.find((e) => e.kind === "weight_goal")!;
    expect(goal.split({ userGoals: [], userGoalRanges: null }, "2026-11-01", "2026-11-04")).toEqual([]);
    expect(goal.split({ userGoals: [{ goal: 80 }] }, "2026-11-01", "2026-11-04")).toEqual([{ date: "2026-11-04", data: { userGoals: [{ goal: 80 }] } }]);
  });

  it("treats Garmin's empty shells as nothing to store", () => {
    expect(isEmptyAnswer(null)).toBe(true);
    expect(isEmptyAnswer([])).toBe(true);
    expect(isEmptyAnswer({})).toBe(true);
    const food = DAY_ENDPOINTS.find((e) => e.kind === "food")!;
    expect(food.empty?.({ mealDate: "2026-11-04", loggedFoodsWithServingSizes: [] })).toBe(true);
    const hr = DAY_ENDPOINTS.find((e) => e.kind === "heart_rate")!;
    expect(hr.empty?.({ heartRateValues: null })).toBe(true);
    expect(hr.empty?.({ heartRateValues: [[1, 60]] })).toBe(false);
  });
});

describe("chunkRange", () => {
  it("splits a range into pieces of at most the given size", () => {
    expect(chunkRange("2026-10-01", "2026-10-10", 4)).toEqual([
      ["2026-10-01", "2026-10-04"],
      ["2026-10-05", "2026-10-08"],
      ["2026-10-09", "2026-10-10"],
    ]);
    expect(chunkRange("2026-10-01", "2026-10-01", 28)).toEqual([["2026-10-01", "2026-10-01"]]);
  });
});
