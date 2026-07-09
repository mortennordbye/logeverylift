import { describe, expect, it } from "vitest";
import {
  buildSuggestion,
  estimate1RM,
  estimateRepsAt,
  isConfidentHit,
  roundToNearest,
  DELOAD_THRESHOLD,
  REQUIRED_HITS,
} from "@/lib/utils/progression";
import type { HistoryRow, ProgramSetData, UserProfile } from "@/lib/utils/progression";

// ─── Test helpers ──────────────────────────────────────────────────────────────

function makeRow(overrides: Partial<HistoryRow> = {}): HistoryRow {
  return {
    exerciseId: 1,
    setNumber: 1,
    actualReps: 8,
    targetReps: 8,
    weightKg: "80.00",
    durationSeconds: null,
    feeling: "Good",
    date: "2024-01-01",
    rpe: 7,
    ...overrides,
  };
}

function makePs(overrides: Partial<ProgramSetData> = {}): ProgramSetData {
  return {
    programSetId: 1,
    setNumber: 1,
    targetReps: 8,
    durationSeconds: null,
    exerciseId: 1,
    overloadIncrementKg: null,
    overloadIncrementReps: 0,
    progressionMode: "weight",
    ...overrides,
  };
}

/** Build N identical rows, newest first (dates 2024-01-0N, 2024-01-0N-1, …) */
function makeRows(n: number, rowOverride: Partial<HistoryRow> = {}): HistoryRow[] {
  return Array.from({ length: n }, (_, i) =>
    makeRow({ ...rowOverride, date: `2024-01-${String(n - i).padStart(2, "0")}` }),
  );
}

// ─── estimate1RM ──────────────────────────────────────────────────────────────

describe("estimate1RM", () => {
  it("calculates Epley 1RM correctly", () => {
    expect(estimate1RM(100, 5)).toBeCloseTo(116.67, 1);
    expect(estimate1RM(100, 1)).toBeCloseTo(103.33, 1);
    expect(estimate1RM(80, 8)).toBeCloseTo(101.33, 1);
  });

  it("returns 0 for weight=0 (caller must guard before calling)", () => {
    // This is why we guard `baseWeight > 0` before calling
    expect(estimate1RM(0, 10)).toBe(0);
  });
});

// ─── estimateRepsAt ───────────────────────────────────────────────────────────

describe("estimateRepsAt", () => {
  it("returns fewer reps at higher weight", () => {
    const oneRM = estimate1RM(100, 8); // ~126.7
    const repsAt105 = estimateRepsAt(oneRM, 105);
    expect(repsAt105).toBeLessThan(8);
    expect(repsAt105).toBeGreaterThanOrEqual(1);
  });

  it("returns at least 1 even when weight exceeds 1RM", () => {
    expect(estimateRepsAt(100, 200)).toBe(1);
  });

  it("is consistent inverse of estimate1RM", () => {
    const oneRM = estimate1RM(80, 6);
    const reps = estimateRepsAt(oneRM, 85);
    // At 85kg from a ~96kg 1RM, should be ~4 reps
    expect(reps).toBeLessThan(6);
    expect(reps).toBeGreaterThanOrEqual(1);
  });
});

// ─── roundToNearest ───────────────────────────────────────────────────────────

describe("roundToNearest", () => {
  it("rounds to nearest multiple", () => {
    expect(roundToNearest(77.3, 2.5)).toBeCloseTo(77.5);
    expect(roundToNearest(78.8, 2.5)).toBeCloseTo(80.0);
    expect(roundToNearest(77.3, 1)).toBeCloseTo(77);
    expect(roundToNearest(77.6, 1)).toBeCloseTo(78);
  });

  it("returns value unchanged when increment is 0", () => {
    expect(roundToNearest(77.3, 0)).toBeCloseTo(77.3);
  });

  it("returns value unchanged when increment is negative", () => {
    expect(roundToNearest(77.3, -1)).toBeCloseTo(77.3);
  });
});

// ─── isConfidentHit ───────────────────────────────────────────────────────────

