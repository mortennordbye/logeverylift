import { bars, ringDash, slotLine, sparkline } from "@/lib/home/charts";
import { daysUntil, loadSummary, streakWeeks, weekCounts, weightSummary } from "@/lib/home/widget-data";
import { describe, expect, it } from "vitest";

/** The home widgets' SVG geometry and data shaping (src/lib/home/charts.ts, widget-data.ts). */

describe("ringDash", () => {
  it("leaves the undrawn part as the dash offset", () => {
    const { r, c, offset } = ringDash(68, 8, 0.5);
    expect(r).toBe(30);
    expect(c).toBeCloseTo(2 * Math.PI * 30);
    expect(offset).toBeCloseTo(c / 2);
  });

  it("clamps below 0, above 1 and NaN", () => {
    expect(ringDash(62, 7, 1.7).offset).toBe(0);
    const { c } = ringDash(62, 7, -1);
    expect(ringDash(62, 7, -1).offset).toBe(c);
    expect(ringDash(62, 7, Number.NaN).offset).toBe(c);
  });
});

describe("sparkline", () => {
  it("spans the box, top for the highest value, bottom for the lowest", () => {
    const s = sparkline([80, 82, 81], 46)!;
    expect(s.line).toBe("M0 43 L50 3 L100 23");
    expect(s.area).toBe("M0 43 L50 3 L100 23 L100 46 L0 46 Z");
    expect(s.endPct).toBeCloseTo(50, 0);
  });

  it("a flat series sits in the middle; fewer than two values draw nothing", () => {
    expect(sparkline([82, 82], 40)!.line).toBe("M0 20 L100 20");
    expect(sparkline([82], 40)).toBeNull();
    expect(sparkline([], 40)).toBeNull();
  });
});

describe("bars and slotLine", () => {
  it("one slot per value, zero values get no bar, heights scale to max", () => {
    const b = bars([50, 0, 100, 200], 100, 100);
    expect(b.map((x) => x.i)).toEqual([0, 2, 3]);
    expect(b[0]).toEqual({ x: 5, y: 50, w: 15, height: 50, i: 0 });
    expect(b[2].height).toBe(100);
  });

  it("the line runs through the middle of each slot", () => {
    expect(slotLine([0, 50], 100, 100)).toBe("M25 100 L75 50");
  });
});

describe("daysUntil", () => {
  it("counts whole days in the user's calendar, across a DST change", () => {
    expect(daysUntil("2026-11-14", "2026-11-14")).toBe(0);
    expect(daysUntil("2026-11-14", "2026-12-06")).toBe(22);
    expect(daysUntil("2026-03-28", "2026-03-30")).toBe(2);
    expect(daysUntil("2026-11-14", "2026-11-13")).toBe(-1);
  });
});

describe("weekCounts", () => {
  it("sums sessions into Monday weeks, oldest first, this week last", () => {
    // 2026-11-14 is a Saturday; its week starts Monday 2026-11-09.
    const days = [
      { date: "2026-11-09", sessionCount: 1 },
      { date: "2026-11-14", sessionCount: 2 },
      { date: "2026-11-08", sessionCount: 1 }, // Sunday: last week
      { date: "2026-09-01", sessionCount: 5 }, // too old
    ];
    expect(weekCounts(days, "2026-11-14", 4)).toEqual([0, 0, 1, 3]);
  });
});

describe("streakWeeks", () => {
  const d = (date: string, sessionCount = 1) => ({ date, sessionCount });
  it("counts weeks in a row back from this week, in the user's own dates", () => {
    // 2026-11-16 is a Monday: a session on it starts the new week.
    expect(streakWeeks([d("2026-11-15"), d("2026-11-16")], "2026-11-16")).toBe(2);
    expect(streakWeeks([d("2026-10-28"), d("2026-11-04"), d("2026-11-15")], "2026-11-15")).toBe(3);
  });
  it("this week not trained yet keeps last week's streak; a gap ends it", () => {
    expect(streakWeeks([d("2026-10-28"), d("2026-11-04")], "2026-11-14")).toBe(2);
    expect(streakWeeks([d("2026-10-21"), d("2026-11-04")], "2026-11-14")).toBe(1);
    expect(streakWeeks([d("2026-10-28")], "2026-11-14")).toBe(0);
    expect(streakWeeks([d("2026-11-04", 0)], "2026-11-14")).toBe(0);
    expect(streakWeeks([], "2026-11-14")).toBe(0);
  });
});

