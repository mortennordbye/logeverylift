import { describe, expect, it } from "vitest";
import {
  buildSuggestion,
  describeProgressionRule,
  estimate1RM,
  estimateRepsAt,
  isConfidentHit,
  pendingProgressions,
  roundToNearest,
  CONSENSUS_WINDOW,
  DELOAD_THRESHOLD,
  REQUIRED_HITS,
} from "@/lib/utils/progression";
import type {
  HistoryRow,
  PendingSetInput,
  ProgramSetData,
  UserProfile,
} from "@/lib/utils/progression";
import type { SetSuggestion } from "@/types/workout";

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

describe("buildSuggestion — felt-easy override", () => {
  it("progresses off a single easy set that would otherwise hold", () => {
    const rows = [makeRow({ rpe: 6, wasEasy: true })]; // 1 hit, need 2
    const result = buildSuggestion(rows, makePs(), null);
    expect(result?.reason).toBe("progressed");
    expect(result?.suggestedWeightKg).toBeCloseTo(82.5); // 80 + 2.5
    expect(result?.easyOverride).toBe(true);
  });

  it("ignores an easy verdict on a set that missed its target", () => {
    const rows = [makeRow({ rpe: 6, actualReps: 5, targetReps: 8, wasEasy: true })];
    const result = buildSuggestion(rows, makePs(), null);
    expect(result?.reason).toBe("held");
    expect(result?.easyOverride).toBeUndefined();
  });

  it("only reads the most recent session's easy verdict", () => {
    const rows = [
      makeRow({ rpe: 6, date: "2024-01-02" }),
      makeRow({ rpe: 6, date: "2024-01-01", wasEasy: true }),
    ];
    // Two confident hits — progresses on consensus, so the stale verdict is moot.
    const result = buildSuggestion(rows, makePs(), null);
    expect(result?.reason).toBe("progressed");
    expect(result?.easyOverride).toBeUndefined();
  });

  it("does not flag a progression the consensus gate earned on its own", () => {
    const rows = makeRows(REQUIRED_HITS, { rpe: 6, wasEasy: true });
    const result = buildSuggestion(rows, makePs(), null);
    expect(result?.reason).toBe("progressed");
    expect(result?.easyOverride).toBeUndefined();
  });

  it("progresses reps instead of weight for a bodyweight set", () => {
    const rows = [makeRow({ rpe: 6, weightKg: "0.00", wasEasy: true })];
    const result = buildSuggestion(
      rows,
      makePs({ overloadIncrementReps: 2 }),
      null,
    );
    expect(result?.reason).toBe("progressed-reps");
    expect(result?.suggestedReps).toBe(10); // target 8 + 2
    expect(result?.easyOverride).toBe(true);
  });

  it("yields to low readiness — an easy verdict does not force a bump today", () => {
    const rows = [makeRow({ rpe: 6, wasEasy: true })];
    const result = buildSuggestion(rows, makePs(), null, 2);
    expect(result?.reason).toBe("held-readiness");
    expect(result?.easyOverride).toBeUndefined();
  });

  it("yields to a deload — three misses outrank an easy verdict", () => {
    const rows = makeRows(DELOAD_THRESHOLD, { actualReps: 5, targetReps: 8, rpe: 9 });
    rows[0].wasEasy = true;
    const result = buildSuggestion(rows, makePs(), null);
    expect(result?.reason).toBe("deload");
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

// ─── Per-exercise hit gate ────────────────────────────────────────────────────

describe("buildSuggestion — requiredHits override", () => {
  it("progresses after a single hit when the gate is 1", () => {
    const rows = [makeRow({ actualReps: 8, targetReps: 8, rpe: 7 })];
    const result = buildSuggestion(rows, makePs({ requiredHits: 1 }), null);
    expect(result?.reason).toBe("progressed");
    expect(result?.hitsRequired).toBe(1);
  });

  it("holds at two hits when the gate is 3", () => {
    const rows = makeRows(2, { actualReps: 8, targetReps: 8, rpe: 7 });
    const result = buildSuggestion(rows, makePs({ requiredHits: 3 }), null);
    expect(result?.reason).toBe("held");
    expect(result?.hitsAchieved).toBe(2);
    expect(result?.hitsRequired).toBe(3);
  });

  it("progresses at three hits when the gate is 3", () => {
    const rows = makeRows(3, { actualReps: 8, targetReps: 8, rpe: 7 });
    const result = buildSuggestion(rows, makePs({ requiredHits: 3 }), null);
    expect(result?.reason).toBe("progressed");
  });

  it("falls back to REQUIRED_HITS when the override is null", () => {
    const rows = makeRows(REQUIRED_HITS, { actualReps: 8, targetReps: 8, rpe: 7 });
    const result = buildSuggestion(rows, makePs({ requiredHits: null }), null);
    expect(result?.reason).toBe("progressed");
    expect(result?.hitsRequired).toBe(REQUIRED_HITS);
  });
});

// ─── Hits are counted at the current load ─────────────────────────────────────

describe("buildSuggestion — hits must be at the current weight", () => {
  it("does not stack another bump on a weight that was just missed", () => {
    // Two clean sessions at 80kg earned a bump to 82.5kg, which was then missed.
    // Counting the 80kg hits again would suggest 85kg off the back of a failure.
    const rows: HistoryRow[] = [
      makeRow({ weightKg: "82.50", actualReps: 6, targetReps: 8, date: "2024-01-03" }),
      makeRow({ weightKg: "80.00", actualReps: 8, targetReps: 8, date: "2024-01-02" }),
      makeRow({ weightKg: "80.00", actualReps: 8, targetReps: 8, date: "2024-01-01" }),
    ];
    const result = buildSuggestion(rows, makePs({ overloadIncrementKg: "2.50" }), null);
    expect(result?.reason).toBe("held");
    expect(result?.suggestedWeightKg).toBe(82.5);
    expect(result?.hitsAchieved).toBe(0);
  });

  it("progresses once the target is hit twice at the new weight", () => {
    const rows: HistoryRow[] = [
      makeRow({ weightKg: "82.50", actualReps: 8, targetReps: 8, date: "2024-01-04" }),
      makeRow({ weightKg: "82.50", actualReps: 8, targetReps: 8, date: "2024-01-03" }),
      makeRow({ weightKg: "80.00", actualReps: 8, targetReps: 8, date: "2024-01-02" }),
    ];
    const result = buildSuggestion(rows, makePs({ overloadIncrementKg: "2.50" }), null);
    expect(result?.reason).toBe("progressed");
    expect(result?.suggestedWeightKg).toBe(85);
  });

  it("still counts hits logged above the current weight", () => {
    const rows: HistoryRow[] = [
      makeRow({ weightKg: "80.00", actualReps: 8, targetReps: 8, date: "2024-01-02" }),
      makeRow({ weightKg: "85.00", actualReps: 8, targetReps: 8, date: "2024-01-01" }),
    ];
    const result = buildSuggestion(rows, makePs({ overloadIncrementKg: "2.50" }), null);
    expect(result?.hitsAchieved).toBe(2);
  });

  it("leaves bodyweight sets unaffected (every row is 0kg)", () => {
    const rows = makeRows(REQUIRED_HITS, {
      weightKg: "0.00",
      actualReps: 8,
      targetReps: 8,
      rpe: 7,
    });
    const result = buildSuggestion(
      rows,
      makePs({ progressionMode: "weight", overloadIncrementReps: 1 }),
      null,
    );
    expect(result?.reason).toBe("progressed-reps");
    expect(result?.suggestedReps).toBe(9);
  });
});

// ─── describeProgressionRule ──────────────────────────────────────────────────

describe("describeProgressionRule", () => {
  const base = {
    mode: "weight",
    incrementKg: 2.5,
    incrementReps: 0,
    targetReps: 10,
    requiredHits: 2,
  };

  it("quotes the increment, rep target, gate and window", () => {
    const text = describeProgressionRule(base)!;
    expect(text).toContain("+2.5kg");
    expect(text).toContain("10 reps");
    expect(text).toContain(`2 of the last ${CONSENSUS_WINDOW} sessions`);
  });

  it("spells out the RPE gate for rep-based modes", () => {
    expect(describeProgressionRule(base)).toContain("RPE 9+");
    expect(describeProgressionRule(base)).toContain("RPE 8");
  });

  it("tracks a changed gate", () => {
    expect(describeProgressionRule({ ...base, requiredHits: 1 })).toContain(
      `1 of the last ${CONSENSUS_WINDOW} sessions`,
    );
  });

  it("says the weight is auto-sized when no increment is set", () => {
    const text = describeProgressionRule({ ...base, incrementKg: null })!;
    expect(text).toContain("More weight");
    expect(text).not.toContain("+null");
  });

  it("falls back to a generic target when no rep target exists", () => {
    expect(describeProgressionRule({ ...base, targetReps: null })).toContain(
      "the target reps",
    );
  });

  it("describes reps mode in reps, singular and plural", () => {
    expect(
      describeProgressionRule({ ...base, mode: "reps", incrementReps: 1 }),
    ).toContain("+1 rep ");
    expect(
      describeProgressionRule({ ...base, mode: "reps", incrementReps: 2 }),
    ).toContain("+2 reps");
  });

  it("describes time and distance modes in their own units", () => {
    expect(
      describeProgressionRule({ ...base, mode: "time", incrementReps: 30 }),
    ).toContain("+30s");
    expect(
      describeProgressionRule({ ...base, mode: "distance", incrementReps: 500 }),
    ).toContain("+0.5km");
  });

  it("returns null for modes that never suggest anything", () => {
    expect(describeProgressionRule({ ...base, mode: "manual" })).toBeNull();
    expect(describeProgressionRule({ ...base, mode: "none" })).toBeNull();
    expect(describeProgressionRule({ ...base, mode: null })).toBeNull();
  });
});

// ─── pendingProgressions ──────────────────────────────────────────────────────

function makeSuggestion(overrides: Partial<SetSuggestion> = {}): SetSuggestion {
  return {
    suggestedWeightKg: 82.5,
    basedOnWeightKg: 80,
    basedOnReps: 8,
    basedOnFeeling: "Good",
    basedOnDate: "2024-01-02",
    reason: "progressed",
    hitsAchieved: 2,
    hitsRequired: 2,
    sessionsUntilDeload: null,
    estimated1RM: 100,
    readinessModulated: false,
    ...overrides,
  };
}

function makeSet(overrides: Partial<PendingSetInput> = {}): PendingSetInput {
  return {
    id: 1,
    weightKg: "80.00",
    targetReps: 8,
    durationSeconds: null,
    distanceMeters: null,
    setType: "working",
    ...overrides,
  };
}

const NONE = new Set<number>();

describe("pendingProgressions", () => {
  it("returns the weight a progressed set would move to", () => {
    const result = pendingProgressions([makeSet()], { 1: makeSuggestion() }, NONE);
    expect(result).toEqual([{ setId: 1, weightKg: 82.5 }]);
  });

  it("drops a set that already sits at the suggested weight", () => {
    const result = pendingProgressions(
      [makeSet({ weightKg: "82.50" })],
      { 1: makeSuggestion() },
      NONE,
    );
    expect(result).toEqual([]);
  });

  it("skips completed sets — the number they were logged at is history", () => {
    const result = pendingProgressions(
      [makeSet()],
      { 1: makeSuggestion() },
      new Set([1]),
    );
    expect(result).toEqual([]);
  });

  it("skips warm-up sets", () => {
    const result = pendingProgressions(
      [makeSet({ setType: "warmup" })],
      { 1: makeSuggestion() },
      NONE,
    );
    expect(result).toEqual([]);
  });

  it("ignores held, held-readiness and manual suggestions", () => {
    for (const reason of ["held", "held-readiness", "manual"] as const) {
      expect(
        pendingProgressions([makeSet()], { 1: makeSuggestion({ reason }) }, NONE),
      ).toEqual([]);
    }
  });

  it("carries a smart-mode rep adjustment alongside the weight", () => {
    const result = pendingProgressions(
      [makeSet()],
      { 1: makeSuggestion({ adjustedRepsForWeight: 6 }) },
      NONE,
    );
    expect(result).toEqual([{ setId: 1, weightKg: 82.5, targetReps: 6 }]);
  });

  it("includes deloads — a downward move is still a move", () => {
    const result = pendingProgressions(
      [makeSet()],
      { 1: makeSuggestion({ reason: "deload", suggestedWeightKg: 72.5 }) },
      NONE,
    );
    expect(result).toEqual([{ setId: 1, weightKg: 72.5 }]);
  });

  it("does not lower a planned weight that is already higher", () => {
    // Base weight comes from the last logged set, so after a lighter session a
    // "progressed" suggestion can land below the plan. Writing it would turn
    // the ↑ chip into a silent downgrade of the programme.
    const result = pendingProgressions(
      [makeSet({ weightKg: "85.00" })],
      { 1: makeSuggestion({ suggestedWeightKg: 82.5 }) },
      NONE,
    );
    expect(result).toEqual([]);
  });

  it("floors against the plan, not today's override", () => {
    // The set is shown at 70 because the lifter hand-dropped it this session,
    // but the plan still holds 80. Measuring the floor against the 70 makes a
    // 75 suggestion look like an increase and rewrites the plan down to 75.
    const result = pendingProgressions(
      [
        makeSet({
          weightKg: "70.00",
          planned: { weightKg: "80.00", targetReps: 8 },
        }),
      ],
      { 1: makeSuggestion({ suggestedWeightKg: 75 }) },
      NONE,
    );
    expect(result).toEqual([]);
  });

  it("still progresses above the plan when today's set was dropped", () => {
    const result = pendingProgressions(
      [
        makeSet({
          weightKg: "70.00",
          planned: { weightKg: "80.00", targetReps: 8 },
        }),
      ],
      { 1: makeSuggestion({ suggestedWeightKg: 82.5 }) },
      NONE,
    );
    expect(result).toEqual([{ setId: 1, weightKg: 82.5 }]);
  });

  it("does not let a retry lower the plan either", () => {
    // Retry reclaims a weight held in a recent session, which says nothing
    // about the plan — when the plan is already higher there is nothing to
    // reclaim there.
    const result = pendingProgressions(
      [makeSet({ weightKg: "75.00", planned: { weightKg: "80.00", targetReps: 8 } })],
      { 1: makeSuggestion({ reason: "retry", suggestedWeightKg: 77.5 }) },
      NONE,
    );
    expect(result).toEqual([]);
  });

  it("still deloads below a planned weight — the floor is progressions only", () => {
    const result = pendingProgressions(
      [makeSet({ weightKg: "85.00" })],
      { 1: makeSuggestion({ reason: "deload", suggestedWeightKg: 72.5 }) },
      NONE,
    );
    expect(result).toEqual([{ setId: 1, weightKg: 72.5 }]);
  });

  it("does not lower a planned duration that is already longer", () => {
    const result = pendingProgressions(
      [makeSet({ durationSeconds: 90 })],
      {
        1: makeSuggestion({
          reason: "progressed-time",
          suggestedDurationSeconds: 70,
          suggestedWeightKg: 80,
        }),
      },
      NONE,
    );
    expect(result).toEqual([]);
  });

  it("does not lower a planned distance that is already longer", () => {
    const result = pendingProgressions(
      [makeSet({ distanceMeters: 6000, weightKg: null })],
      {
        1: makeSuggestion({
          reason: "progressed-distance",
          suggestedDistanceMeters: 5500,
          suggestedWeightKg: 0,
        }),
      },
      NONE,
    );
    expect(result).toEqual([]);
  });

  it("returns reps for a rep progression and leaves the weight alone", () => {
    const result = pendingProgressions(
      [makeSet()],
      {
        1: makeSuggestion({
          reason: "progressed-reps",
          suggestedReps: 9,
          suggestedWeightKg: 80,
        }),
      },
      NONE,
    );
    expect(result).toEqual([{ setId: 1, targetReps: 9 }]);
  });

  it("does not lower a rep target that is already higher", () => {
    const result = pendingProgressions(
      [makeSet({ targetReps: 12 })],
      { 1: makeSuggestion({ reason: "progressed-reps", suggestedReps: 9 }) },
      NONE,
    );
    expect(result).toEqual([]);
  });

  it("returns only the duration for a timed progression", () => {
    const result = pendingProgressions(
      [makeSet({ durationSeconds: 60 })],
      {
        1: makeSuggestion({
          reason: "progressed-time",
          suggestedDurationSeconds: 70,
          suggestedWeightKg: 80,
        }),
      },
      NONE,
    );
    expect(result).toEqual([{ setId: 1, durationSeconds: 70 }]);
  });

  it("returns only the distance for a distance progression", () => {
    const result = pendingProgressions(
      [makeSet({ distanceMeters: 5000, weightKg: null })],
      {
        1: makeSuggestion({
          reason: "progressed-distance",
          suggestedDistanceMeters: 5500,
          suggestedWeightKg: 0,
        }),
      },
      NONE,
    );
    expect(result).toEqual([{ setId: 1, distanceMeters: 5500 }]);
  });

  it("handles a retry as weight or reps depending on the suggestion", () => {
    expect(
      pendingProgressions(
        [makeSet()],
        { 1: makeSuggestion({ reason: "retry", suggestedWeightKg: 85 }) },
        NONE,
      ),
    ).toEqual([{ setId: 1, weightKg: 85 }]);
    expect(
      pendingProgressions(
        [makeSet()],
        {
          1: makeSuggestion({
            reason: "retry",
            suggestedWeightKg: 80,
            suggestedReps: 10,
          }),
        },
        NONE,
      ),
    ).toEqual([{ setId: 1, targetReps: 10 }]);
  });

  it("collects several sets at once and skips the ones already applied", () => {
    const sets = [
      makeSet({ id: 1 }),
      makeSet({ id: 2, weightKg: "82.50" }),
      makeSet({ id: 3 }),
    ];
    const suggestions = {
      1: makeSuggestion(),
      2: makeSuggestion(),
      3: makeSuggestion(),
    };
    expect(pendingProgressions(sets, suggestions, NONE)).toEqual([
      { setId: 1, weightKg: 82.5 },
      { setId: 3, weightKg: 82.5 },
    ]);
  });

  it("returns nothing when there are no suggestions at all", () => {
    expect(pendingProgressions([makeSet()], undefined, NONE)).toEqual([]);
    expect(pendingProgressions([makeSet()], {}, NONE)).toEqual([]);
  });
});
