import { CIRCUMFERENCE_STEPS, LENGTH_STEPS, mirrorTape, partOf } from "@/lib/utils/body-measurement-parts";
import {
  bodyRatios,
  changeSince,
  formatChange,
  formatCm,
  monthsBefore,
  navyBodyFat,
  nextLogFrom,
  seriesOf,
  sideNote,
  type MeasurementRow,
} from "@/lib/utils/body-measurements";
import { describe, expect, it } from "vitest";

let id = 0;
const row = (measuredOn: string, valueCm: number, site: MeasurementRow["site"] = "waist", side: MeasurementRow["side"] = "none"): MeasurementRow => ({
  id: ++id,
  site,
  side,
  valueCm,
  measuredOn,
});

describe("changeSince", () => {
  const series = [row("2026-07-01", 94), row("2026-10-03", 92), row("2026-11-07", 90.8), row("2026-11-21", 90)];

  it("compares the latest with the first log", () => {
    expect(changeSince(series, "first", "2026-11-21")).toEqual({ delta: -4, from: "2026-07-01" });
  });

  it("compares with the log before the latest", () => {
    expect(changeSince(series, "last", "2026-11-21")).toEqual({ delta: -0.8, from: "2026-11-07" });
  });

  it("compares with the value as of three months ago", () => {
    expect(changeSince(series, "3m", "2026-11-21")).toEqual({ delta: -4, from: "2026-07-01" });
    expect(changeSince(series, "3m", "2027-01-10")).toEqual({ delta: -2, from: "2026-10-03" });
  });

  it("uses the first log when every log is newer than three months", () => {
    expect(changeSince(series.slice(1), "3m", "2026-11-21")).toEqual({ delta: -2, from: "2026-10-03" });
  });

  it("is null with one value", () => {
    expect(changeSince(series.slice(0, 1), "first", "2026-11-21")).toBeNull();
  });
});

describe("seriesOf", () => {
  it("keeps one site and side, oldest first", () => {
    const rows = [row("2026-11-21", 36, "upper-arm", "left"), row("2026-10-03", 35, "upper-arm", "left"), row("2026-11-21", 37, "upper-arm", "right")];
    expect(seriesOf(rows, "upper-arm", "left").map((r) => r.valueCm)).toEqual([35, 36]);
  });
});

describe("format", () => {
  it("shows a neutral arrow and one decimal", () => {
    expect(formatChange(0.5)).toBe("▲0.5");
    expect(formatChange(-2)).toBe("▼2.0");
    expect(formatChange(0.04)).toBe("±0");
    expect(formatCm(36)).toBe("36");
    expect(formatCm(90.84)).toBe("90.8");
  });
});

describe("sideNote", () => {
  it("names the bigger side from 1 cm", () => {
    expect(sideNote(38.4, 39.5)).toBe("Right is 1.1 cm bigger");
    expect(sideNote(36.5, 35.5)).toBe("Left is 1.0 cm bigger");
  });
  it("is quiet under 1 cm or with one side missing", () => {
    expect(sideNote(30, 30.9)).toBeNull();
    expect(sideNote(null, 30)).toBeNull();
  });
});

describe("navyBodyFat", () => {
  it("gives the US Navy estimate for a man", () => {
    // 185 cm, neck 39, waist 90: about 18 % (the plan picture shows 18 %).
    expect(navyBodyFat({ gender: "male", heightCm: 185, neck: 39, waist: 90, hips: null })).toBeCloseTo(18.3, 1);
  });
  it("needs hips for a woman", () => {
    expect(navyBodyFat({ gender: "female", heightCm: 168, neck: 33, waist: 75, hips: null })).toBeNull();
    expect(navyBodyFat({ gender: "female", heightCm: 168, neck: 33, waist: 75, hips: 100 })).toBeCloseTo(28.6, 1);
  });
  it("is null without a gender, height or neck", () => {
    expect(navyBodyFat({ gender: "other", heightCm: 185, neck: 39, waist: 90, hips: 100 })).toBeNull();
    expect(navyBodyFat({ gender: "male", heightCm: null, neck: 39, waist: 90, hips: null })).toBeNull();
    expect(navyBodyFat({ gender: "male", heightCm: 185, neck: null, waist: 90, hips: null })).toBeNull();
  });
});

describe("bodyRatios", () => {
  it("shows the four rows with every input", () => {
    const r = bodyRatios({ gender: "male", heightCm: 185, neck: 39, shoulders: 122, waist: 90, hips: 104 });
    expect(r.map((x) => [x.id, x.value])).toEqual([
      ["waist-height", "0.49"],
      ["waist-hips", "0.87"],
      ["shoulders-waist", "1.36"],
      ["body-fat", "18 %"],
    ]);
  });
  it("hides a row whose input is missing", () => {
    const r = bodyRatios({ gender: null, heightCm: null, neck: null, shoulders: null, waist: 90, hips: 104 });
    expect(r.map((x) => x.id)).toEqual(["waist-hips"]);
  });
});

describe("dates", () => {
  it("adds 14 days for the next log", () => {
    expect(nextLogFrom("2026-11-21")).toBe("2026-12-05");
  });
  it("goes back three months", () => {
    expect(monthsBefore("2026-11-21", 3)).toBe("2026-08-21");
  });
});

describe("parts", () => {
  it("has 13 circumference steps and 3 length steps, sides only on parts 6 to 9", () => {
    expect(CIRCUMFERENCE_STEPS).toHaveLength(13);
    expect(LENGTH_STEPS).toHaveLength(3);
    for (const s of [...CIRCUMFERENCE_STEPS, ...LENGTH_STEPS]) {
      const p = partOf(s.site)!;
      expect(p.sides).toBe(s.side !== "none");
    }
  });
  it("mirrors a tape to the other side of the figure", () => {
    const t = mirrorTape(partOf("upper-arm")!.tape!);
    expect([t.x1, t.x2]).toEqual([135.3, 153.1]);
  });
});
