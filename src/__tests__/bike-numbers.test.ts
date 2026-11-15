import type { Efforts } from "@/lib/garmin/analytics/efforts";
import { bandsFromFloors, garminCyclingBands } from "@/lib/garmin/analytics/thresholds";
import { ftpBasis, ftpEstimate, ftpFromCurve, type TrendActivity } from "@/lib/garmin/analytics/trends";
import { ftpChangedFrom, ftpChangedText, ftpMoved, ftpLineText, watchFtpNote, zoneFloorsError } from "@/lib/utils/bike-numbers";
import { describe, expect, it } from "vitest";
import { APP_FTP, ESTIMATED_FTP, GARMIN_CYCLING_ZONES, HR_ZONES_SNAPSHOT, WATCH_FTP } from "./fixtures/bike-sessions";

/** The bike numbers (docs/plans/bike-sessions.md, section 3): FTP estimate, zones and texts. */

const none: Efforts = { power: {}, speed: {}, distance: {}, vo2: null, hr30: null, dynamics: [] };
let id = 1;
const ride = (day: string, power: Record<number, number>, sport: TrendActivity["sport"] = "bike"): TrendActivity => ({
  id: id++,
  day,
  sport,
  indoor: true,
  durationS: 3600,
  efforts: { ...none, power },
  decoupling: null,
  watchLthr: null,
});

describe("ftpEstimate", () => {
  it("takes the best 60 min when it beats 95 % of the best 20 min (the owner's rides)", () => {
    const acts = [ride("2026-11-03", { 1200: 189, 3600: 159 }), ride("2026-11-10", { 1200: 188, 3600: 186 }), ride("2026-11-12", { 3600: 167 })];
    const e = ftpEstimate(acts, "2026-11-15")!;
    expect(e).toEqual({ value: ESTIMATED_FTP, from: "p60", day: "2026-11-10" });
    expect(ftpBasis(e)).toBe("best 60 min on 10 Nov");
  });

  it("takes 95 % of the best 20 min when no long ride is as high", () => {
    const e = ftpEstimate([ride("2026-11-03", { 1200: 260, 3600: 200 })], "2026-11-15")!;
    expect(e).toEqual({ value: 247, from: "p20", day: "2026-11-03" });
    expect(ftpBasis(e)).toBe("95 % of best 20 min on 3 Nov");
  });

  it("takes critical power when the fit is above both", () => {
    // P(t) = 260 + 6000 / t: CP 260 beats 95 % of 265 W for 20 min.
    const bests = Object.fromEntries([180, 300, 720, 1200].map((t) => [t, 260 + 6000 / t]));
    const e = ftpFromCurve(Object.entries(bests).map(([x, value]) => ({ x: Number(x), value, id: 1, day: "2026-11-01" })))!;
    expect(e).toEqual({ value: 260, from: "cp", day: null });
    expect(ftpBasis(e)).toBe("critical power, last 90 days");
  });

  it("looks back 90 days, at rides only, and gives null with nothing", () => {
    expect(ftpEstimate([ride("2026-08-01", { 3600: 300 }), ride("2026-11-10", { 3600: 300 }, "run")], "2026-11-15")).toBeNull();
    expect(ftpEstimate([ride("2026-08-18", { 3600: 200 })], "2026-11-15")?.value).toBe(200);
  });
});

describe("ftpMoved", () => {
  it("is true from 3 % up or down", () => {
    expect(ftpMoved(APP_FTP, ESTIMATED_FTP)).toBe(true);
    expect(ftpMoved(200, 205)).toBe(false);
    expect(ftpMoved(200, 206)).toBe(true);
    expect(ftpMoved(200, 194)).toBe(true);
  });
});

describe("zones", () => {
  it("turns the Garmin CYCLING floors into bands, zone 5 up to max HR", () => {
    expect(garminCyclingBands(HR_ZONES_SNAPSHOT)).toEqual(GARMIN_CYCLING_ZONES.hr);
    expect(garminCyclingBands(HR_ZONES_SNAPSHOT)![1]).toEqual({ low: 121, high: 140 });
  });

  it("falls back to the DEFAULT row and gives null without floors", () => {
    expect(garminCyclingBands([{ ...HR_ZONES_SNAPSHOT[0] }])).toEqual(GARMIN_CYCLING_ZONES.hr);
    expect(garminCyclingBands([{ sport: "CYCLING", maxHeartRateUsed: 201, zone1Floor: 101 }])).toBeNull();
    expect(garminCyclingBands(null)).toBeNull();
  });

  it("checks custom zone starts", () => {
    expect(zoneFloorsError([100, 120, 140, 160, 180], 200)).toBeNull();
    expect(bandsFromFloors([100, 120, 140, 160, 180], 200)[4]).toEqual({ low: 180, high: 200 });
    expect(zoneFloorsError([100, 120, 120, 160, 180], 200)).toBe("Zone 3 must start above zone 2");
    expect(zoneFloorsError([100, 120, 140, 160, 180], 180)).toBe("Max HR must be above the start of zone 5");
    expect(zoneFloorsError([30, 120, 140, 160, 180], 200)).toMatch(/whole numbers/);
    expect(zoneFloorsError([100, 120, 140, 160], 200)).toMatch(/five zones/);
  });
});

describe("FTP texts", () => {
  const auto = { value: ESTIMATED_FTP, basis: "best 60 min on 10 Nov", source: "garmin" as const, changedFrom: APP_FTP };

  it("writes the FTP line with its basis, and the change once", () => {
    expect(ftpLineText(auto)).toBe("FTP 186 W, from your rides (best 60 min on 10 Nov)");
    expect(ftpLineText({ ...auto, source: "manual", basis: null })).toBe("FTP 186 W, set by hand");
    expect(ftpChangedText(auto)).toBe("FTP changed from 180 to 186 W");
    expect(ftpChangedText({ ...auto, changedFrom: null })).toBeNull();
  });

  it("tells the user to set the watch FTP when it is more than 5 % off", () => {
    expect(watchFtpNote({ ftp: auto, watchFtp: WATCH_FTP })).toBe("Your watch uses 266 W. Set it to 186 W so the watch power zones match.");
    expect(watchFtpNote({ ftp: auto, watchFtp: 195 })).toBeNull();
    expect(watchFtpNote({ ftp: auto, watchFtp: null })).toBeNull();
  });

  it("shows the old value for a garmin row of the last 7 days only", () => {
    const rows = [
      { value: 186, source: "garmin" as const, measuredOn: "2026-11-15" },
      { value: 180, source: "garmin" as const, measuredOn: "2026-11-14" },
    ];
    expect(ftpChangedFrom(rows, "2026-11-15")).toBe(180);
    expect(ftpChangedFrom(rows, "2026-11-23")).toBeNull();
    expect(ftpChangedFrom([rows[0]], "2026-11-15")).toBeNull();
    expect(ftpChangedFrom([{ ...rows[0], source: "manual" }, rows[1]], "2026-11-15")).toBeNull();
  });
});
