import type { DemandRow } from "@/lib/garmin/analytics/demands";
import type { Efforts } from "@/lib/garmin/analytics/efforts";
import { sessionInsights, type SessionInsightInput } from "@/lib/garmin/analytics/session-insights";
import type { TrendActivity } from "@/lib/garmin/analytics/trends";
import { describe, expect, it } from "vitest";

const today = "2026-11-11";
const none: Efforts = { power: {}, speed: {}, distance: {}, vo2: null, hr30: null, dynamics: [] };
let id = 1;
const act = (day: string, sport: TrendActivity["sport"], over: Partial<TrendActivity> = {}, efforts: Partial<Efforts> = {}): TrendActivity => ({
  id: id++,
  day,
  sport,
  indoor: false,
  durationS: 3600,
  efforts: { ...none, ...efforts },
  decoupling: null,
  watchLthr: null,
  ...over,
});
const steady = (minutes: number, pct: number) => ({ valid: true as const, efFirst: 1.5, efSecond: 1.5, pct, ef: 1.5, minutes, temperature: 20 });
const base: SessionInsightInput = { today, acts: [], lthrEstimate: null, watchLthr: null, strengthYesterday: null, checklist: null, daysToRace: null, projection: null };
const ids = (i: SessionInsightInput) => sessionInsights(i).map((x) => x.id);

describe("sessionInsights", () => {
  it("praises the longest steady ride yet, and flags a drifting one", () => {
    const old = act("2026-10-01", "bike", { decoupling: steady(120, 3) });
    expect(ids({ ...base, acts: [old, act("2026-11-10", "bike", { decoupling: steady(150, 4.9) })] })).toEqual(["decoupling_good"]);
    expect(ids({ ...base, acts: [old, act("2026-11-10", "bike", { decoupling: steady(60, 4) })] })).toEqual([]);
    const poor = sessionInsights({ ...base, acts: [act("2026-11-10", "run", { decoupling: steady(60, 8.5) })] });
    expect(poor.map((x) => x.id)).toEqual(["decoupling_poor"]);
    expect(poor[0].text).toMatch(/8.5 %.*20 °C/);
    // Older than the last three days: silent.
    expect(ids({ ...base, acts: [act("2026-11-05", "run", { decoupling: steady(60, 9) })] })).toEqual([]);
  });

  it("notes a new 90-day best set in the last few days, and not an older one", () => {
    const before = act("2026-10-01", "bike", {}, { power: { 1200: 240 } });
    expect(ids({ ...base, acts: [before, act("2026-11-10", "bike", {}, { power: { 1200: 250 } })] })).toContain("new_best");
    expect(ids({ ...base, acts: [before, act("2026-11-10", "bike", {}, { power: { 1200: 230 } })] })).not.toContain("new_best");
  });

  it("calls FTP stale after 90 days without a near-best 20 minutes", () => {
    const acts = [act("2026-06-01", "bike", {}, { power: { 1200: 260 } }), act("2026-11-01", "bike", {}, { power: { 1200: 200 } })];
    expect(ids({ ...base, acts })).toContain("ftp_stale");
    expect(ids({ ...base, acts: [...acts, act("2026-10-01", "bike", {}, { power: { 1200: 250 } })] })).not.toContain("ftp_stale");
  });

  it("raises the LTHR gap over 4 bpm, and heavy strength from load 40", () => {
    expect(ids({ ...base, lthrEstimate: 165, watchLthr: 170 })).toEqual(["lthr_gap"]);
    expect(ids({ ...base, lthrEstimate: 166, watchLthr: 170 })).toEqual([]);
    expect(ids({ ...base, strengthYesterday: 40 })).toEqual(["strength_before_key"]);
    expect(ids({ ...base, strengthYesterday: 39 })).toEqual([]);
  });

  it("warns about a missing long session inside 8 weeks of the race, and not before", () => {
    const checklist: DemandRow[] = [{ key: "bike", label: "Longest ride, 8 weeks", target: "4:30 h", best: "2:06 h", progress: 0.47, met: false, activityId: 1, next: "2:36 h" }];
    const near = sessionInsights({ ...base, checklist, daysToRace: 50 });
    expect(near.map((x) => x.id)).toEqual(["long_gap"]);
    expect(near[0].text).toBe("8 weeks to the race and your longest ride is 2:06 h of 4:30 h. Next step: 2:36 h.");
    expect(ids({ ...base, checklist, daysToRace: 60 })).toEqual([]);
  });
});