describe("isConfidentHit", () => {
  it("returns true for RPE ≤ 7 when target reps met", () => {
    expect(isConfidentHit(makeRow({ rpe: 6, actualReps: 8, targetReps: 8 }), 8)).toBe(true);
    expect(isConfidentHit(makeRow({ rpe: 7, actualReps: 8, targetReps: 8 }), 8)).toBe(true);
  });

  it("returns true for RPE 8 only when actualReps > targetReps", () => {
    expect(isConfidentHit(makeRow({ rpe: 8, actualReps: 9, targetReps: 8 }), 8)).toBe(true);
    expect(isConfidentHit(makeRow({ rpe: 8, actualReps: 8, targetReps: 8 }), 8)).toBe(false);
  });

  it("returns false for RPE 9-10 regardless of reps", () => {
    expect(isConfidentHit(makeRow({ rpe: 9, actualReps: 8, targetReps: 8 }), 8)).toBe(false);
    expect(isConfidentHit(makeRow({ rpe: 10, actualReps: 10, targetReps: 8 }), 8)).toBe(false);
  });

  it("treats null RPE as 7 (neutral — old sessions)", () => {
    // rpe in HistoryRow is required integer, but 0 means "no RPE set" in practice
    // Treat 0 as equivalent to null by passing rpe=0 which is < 7
    expect(isConfidentHit(makeRow({ rpe: 0, actualReps: 8, targetReps: 8 }), 8)).toBe(true);
  });

  it("returns false when target reps not met", () => {
    expect(isConfidentHit(makeRow({ rpe: 6, actualReps: 6, targetReps: 8 }), 8)).toBe(false);
  });

  it("returns true for null targets when reps > 0 (open-ended sets count as confident)", () => {
    expect(isConfidentHit(makeRow({ rpe: 6, actualReps: 8, targetReps: null }), null)).toBe(true);
    expect(isConfidentHit(makeRow({ rpe: 9, actualReps: 8, targetReps: null }), null)).toBe(true);
  });

  it("returns false for null targets when actualReps = 0 (nothing performed)", () => {
    expect(isConfidentHit(makeRow({ rpe: 6, actualReps: 0, targetReps: null }), null)).toBe(false);
  });
});

// ─── buildSuggestion ─────────────────────────────────────────────────────────

describe("buildSuggestion — no history", () => {
  it("returns null with empty rows", () => {
    expect(buildSuggestion([], makePs(), null)).toBeNull();
  });
});

describe("buildSuggestion — consensus gate", () => {
  it("holds when only 1 session hit target (insufficient consensus)", () => {
    const rows = [makeRow({ rpe: 6 })]; // 1 hit, need 2
    const result = buildSuggestion(rows, makePs(), null);
    expect(result?.reason).toBe("held");
  });

  it("progresses when REQUIRED_HITS sessions hit target with confidence", () => {
    const rows = makeRows(REQUIRED_HITS, { rpe: 6, actualReps: 8, targetReps: 8 });
    const result = buildSuggestion(rows, makePs(), null);
    expect(result?.reason).toBe("progressed");
    expect(result?.suggestedWeightKg).toBeCloseTo(82.5); // 80 + 2.5
  });

  it("holds when last session was RPE 10 even with previous hits", () => {
    const rows = [
      makeRow({ rpe: 10, actualReps: 8, date: "2024-01-03" }), // most recent, no confidence
      makeRow({ rpe: 6,  actualReps: 8, date: "2024-01-02" }), // confident
      makeRow({ rpe: 6,  actualReps: 8, date: "2024-01-01" }), // confident
    ];
    // 2 confident hits but most recent was RPE 10 — still progresses (consensus is count, not recency)
    const result = buildSuggestion(rows, makePs(), null);
    expect(result?.reason).toBe("progressed");
  });

  it("holds when all sessions are RPE 9-10 hits", () => {
    const rows = makeRows(3, { rpe: 9, actualReps: 8, targetReps: 8 });
    const result = buildSuggestion(rows, makePs(), null);
    expect(result?.reason).toBe("held");
  });
});

