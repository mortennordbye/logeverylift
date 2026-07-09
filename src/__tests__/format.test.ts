import { describe, expect, it } from "vitest";
import {
  buildRunSetSummary,
  buildSetSummary,
  formatEnduranceDistance,
  formatEndurancePace,
  formatSpeedKmh,
  formatSwimPace,
  formatTime,
  normalizeDecimal,
  restToken,
  sanitizeDecimalInput,
  setToken,
} from "@/lib/utils/format";
import type { ProgramSet } from "@/types/workout";

// Minimal ProgramSet factory
function makeSet(overrides: Partial<ProgramSet> = {}): ProgramSet {
  return {
    id: 1,
    programExerciseId: 1,
    setNumber: 1,
    targetReps: 10,
    weightKg: "50.00",
    durationSeconds: null,
    restTimeSeconds: 60,
    ...overrides,
  } as ProgramSet;
}

describe("endurance pace/distance formatters", () => {
  it("formats swim pace as /100m", () => {
    expect(formatSwimPace(90, 100)).toBe("1:30 /100m");
    // 1500m in 30:00 → 2:00 /100m
    expect(formatSwimPace(1800, 1500)).toBe("2:00 /100m");
  });

  it("formats speed as km/h", () => {
    expect(formatSpeedKmh(3600, 40000)).toBe("40.0 km/h");
    expect(formatSpeedKmh(1800, 15000)).toBe("30.0 km/h");
  });

  it("dispatches by formatter, run keeps /km", () => {
    expect(formatEndurancePace("perKm", 300, 1000)).toBe("5:00 /km");
    expect(formatEndurancePace("per100m", 90, 100)).toBe("1:30 /100m");
    expect(formatEndurancePace("kmh", 3600, 40000)).toBe("40.0 km/h");
  });

  it("returns empty string when distance or duration missing", () => {
    expect(formatEndurancePace("perKm", 0, 1000)).toBe("");
    expect(formatEndurancePace("kmh", 3600, 0)).toBe("");
  });

  it("formats distance with meters for swim under 1km", () => {
    expect(formatEnduranceDistance("m", 750)).toBe("750 m");
    expect(formatEnduranceDistance("m", 1500)).toBe("1.5 km");
    expect(formatEnduranceDistance("km", 5000)).toBe("5 km");
  });
});

describe("formatTime", () => {
  it("formats seconds only", () => {
    expect(formatTime(45)).toBe("00:45");
  });

  it("formats minutes and seconds", () => {
    expect(formatTime(90)).toBe("01:30");
  });

  it("formats exact minutes", () => {
    expect(formatTime(120)).toBe("02:00");
  });

  it("formats zero", () => {
    expect(formatTime(0)).toBe("00:00");
  });

  it("pads single-digit seconds", () => {
    expect(formatTime(61)).toBe("01:01");
  });

  it("formats large values (1 hour)", () => {
    expect(formatTime(3600)).toBe("60:00");
  });

  it("formats very large values", () => {
    expect(formatTime(7261)).toBe("121:01");
  });

  it("formats value with no remainder", () => {
    expect(formatTime(3661)).toBe("61:01");
  });
});

describe("setToken", () => {
  it("formats reps x weight for strength sets", () => {
    expect(setToken(makeSet({ targetReps: 8, weightKg: "100.00" }))).toBe("8x100kg");
  });

  it("shows ? when targetReps is null", () => {
    expect(setToken(makeSet({ targetReps: null }))).toBe("?x50kg");
  });

  it("formats duration for timed sets", () => {
    expect(setToken(makeSet({ durationSeconds: 90, targetReps: null, weightKg: null }))).toBe("01:30");
  });

  it("shows reps-only for bodyweight (weightKg null or 0)", () => {
    expect(setToken(makeSet({ weightKg: null, targetReps: 10 }))).toBe("10 reps");
    expect(setToken(makeSet({ weightKg: "0.00", targetReps: 10 }))).toBe("10 reps");
  });
});

describe("restToken", () => {
  it("formats rest time in mm:ss", () => {
    expect(restToken(makeSet({ restTimeSeconds: 90 }))).toBe("01:30");
  });

  it("formats zero rest", () => {
    expect(restToken(makeSet({ restTimeSeconds: 0 }))).toBe("00:00");
  });
});