describe("weightSummary", () => {
  const at = (d: string) => Date.parse(`${d}T08:00:00Z`);
  const e = (date: string, kg: number) => ({ kg, date, at: at(date) });

  it("latest entry, and change, low and high over the 30-day window", () => {
    const s = weightSummary([e("2026-11-14", 82.4), e("2026-09-01", 90), e("2026-10-20", 83.1), e("2026-11-01", 82.3)], "2026-11-14")!;
    expect(s.latestKg).toBe(82.4);
    expect(s.series).toEqual([83.1, 82.3, 82.4]);
    expect(s.changeKg).toBe(-0.7);
    expect([s.lowKg, s.highKg]).toEqual([82.3, 83.1]);
  });

  it("one entry in the window: no change; none at all: null", () => {
    const s = weightSummary([e("2026-11-10", 80), e("2026-08-01", 85)], "2026-11-14")!;
    expect(s.latestKg).toBe(80);
    expect(s.changeKg).toBeNull();
    expect(weightSummary([], "2026-11-14")).toBeNull();
  });

  it("an old latest entry still shows, with an empty window", () => {
    const s = weightSummary([e("2026-08-01", 85)], "2026-11-14")!;
    expect(s.latestKg).toBe(85);
    expect(s.series).toEqual([]);
  });
});

describe("loadSummary", () => {
  const today = "2026-11-14";
  const day = (date: string, load: number, atl = 40, tsb = 5) => ({ date, load, atl, tsb });

  it("builds the days by date: a missing day is 0, not a shift of the days after it", () => {
    const s = loadSummary([day("2026-11-10", 50), day("2026-11-12", 60), day("2026-11-14", 70)], today, 7)!;
    expect(s.loads).toEqual([0, 0, 50, 0, 60, 0, 70]);
  });

  it("rounds the loads and clamps them and the fatigue at 0", () => {
    const s = loadSummary([day("2026-11-13", 49.6, -2), day("2026-11-14", -3, 10)], today, 3)!;
    expect(s.loads).toEqual([0, 50, 0]);
    expect(s.fatigue).toEqual([0, 0, 10]);
  });

  it("week load is the last 7 calendar days, today included", () => {
    const s = loadSummary([day("2026-11-07", 100), day("2026-11-08", 10), day("2026-11-14", 20)], today, 28)!;
    expect(s.loads).toHaveLength(28);
    expect(s.weekLoad).toBe(30);
  });

  it("a missing day's fatigue decays from the day before; days before the first row take its value", () => {
    const s = loadSummary([day("2026-11-12", 50, 42), day("2026-11-14", 10, 30)], today, 4)!;
    expect(s.fatigue[0]).toBe(42);
    expect(s.fatigue[1]).toBe(42);
    expect(s.fatigue[2]).toBeCloseTo(36);
    expect(s.fatigue[3]).toBe(30);
  });

  it("form from today or yesterday only, rounded", () => {
    expect(loadSummary([day("2026-11-14", 50, 40, 6.4)], today)!.form).toBe(6);
    expect(loadSummary([day("2026-11-13", 50, 40, -0.4)], today)!.form).toBe(0);
    expect(loadSummary([day("2026-11-12", 50, 40, 6)], today)!.form).toBeNull();
  });

  it("no load in the days, or only future rows: null", () => {
    expect(loadSummary([day("2026-11-14", 0)], today)).toBeNull();
    expect(loadSummary([day("2026-11-15", 50)], today)).toBeNull();
    expect(loadSummary([], today)).toBeNull();
  });
});