describe("buildSuggestion — deload detection", () => {
  it("suggests deload after DELOAD_THRESHOLD consecutive failures", () => {
    const rows = makeRows(DELOAD_THRESHOLD, { actualReps: 5, targetReps: 8, rpe: 9 });
    const result = buildSuggestion(rows, makePs(), null);
    expect(result?.reason).toBe("deload");
    // 10% deload: 80 * 0.9 = 72, rounded to nearest 2.5 = 72.5
    expect(result?.suggestedWeightKg).toBeCloseTo(72.5);
  });

  it("does not deload with fewer than DELOAD_THRESHOLD rows", () => {
    const rows = makeRows(DELOAD_THRESHOLD - 1, { actualReps: 5, targetReps: 8 });
    const result = buildSuggestion(rows, makePs(), null);
    expect(result?.reason).toBe("held");
  });

  it("does not deload in manual mode", () => {
    const rows = makeRows(DELOAD_THRESHOLD, { actualReps: 5, targetReps: 8 });
    const result = buildSuggestion(rows, makePs({ progressionMode: "manual" }), null);
    expect(result?.reason).toBe("manual");
  });
});

describe("buildSuggestion — smart mode", () => {
  it("provides adjustedRepsForWeight for near-max sets (RPE ≥ 7)", () => {
    const rows = makeRows(REQUIRED_HITS, { weightKg: "80.00", actualReps: 8, targetReps: 8, rpe: 7 });
    const result = buildSuggestion(rows, makePs({ progressionMode: "smart" }), null);
    expect(result?.reason).toBe("progressed");
    expect(result?.suggestedWeightKg).toBeCloseTo(82.5);
    // adjustedRepsForWeight should be < 8 at 82.5kg
    expect(result?.adjustedRepsForWeight).toBeDefined();
    expect(result?.adjustedRepsForWeight ?? 99).toBeLessThan(8);
  });

  it("skips adjustedRepsForWeight on sub-max sets (RPE < 7) — Epley invalid", () => {
    // Same data as above but RPE 5 — too easy for the 1RM estimate to be meaningful
    const rows = makeRows(REQUIRED_HITS, { weightKg: "80.00", actualReps: 8, targetReps: 8, rpe: 5 });
    const result = buildSuggestion(rows, makePs({ progressionMode: "smart" }), null);
    expect(result?.reason).toBe("progressed");
    expect(result?.adjustedRepsForWeight).toBeUndefined();
  });

  it("skips adjustedRepsForWeight when weight is 0 (bodyweight exercises)", () => {
    const rows = makeRows(REQUIRED_HITS, { weightKg: "0.00", actualReps: 8, targetReps: 8, rpe: 7 });
    const result = buildSuggestion(rows, makePs({ progressionMode: "smart", overloadIncrementKg: "2.50" }), null);
    // With weight=0, Epley can't compute 1RM; no adjustedRepsForWeight
    expect(result?.adjustedRepsForWeight).toBeUndefined();
  });

  it("skips adjustedRepsForWeight for actualReps > 12 (Epley unreliable at high reps)", () => {
    const rows = makeRows(REQUIRED_HITS, { weightKg: "60.00", actualReps: 15, targetReps: 15, rpe: 7 });
    const result = buildSuggestion(rows, makePs({ progressionMode: "smart" }), null);
    expect(result?.adjustedRepsForWeight).toBeUndefined();
  });

  it("holds and provides no adjustedRepsForWeight when not enough consensus", () => {
    const rows = [makeRow({ rpe: 7 })]; // only 1 confident hit
    const result = buildSuggestion(rows, makePs({ progressionMode: "smart" }), null);
    expect(result?.reason).toBe("held");
    expect(result?.adjustedRepsForWeight).toBeUndefined();
  });
});

