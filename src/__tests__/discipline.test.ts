import { describe, expect, it } from "vitest";
import {
  DISCIPLINES,
  DISCIPLINE_CONFIG,
  disciplineConfig,
  matchingPaceBrackets,
  paceSecondsPerMeter,
} from "@/lib/utils/discipline";

describe("DISCIPLINE_CONFIG integrity", () => {
  it("covers swim, bike, run", () => {
    expect(DISCIPLINES).toEqual(["swim", "bike", "run"]);
  });

  it("has matching preset and label arrays for every discipline", () => {
    for (const d of DISCIPLINES) {
      const cfg = DISCIPLINE_CONFIG[d];
      expect(cfg.distancePresetsM.length).toBe(cfg.distanceLabels.length);
      expect(cfg.distancePresetsM.length).toBeGreaterThan(0);
      expect(cfg.paceBrackets.length).toBeGreaterThan(0);
    }
  });

  it("uses meter input only for swim", () => {
    expect(DISCIPLINE_CONFIG.swim.inputUnit).toBe("m");
    expect(DISCIPLINE_CONFIG.bike.inputUnit).toBe("km");
    expect(DISCIPLINE_CONFIG.run.inputUnit).toBe("km");
  });

  it("maps each discipline to its conventional pace formatter", () => {
    expect(DISCIPLINE_CONFIG.swim.paceFormatter).toBe("per100m");
    expect(DISCIPLINE_CONFIG.bike.paceFormatter).toBe("kmh");
    expect(DISCIPLINE_CONFIG.run.paceFormatter).toBe("perKm");
  });

  it("shows incline only for run", () => {
    expect(DISCIPLINE_CONFIG.run.showIncline).toBe(true);
    expect(DISCIPLINE_CONFIG.swim.showIncline).toBe(false);
    expect(DISCIPLINE_CONFIG.bike.showIncline).toBe(false);
  });
});

describe("disciplineConfig fallback", () => {
  it("falls back to run for null/undefined (legacy cardio)", () => {
    expect(disciplineConfig(null)).toBe(DISCIPLINE_CONFIG.run);
    expect(disciplineConfig(undefined)).toBe(DISCIPLINE_CONFIG.run);
  });

  it("resolves a tagged discipline", () => {
    expect(disciplineConfig("swim")).toBe(DISCIPLINE_CONFIG.swim);
  });
});

describe("matchingPaceBrackets", () => {
  it("matches a clean race distance to its bracket", () => {
    const labels = matchingPaceBrackets("run", 5000).map((b) => b.label);
    expect(labels).toContain("5 km");
  });

  it("matches a swim distance within window tolerance", () => {
    // 1480 m falls inside the 1500 m bracket (1400–1600).
    const labels = matchingPaceBrackets("swim", 1480).map((b) => b.label);
    expect(labels).toEqual(["1500 m"]);
  });

  it("returns no bracket for an in-between distance", () => {
    // 7 km run sits between the 5 km (4700–5300) and 10 km (9500–10500) windows.
    expect(matchingPaceBrackets("run", 7000)).toEqual([]);
  });

  it("returns no bracket for a zero-distance effort", () => {
    expect(matchingPaceBrackets("bike", 0)).toEqual([]);
  });
});

describe("paceSecondsPerMeter", () => {
  it("computes seconds per meter (lower = faster)", () => {
    // 5 km in 25:00 → 1500 s / 5000 m = 0.3 s/m
    expect(paceSecondsPerMeter(1500, 5000)).toBeCloseTo(0.3, 6);
    // A faster 5 km (24:00) yields a lower number
    expect(paceSecondsPerMeter(1440, 5000)).toBeLessThan(paceSecondsPerMeter(1500, 5000));
  });

  it("returns Infinity for non-positive distance", () => {
    expect(paceSecondsPerMeter(1500, 0)).toBe(Infinity);
  });
});