describe("buildSetSummary", () => {
  it("returns empty string for no sets", () => {
    expect(buildSetSummary([])).toBe("");
  });

  it("formats a single set", () => {
    const sets = [makeSet({ targetReps: 10, weightKg: "50.00", restTimeSeconds: 60 })];
    expect(buildSetSummary(sets)).toBe("10x50kg; 01:00");
  });

  it("joins up to 3 sets", () => {
    const sets = [
      makeSet({ id: 1, setNumber: 1, targetReps: 10, weightKg: "50.00", restTimeSeconds: 60 }),
      makeSet({ id: 2, setNumber: 2, targetReps: 8, weightKg: "60.00", restTimeSeconds: 90 }),
      makeSet({ id: 3, setNumber: 3, targetReps: 6, weightKg: "70.00", restTimeSeconds: 120 }),
    ];
    expect(buildSetSummary(sets)).toBe("10x50kg; 01:00; 8x60kg; 01:30; 6x70kg; 02:00");
  });

  it("truncates to 3 sets with ellipsis", () => {
    const sets = [
      makeSet({ id: 1, setNumber: 1, targetReps: 10, weightKg: "50.00", restTimeSeconds: 60 }),
      makeSet({ id: 2, setNumber: 2, targetReps: 10, weightKg: "50.00", restTimeSeconds: 60 }),
      makeSet({ id: 3, setNumber: 3, targetReps: 10, weightKg: "50.00", restTimeSeconds: 60 }),
      makeSet({ id: 4, setNumber: 4, targetReps: 10, weightKg: "50.00", restTimeSeconds: 60 }),
    ];
    expect(buildSetSummary(sets)).toContain("...");
    expect(buildSetSummary(sets).split(";").length).toBeLessThanOrEqual(7); // 3 pairs + ellipsis
  });

  it("formats two sets without ellipsis", () => {
    const sets = [
      makeSet({ id: 1, setNumber: 1, targetReps: 10, weightKg: "50.00", restTimeSeconds: 60 }),
      makeSet({ id: 2, setNumber: 2, targetReps: 8, weightKg: "60.00", restTimeSeconds: 90 }),
    ];
    const result = buildSetSummary(sets);
    expect(result).not.toContain("...");
    expect(result).toBe("10x50kg; 01:00; 8x60kg; 01:30");
  });

  it("formats mixed timed and strength sets", () => {
    const sets = [
      makeSet({ id: 1, setNumber: 1, durationSeconds: 60, targetReps: null, weightKg: null, restTimeSeconds: 30 }),
      makeSet({ id: 2, setNumber: 2, targetReps: 10, weightKg: "50.00", restTimeSeconds: 60 }),
    ];
    const result = buildSetSummary(sets);
    expect(result).toContain("01:00");
    expect(result).toContain("10x50kg");
  });

  it("formats all timed sets without weight", () => {
    const sets = [
      makeSet({ id: 1, setNumber: 1, durationSeconds: 30, targetReps: null, weightKg: null, restTimeSeconds: 15 }),
      makeSet({ id: 2, setNumber: 2, durationSeconds: 60, targetReps: null, weightKg: null, restTimeSeconds: 15 }),
    ];
    const result = buildSetSummary(sets);
    expect(result).not.toContain("kg");
    expect(result).toContain("00:30");
    expect(result).toContain("01:00");
  });
});

describe("buildRunSetSummary", () => {
  it("renders run units by default (null discipline)", () => {
    const set = makeSet({ distanceMeters: 5000, durationSeconds: 1500 });
    expect(buildRunSetSummary([set])).toBe("5 km · 25:00 · 5:00 /km");
  });

  it("renders swim distance in meters and /100m pace", () => {
    const set = makeSet({ distanceMeters: 1500, durationSeconds: 1800 });
    // 1500 m ≥ 1 km so distance shows as km, but pace uses the swim formatter
    expect(buildRunSetSummary([set], "swim")).toBe("1.5 km · 30:00 · 2:00 /100m");
  });

  it("renders bike speed in km/h", () => {
    const set = makeSet({ distanceMeters: 40000, durationSeconds: 5400 });
    expect(buildRunSetSummary([set], "bike")).toBe("40 km · 90:00 · 26.7 km/h");
  });

  it("falls back to the discipline label when a set has no distance/duration", () => {
    const set = makeSet({ distanceMeters: null, durationSeconds: null });
    expect(buildRunSetSummary([set], "swim")).toBe("Swim");
  });
});

describe("normalizeDecimal", () => {
  it("converts comma to period", () => {
    expect(normalizeDecimal("67,5")).toBe("67.5");
  });

  it("leaves a period untouched", () => {
    expect(normalizeDecimal("67.5")).toBe("67.5");
  });
});

describe("sanitizeDecimalInput", () => {
  it("accepts a comma decimal separator", () => {
    expect(sanitizeDecimalInput("67,5")).toBe("67.5");
  });

  it("accepts a period decimal separator", () => {
    expect(sanitizeDecimalInput("67.5")).toBe("67.5");
  });

  it("strips non-numeric characters", () => {
    expect(sanitizeDecimalInput("6a7,5kg")).toBe("67.5");
  });

  it("collapses multiple comma separators to one point", () => {
    expect(sanitizeDecimalInput("67,5,5")).toBe("67.55");
  });

  it("collapses multiple period separators to one point", () => {
    expect(sanitizeDecimalInput("67.5.5")).toBe("67.55");
  });

  it("returns empty string for empty input", () => {
    expect(sanitizeDecimalInput("")).toBe("");
  });

  it("returns empty string when there are no digits", () => {
    expect(sanitizeDecimalInput("abc")).toBe("");
  });
});