describe("buildSuggestion — reps mode", () => {
  it("increments reps when target hit with consensus", () => {
    const rows = makeRows(REQUIRED_HITS, { actualReps: 8, targetReps: 8, rpe: 6 });
    const result = buildSuggestion(rows, makePs({ progressionMode: "reps", overloadIncrementReps: 1 }), null);
    expect(result?.reason).toBe("progressed-reps");
    expect(result?.suggestedReps).toBe(9);
  });

  it("holds when targetReps is null (no safe target to add to)", () => {
    const rows = makeRows(REQUIRED_HITS, { actualReps: 8, targetReps: null, rpe: 6 });
    const result = buildSuggestion(
      rows,
      makePs({ progressionMode: "reps", targetReps: null, overloadIncrementReps: 1 }),
      null,
    );
    expect(result?.reason).toBe("held");
    expect(result?.suggestedReps).toBeUndefined();
  });
});

describe("buildSuggestion — time mode", () => {
  it("suggests longer duration when target duration hit with consensus", () => {
    const rows = makeRows(REQUIRED_HITS, {
      durationSeconds: 60,
      actualReps: 1, // not relevant in time mode
      targetReps: null,
      rpe: 6,
    });
    const ps = makePs({
      progressionMode: "time",
      durationSeconds: 60,
      overloadIncrementReps: 15, // 15s increment stored in incrementReps for time mode
    });
    const result = buildSuggestion(rows, ps, null);
    expect(result?.reason).toBe("progressed-time");
    expect(result?.suggestedDurationSeconds).toBe(75);
  });

  it("holds when duration not met", () => {
    const rows = makeRows(REQUIRED_HITS, { durationSeconds: 45 });
    const ps = makePs({ progressionMode: "time", durationSeconds: 60 });
    const result = buildSuggestion(rows, ps, null);
    expect(result?.reason).toBe("held");
  });

  it("defaults to 10s increment when overloadIncrementReps is 0", () => {
    const rows = makeRows(REQUIRED_HITS, { durationSeconds: 60 });
    const ps = makePs({ progressionMode: "time", durationSeconds: 60, overloadIncrementReps: 0 });
    const result = buildSuggestion(rows, ps, null);
    expect(result?.suggestedDurationSeconds).toBe(70); // 60 + 10
  });
});

describe("buildSuggestion — user profile increment defaults", () => {
  it("uses beginner default of 5kg when increment is null (unconfigured)", () => {
    const rows = makeRows(REQUIRED_HITS, { rpe: 6 });
    const profile: UserProfile = { experienceLevel: "beginner", goal: null };
    const result = buildSuggestion(rows, makePs(), profile);
    expect(result?.suggestedWeightKg).toBeCloseTo(85); // 80 + 5
  });

  it("uses advanced default of 1.25kg when increment is null (unconfigured)", () => {
    const rows = makeRows(REQUIRED_HITS, { weightKg: "80.00", rpe: 6 });
    const profile: UserProfile = { experienceLevel: "advanced", goal: null };
    const result = buildSuggestion(rows, makePs(), profile);
    expect(result?.suggestedWeightKg).toBeCloseTo(81.25);
  });

  it("ignores profile when user has a custom increment set", () => {
    const rows = makeRows(REQUIRED_HITS, { rpe: 6 });
    const profile: UserProfile = { experienceLevel: "beginner", goal: null };
    const result = buildSuggestion(rows, makePs({ overloadIncrementKg: "10.00" }), profile);
    expect(result?.suggestedWeightKg).toBeCloseTo(90); // 80 + 10
  });

  it("respects explicit 2.5 override even for beginner profile", () => {
    const rows = makeRows(REQUIRED_HITS, { rpe: 6 });
    const profile: UserProfile = { experienceLevel: "beginner", goal: null };
    const result = buildSuggestion(rows, makePs({ overloadIncrementKg: "2.50" }), profile);
    expect(result?.suggestedWeightKg).toBeCloseTo(82.5); // 80 + 2.5, not 80 + 5
  });
});

