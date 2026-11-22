import {
  agreesWithTest,
  thresholdWarnings,
  currentThresholds,
  formatThreshold,
  isStale,
  parseMinSec,
  parseThresholdInput,
  paceToSpeed,
  protocolsFor,
  testInputs,
  speedToPace,
  thresholdRangeError,
  valueFromTest,
  weeksSince,
} from "@/lib/utils/thresholds";
import { describe, expect, it } from "vitest";

/** Field tests, ranges, units and the current value (docs/plans/athlete-profile.md, 2.3). */

describe("field tests", () => {
  it("CSS from 400/200 m is 200 / (T400 - T200)", () => {
    // 400 m in 6:40, 200 m in 3:10: CSS 200 / 210 m/s, 1:45 per 100 m.
    const r = valueFromTest("swim_css", "css_400_200", { t400Seconds: 400, t200Seconds: 190 });
    expect("value" in r && r.value).toBeCloseTo(0.952381, 5);
    expect("value" in r && formatThreshold("swim_css", r.value)).toBe("1:45 /100m");
  });

  it("T-time from 1000 m", () => {
    const r = valueFromTest("swim_css", "swim_t1000", { t1000Seconds: 1100 });
    expect("value" in r && formatThreshold("swim_css", r.value)).toBe("1:50 /100m");
  });

  it("FTP from the 20-minute test is 0.95 x its average power, rounded", () => {
    expect(valueFromTest("ftp", "ftp_20min", { avgPower20: 280 })).toEqual({ value: 266 });
  });

  it("FTP from the 30-minute test is its average power, no factor", () => {
    expect(valueFromTest("ftp", "bike_30min", { avgPower30: 270.4 })).toEqual({ value: 270 });
    expect(protocolsFor("ftp").map((p) => p.protocol)).toEqual(["ftp_20min", "bike_30min", "ftp_ramp"]);
  });

  it("FTP from the ramp test is 0.75 x the best 1 min power, rounded", () => {
    expect(valueFromTest("ftp", "ftp_ramp", { best1MinPower: 248 })).toEqual({ value: 186 });
    expect(valueFromTest("ftp", "ftp_ramp", {})).toEqual({ error: "Enter the average power of your best minute" });
  });

  it("LTHR and pace from the 30-minute run", () => {
    expect(valueFromTest("lthr_run", "run_30min", { avgHrLast20: 171.4 })).toEqual({ value: 171 });
    // Friel: threshold pace is the average pace of the whole 30 minutes, not the last 20.
    const pace = valueFromTest("run_threshold_pace", "run_30min", { distance30Meters: 7200 });
    expect("value" in pace && formatThreshold("run_threshold_pace", pace.value)).toBe("4:10 /km");
    expect(protocolsFor("run_threshold_pace")[0].inputs).toEqual([{ key: "distance30Meters", label: "Distance, whole 30 min", kind: "meters" }]);
  });

  it("a row stored before the whole 30 min input keeps its last 20 min formula and data", () => {
    const old = valueFromTest("run_threshold_pace", "run_30min", { distanceLast20Meters: 4800 });
    expect("value" in old && formatThreshold("run_threshold_pace", old.value)).toBe("4:10 /km");
    expect(testInputs("run_threshold_pace", "run_30min", { distanceLast20Meters: 4800, other: 1 })).toEqual({ distanceLast20Meters: 4800 });
  });

  it("refuses bad inputs and the wrong test for a kind", () => {
    expect(valueFromTest("swim_css", "css_400_200", { t400Seconds: 190, t200Seconds: 400 })).toHaveProperty("error");
    expect(valueFromTest("swim_css", "css_400_200", { t400Seconds: 400 })).toHaveProperty("error");
    expect(valueFromTest("swim_css", "css_400_200", { t400Seconds: 0, t200Seconds: 0 })).toHaveProperty("error");
    expect(valueFromTest("ftp", "run_30min", { avgPower30: 280 })).toHaveProperty("error");
    expect(valueFromTest("lthr_bike", "bike_30min", {})).toHaveProperty("error");
  });

  it("max HR has no protocol; CSS has two", () => {
    expect(protocolsFor("max_hr")).toEqual([]);
    expect(protocolsFor("swim_css").map((p) => p.protocol)).toEqual(["css_400_200", "swim_t1000"]);
  });

  it("a given value agrees with the test within 1%", () => {
    expect(agreesWithTest(266, 266)).toBe(true);
    expect(agreesWithTest(268, 266)).toBe(true);
    expect(agreesWithTest(270, 266)).toBe(false);
  });
});

