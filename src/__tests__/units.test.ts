import {
  buildRunSetSummary,
  distancePresetLabel,
  formatDistanceKm,
  formatEnduranceDistance,
  formatEndurancePace,
  loggedSetLabel,
} from "@/lib/utils/format";
import { disciplineConfig } from "@/lib/utils/discipline";
import { fieldToMeters, fieldUnit, metersToField, type Units } from "@/lib/utils/units";
import type { ProgramSet } from "@/types/workout";
import { describe, expect, it } from "vitest";

const metric: Units = { distance: "km", swim: "m" };
const imperial: Units = { distance: "mi", swim: "yd" };

describe("the field unit for a discipline", () => {
  it("swaps each metric field unit for its imperial pair", () => {
    expect(fieldUnit("km", metric)).toBe("km");
    expect(fieldUnit("m", metric)).toBe("m");
    expect(fieldUnit("km", imperial)).toBe("mi");
    expect(fieldUnit("m", imperial)).toBe("yd");
  });
});

describe("metersToField and fieldToMeters", () => {
  it("leaves metric exactly as before units existed", () => {
    expect(metersToField(4989, "km")).toBe(4.989);
    expect(fieldToMeters(4.989, "km")).toBe(4989);
    expect(metersToField(750, "m")).toBe(750);
    expect(fieldToMeters(750, "m")).toBe(750);
  });

  it("converts miles and yards to whole meters", () => {
    expect(fieldToMeters(1, "mi")).toBe(1609);
    expect(fieldToMeters(3.1, "mi")).toBe(4989);
    expect(fieldToMeters(500, "yd")).toBe(457);
    expect(metersToField(1609, "mi")).toBe(1);
    expect(metersToField(457, "yd")).toBe(500);
  });

  it("reads a typed value back as typed", () => {
    for (const typed of [0.5, 1, 3.1, 6.2, 13.1, 26.2]) {
      expect(metersToField(fieldToMeters(typed, "mi"), "mi")).toBe(typed);
    }
    for (const typed of [25, 100, 500, 1650]) {
      expect(metersToField(fieldToMeters(typed, "yd"), "yd")).toBe(typed);
    }
  });

  it("keeps the stored meters when the shown value is saved back unchanged", () => {
    expect(metersToField(5000, "mi")).toBe(3.11);
    expect(fieldToMeters(3.11, "mi")).toBe(5005);
    expect(fieldToMeters(3.11, "mi", 5000)).toBe(5000);
    expect(fieldToMeters(3.2, "mi", 5000)).toBe(5150);
  });
});

describe("formatting in the user's units", () => {
  it("shows distance in km or mi", () => {
    expect(formatDistanceKm(5000, metric)).toBe("5 km");
    expect(formatDistanceKm(5000, imperial)).toBe("3.1 mi");
    expect(formatDistanceKm(1609.344, imperial)).toBe("1 mi");
  });

  it("shows run pace per km or per mile", () => {
    // 25:00 for 5 km = 5:00 /km = 8:03 /mi.
    expect(formatEndurancePace("perKm", 1500, 5000, metric)).toBe("5:00 /km");
    expect(formatEndurancePace("perKm", 1500, 5000, imperial)).toBe("8:03 /mi");
  });

  it("shows ride speed in km/h or mph", () => {
    expect(formatEndurancePace("kmh", 3600, 30000, metric)).toBe("30.0 km/h");
    expect(formatEndurancePace("kmh", 3600, 30000, imperial)).toBe("18.6 mph");
  });

  it("shows swim pace per 100 m or per 100 yd", () => {
    // 1:40 per 100 m = 1:31 per 100 yd.
    expect(formatEndurancePace("per100m", 1500, 1500, metric)).toBe("1:40 /100m");
    expect(formatEndurancePace("per100m", 1500, 1500, imperial)).toBe("1:31 /100yd");
  });

  it("shows swim distance in m or yd, and long swims in km or mi", () => {
    expect(formatEnduranceDistance("m", 750, metric)).toBe("750 m");
    expect(formatEnduranceDistance("m", 1900, metric)).toBe("1.9 km");
    expect(formatEnduranceDistance("m", 457, imperial)).toBe("500 yd");
    expect(formatEnduranceDistance("m", 3800, imperial)).toBe("2.4 mi");
    // Swim units do not follow the run distance unit.
    expect(formatEnduranceDistance("m", 750, { distance: "mi", swim: "m" })).toBe("750 m");
    expect(formatEnduranceDistance("m", 1900, { distance: "mi", swim: "m" })).toBe("1.9 km");
  });

  it("labels distance presets in the user's units, keeping the metric labels", () => {
    const run = disciplineConfig("run");
    const i = run.distancePresetsM.indexOf(5000);
    expect(distancePresetLabel(run, i, metric)).toBe(run.distanceLabels[i]);
    expect(distancePresetLabel(run, i, imperial)).toBe("3.1mi");
  });

  it("builds run summaries and logged-set labels in the user's units", () => {
    const set = { distanceMeters: 5000, durationSeconds: 1500 } as ProgramSet;
    expect(buildRunSetSummary([set], "run", imperial)).toBe("3.1 mi · 25:00 · 8:03 /mi");
    expect(loggedSetLabel({ ...set, weightKg: "0", actualReps: 0 }, true, imperial)).toBe("3.1 mi · 25:00 · 8:03 /mi");
    expect(buildRunSetSummary([set], "run")).toBe("5 km · 25:00 · 5:00 /km");
  });
});