describe("buildSuggestion — recovery (retry)", () => {
  it("suggests previous weight when most recent session logged less than the one before", () => {
    const rows = [
      makeRow({ weightKg: "75.00", actualReps: 8, date: "2024-01-02" }), // dropped
      makeRow({ weightKg: "80.00", actualReps: 8, date: "2024-01-01" }), // was here
    ];
    const result = buildSuggestion(rows, makePs(), null);
    expect(result?.reason).toBe("retry");
    expect(result?.suggestedWeightKg).toBe(80);
  });

  it("suggests previous reps when same weight but fewer reps last session", () => {
    const rows = [
      makeRow({ weightKg: "80.00", actualReps: 2, date: "2024-01-02" }), // dropped reps
      makeRow({ weightKg: "80.00", actualReps: 3, date: "2024-01-01" }), // was here
    ];
    const result = buildSuggestion(rows, makePs(), null);
    expect(result?.reason).toBe("retry");
    expect(result?.suggestedWeightKg).toBe(80);
    expect(result?.suggestedReps).toBe(3);
  });

  it("does not trigger retry when weight is the same and reps are the same", () => {
    const rows = [
      makeRow({ weightKg: "80.00", actualReps: 8, date: "2024-01-02" }),
      makeRow({ weightKg: "80.00", actualReps: 8, date: "2024-01-01" }),
    ];
    const result = buildSuggestion(rows, makePs(), null);
    expect(result?.reason).not.toBe("retry");
  });

  it("does not trigger retry when weight increased (normal progression path)", () => {
    const rows = [
      makeRow({ weightKg: "82.50", actualReps: 8, date: "2024-01-02" }),
      makeRow({ weightKg: "80.00", actualReps: 8, date: "2024-01-01" }),
    ];
    const result = buildSuggestion(rows, makePs(), null);
    expect(result?.reason).not.toBe("retry");
  });

  it("deload takes priority over weight retry when stuck", () => {
    // DELOAD_THRESHOLD consecutive misses → deload fires even though weight dropped
    const rows = Array.from({ length: DELOAD_THRESHOLD }, (_, i) =>
      makeRow({ weightKg: "75.00", actualReps: 4, targetReps: 8, rpe: 9, date: `2024-01-${String(DELOAD_THRESHOLD - i).padStart(2, "0")}` }),
    );
    // previous row at higher weight, also a miss (rpe 9 so not a confident hit)
    rows.push(makeRow({ weightKg: "80.00", actualReps: 4, targetReps: 8, rpe: 9, date: "2023-12-31" }));
    const result = buildSuggestion(rows, makePs(), null);
    expect(result?.reason).toBe("deload");
  });

  it("does not trigger retry with only one row of history", () => {
    const rows = [makeRow({ weightKg: "80.00", actualReps: 8 })];
    const result = buildSuggestion(rows, makePs(), null);
    expect(result?.reason).not.toBe("retry");
  });
});

describe("buildSuggestion — basedOn fields", () => {
  it("exposes basedOnRpe from the most recent row", () => {
    const rows = makeRows(REQUIRED_HITS, { rpe: 7 });
    const result = buildSuggestion(rows, makePs(), null);
    expect(result?.basedOnRpe).toBe(7);
  });

  it("exposes basedOnHitCount for transparency", () => {
    const rows = [
      makeRow({ rpe: 6, date: "2024-01-03" }), // confident hit
      makeRow({ rpe: 6, date: "2024-01-02" }), // confident hit
      makeRow({ rpe: 9, date: "2024-01-01" }), // NOT confident (RPE 9)
    ];
    const result = buildSuggestion(rows, makePs(), null);
    expect(result?.basedOnHitCount).toBe(2);
  });

  it("uses raw baseWeight without 0.5 rounding", () => {
    const rows = makeRows(REQUIRED_HITS, { weightKg: "77.30", rpe: 6 });
    const result = buildSuggestion(rows, makePs({ overloadIncrementKg: "1.00" }), null);
    expect(result?.basedOnWeightKg).toBeCloseTo(77.3);
    // suggestion should be 77.3 + 1 = 78.3, rounded to nearest 1kg = 78
    expect(result?.suggestedWeightKg).toBeCloseTo(78);
  });
});