describe("ranges", () => {
  it("accepts the ends and refuses outside", () => {
    expect(thresholdRangeError("ftp", 50)).toBeNull();
    expect(thresholdRangeError("ftp", 601)).toContain("between 50 W and 600 W");
    expect(thresholdRangeError("max_hr", 79)).not.toBeNull();
    expect(thresholdRangeError("run_threshold_pace", 1000 / 120)).toBeNull();
    expect(thresholdRangeError("run_threshold_pace", 1000 / 100)).not.toBeNull();
    expect(thresholdRangeError("swim_css", 100 / 300)).not.toBeNull();
  });
});

describe("units", () => {
  const mi = { distance: "mi" as const, swim: "yd" as const };

  it("pace and CSS round trip in km, mi, m and yd within a second", () => {
    for (const units of [undefined, mi]) {
      const run = parseThresholdInput("run_threshold_pace", "4:30", units)!;
      expect(formatThreshold("run_threshold_pace", run, units)).toBe(`4:30 /${units ? "mi" : "km"}`);
      const swim = parseThresholdInput("swim_css", "1:40", units)!;
      expect(formatThreshold("swim_css", swim, units)).toBe(`1:40 /100${units ? "yd" : "m"}`);
    }
  });

  it("a mile pace is slower per unit than the same speed per km", () => {
    const v = parseThresholdInput("run_threshold_pace", "4:00")!;
    expect(formatThreshold("run_threshold_pace", v, mi)).toBe("6:26 /mi");
  });

  it("parses min:ss and plain seconds; refuses junk", () => {
    expect(parseMinSec("4:05")).toBe(245);
    expect(parseMinSec("245")).toBe(245);
    expect(parseMinSec("4:75")).toBeNull();
    expect(parseThresholdInput("ftp", "abc")).toBeNull();
    expect(parseThresholdInput("ftp", "250")).toBe(250);
    expect(speedToPace(paceToSpeed(270, 1000), 1000)).toBeCloseTo(270);
  });
});

describe("current value and staleness", () => {
  it("latest date wins, then the highest id; deleted rows are ignored", () => {
    const rows = [
      { id: 1, kind: "ftp" as const, measuredOn: "2026-10-01" },
      { id: 2, kind: "ftp" as const, measuredOn: "2026-11-01" },
      { id: 3, kind: "ftp" as const, measuredOn: "2026-11-01" },
      { id: 4, kind: "ftp" as const, measuredOn: "2026-12-01", deletedAt: new Date() },
      { id: 5, kind: "max_hr" as const, measuredOn: "2026-01-01" },
    ];
    const cur = currentThresholds(rows);
    expect(cur.ftp?.id).toBe(3);
    expect(cur.max_hr?.id).toBe(5);
    expect(cur.swim_css).toBeUndefined();
  });

  it("stale at 8 weeks", () => {
    expect(weeksSince("2026-09-17", "2026-11-12")).toBe(8);
    expect(isStale("2026-09-17", "2026-11-12")).toBe(true);
    expect(isStale("2026-09-18", "2026-11-12")).toBe(false);
  });
});

describe("warnings", () => {
  const row = (kind: "lthr_run" | "lthr_bike" | "max_hr", value: number) => ({ kind, value });

  it("threshold HR at or above max HR is a warning, not a block", () => {
    expect(thresholdWarnings({ lthr_run: row("lthr_run", 186), max_hr: row("max_hr", 185) })).toEqual([
      "Threshold HR, run 186 bpm is not below Max HR 185 bpm. Check both values.",
    ]);
    expect(thresholdWarnings({ lthr_bike: row("lthr_bike", 160), max_hr: row("max_hr", 185) })).toEqual([]);
    expect(thresholdWarnings({ lthr_run: row("lthr_run", 186) })).toEqual([]);
  });
});

describe("cadence kinds (docs/plans/strict-targets.md, decision 6)", () => {
  it("bike cadence is typed and shown in rpm, run cadence in spm", () => {
    expect(parseThresholdInput("bike_cadence", "88")).toBe(88);
    expect(parseThresholdInput("run_cadence", "172")).toBe(172);
    expect(parseThresholdInput("run_cadence", "4:30")).toBeNull();
    expect(formatThreshold("bike_cadence", 87.6)).toBe("88 rpm");
    expect(formatThreshold("run_cadence", 172)).toBe("172 spm");
  });

  it("refuses a cadence out of range", () => {
    expect(thresholdRangeError("bike_cadence", 88)).toBeNull();
    expect(thresholdRangeError("bike_cadence", 30)).toBe("Bike cadence must be between 40 rpm and 140 rpm");
    expect(thresholdRangeError("run_cadence", 86)).toBe("Run cadence must be between 120 spm and 230 spm");
    expect(thresholdRangeError("run_cadence", 172)).toBeNull();
  });
});