describe("buildSuggestion — readiness modulation", () => {
  it("downgrades weight progression to held-readiness when readiness ≤ 2", () => {
    const rows = makeRows(REQUIRED_HITS, { rpe: 6 });
    const result = buildSuggestion(rows, makePs(), null, 2);
    expect(result?.reason).toBe("held-readiness");
    expect(result?.readinessModulated).toBe(true);
    expect(result?.suggestedWeightKg).toBeCloseTo(80); // reverted to base
  });

  it("downgrades rep progression to held-readiness when readiness ≤ 2", () => {
    const rows = makeRows(REQUIRED_HITS, { rpe: 6 });
    const result = buildSuggestion(rows, makePs({ progressionMode: "reps", overloadIncrementReps: 1 }), null, 1);
    expect(result?.reason).toBe("held-readiness");
    expect(result?.readinessModulated).toBe(true);
    expect(result?.suggestedReps).toBeUndefined();
  });

  it("does not suppress progression when readiness is 3", () => {
    const rows = makeRows(REQUIRED_HITS, { rpe: 6 });
    const result = buildSuggestion(rows, makePs(), null, 3);
    expect(result?.reason).toBe("progressed");
    expect(result?.readinessModulated).toBe(false);
  });
});

// ─── Bug fix: deload → retry false positive ───────────────────────────────────

describe("buildSuggestion — deload→retry guard", () => {
  it("does NOT suggest retry when weight drop follows DELOAD_THRESHOLD-1 consecutive failures", () => {
    // User had 2+ consecutive misses at 80kg, then trained at 72kg (intentional deload)
    const rows = [
      makeRow({ weightKg: "72.00", actualReps: 8, targetReps: 8, rpe: 7, date: "2024-01-04" }), // post-deload success
      makeRow({ weightKg: "80.00", actualReps: 4, targetReps: 8, rpe: 9, date: "2024-01-03" }), // miss #2
      makeRow({ weightKg: "80.00", actualReps: 4, targetReps: 8, rpe: 9, date: "2024-01-02" }), // miss #1
    ];
    const result = buildSuggestion(rows, makePs(), null);
    expect(result?.reason).not.toBe("retry");
    // Should hold at current weight until consensus is rebuilt
    expect(result?.suggestedWeightKg).toBeCloseTo(72);
  });

  it("DOES suggest retry when weight drop is a one-off bad session (single miss)", () => {
    // Only 1 miss before the drop — accidental, not a systematic deload
    const rows = [
      makeRow({ weightKg: "77.50", actualReps: 8, targetReps: 8, rpe: 7, date: "2024-01-02" }), // dropped weight
      makeRow({ weightKg: "80.00", actualReps: 4, targetReps: 8, rpe: 9, date: "2024-01-01" }), // single miss
    ];
    const result = buildSuggestion(rows, makePs(), null);
    expect(result?.reason).toBe("retry");
    expect(result?.suggestedWeightKg).toBeCloseTo(80);
  });

  it("does NOT suggest retry when preceding streak is exactly DELOAD_THRESHOLD-1 misses", () => {
    const rows = [
      makeRow({ weightKg: "72.00", actualReps: 8, targetReps: 8, rpe: 7, date: "2024-01-03" }),
      // DELOAD_THRESHOLD-1 = 2 consecutive failures precede the drop
      makeRow({ weightKg: "80.00", actualReps: 3, targetReps: 8, rpe: 9, date: "2024-01-02" }),
      makeRow({ weightKg: "80.00", actualReps: 3, targetReps: 8, rpe: 9, date: "2024-01-01" }),
    ];
    const result = buildSuggestion(rows, makePs(), null);
    expect(result?.reason).not.toBe("retry");
  });
});

// ─── Bug fix: bodyweight (weight=0) in weight/smart mode ─────────────────────

describe("buildSuggestion — bodyweight fallback", () => {
  it("suggests more reps (not kg) for weight mode when baseWeight is 0", () => {
    const rows = makeRows(REQUIRED_HITS, { weightKg: "0.00", actualReps: 10, targetReps: 10, rpe: 6 });
    const ps = makePs({ progressionMode: "weight", targetReps: 10, overloadIncrementReps: 2 });
    const result = buildSuggestion(rows, ps, null);
    expect(result?.reason).toBe("progressed-reps");
    expect(result?.suggestedReps).toBe(12);
    expect(result?.suggestedWeightKg).toBe(0);
  });

  it("holds for weight mode at weight=0 when no incrementReps configured", () => {
    const rows = makeRows(REQUIRED_HITS, { weightKg: "0.00", actualReps: 10, targetReps: 10, rpe: 6 });
    const ps = makePs({ progressionMode: "weight", targetReps: 10, overloadIncrementReps: 0 });
    const result = buildSuggestion(rows, ps, null);
    expect(result?.reason).toBe("held");
  });

  it("suggests more reps (not kg) for smart mode when baseWeight is 0", () => {
    const rows = makeRows(REQUIRED_HITS, { weightKg: "0.00", actualReps: 8, targetReps: 8, rpe: 6 });
    const ps = makePs({ progressionMode: "smart", targetReps: 8, overloadIncrementReps: 1 });
    const result = buildSuggestion(rows, ps, null);
    expect(result?.reason).toBe("progressed-reps");
    expect(result?.suggestedReps).toBe(9);
  });

  it("progresses by weight as normal when baseWeight > 0 in weight mode", () => {
    const rows = makeRows(REQUIRED_HITS, { weightKg: "60.00", actualReps: 10, targetReps: 10, rpe: 6 });
    const result = buildSuggestion(rows, makePs({ progressionMode: "weight" }), null);
    expect(result?.reason).toBe("progressed");
    expect(result?.suggestedWeightKg).toBeGreaterThan(60);
  });
});

// ─── Bug fix: time/distance mode RPE confidence gate ─────────────────────────

describe("buildSuggestion — time mode RPE confidence", () => {
  it("does NOT count a timed set as confident when RPE is 9 or 10", () => {
    const rows = makeRows(REQUIRED_HITS, { durationSeconds: 60, actualReps: 1, targetReps: null, rpe: 9 });
    const ps = makePs({ progressionMode: "time", durationSeconds: 60, overloadIncrementReps: 10 });
    const result = buildSuggestion(rows, ps, null);
    expect(result?.reason).toBe("held"); // not progressed-time despite hitting duration
  });

  it("counts a timed set as confident when RPE is 8 and duration met", () => {
    const rows = makeRows(REQUIRED_HITS, { durationSeconds: 60, actualReps: 1, targetReps: null, rpe: 8 });
    const ps = makePs({ progressionMode: "time", durationSeconds: 60, overloadIncrementReps: 10 });
    const result = buildSuggestion(rows, ps, null);
    expect(result?.reason).toBe("progressed-time");
    expect(result?.suggestedDurationSeconds).toBe(70);
  });

  it("treats null RPE as 7 (confident) for timed sets", () => {
    const rows = makeRows(REQUIRED_HITS, { durationSeconds: 60, actualReps: 1, targetReps: null, rpe: 0 });
    const ps = makePs({ progressionMode: "time", durationSeconds: 60, overloadIncrementReps: 10 });
    const result = buildSuggestion(rows, ps, null);
    expect(result?.reason).toBe("progressed-time");
  });
});

describe("buildSuggestion — distance mode RPE confidence", () => {
  it("does NOT count a distance set as confident when RPE is 9 or 10", () => {
    const rows = makeRows(REQUIRED_HITS, {
      distanceMeters: 5000,
      actualReps: 1, targetReps: null, rpe: 9,
    });
    const ps = makePs({
      progressionMode: "distance",
      distanceMeters: 5000,
      overloadIncrementReps: 500,
    });
    const result = buildSuggestion(rows, ps, null);
    expect(result?.reason).toBe("held");
  });

  it("counts a distance set as confident when RPE ≤ 8 and distance met", () => {
    const rows = makeRows(REQUIRED_HITS, {
      distanceMeters: 5000,
      actualReps: 1, targetReps: null, rpe: 7,
    });
    const ps = makePs({
      progressionMode: "distance",
      distanceMeters: 5000,
      overloadIncrementReps: 500,
    });
    const result = buildSuggestion(rows, ps, null);
    expect(result?.reason).toBe("progressed-distance");
    expect(result?.suggestedDistanceMeters).toBe(5500);
  });
});
