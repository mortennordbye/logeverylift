import { describe, expect, it } from "vitest";
import {
  adaptiveIncrementKg,
  buildSuggestion,
  describeProgressionRule,
  estimate1RM,
  metTargetReps,
  pendingProgressions,
  roundToNearest,
  DELOAD_THRESHOLD,
  REQUIRED_HITS,
} from "@/lib/utils/progression";
import type {
  LoggedSet,
  PendingSetInput,
  ProgramSetData,
  SessionHistory,
  UserProfile,
} from "@/lib/utils/progression";
import type { SetSuggestion } from "@/types/workout";

// ─── Test helpers ──────────────────────────────────────────────────────────────

/** Session-level fields, alongside the single set's own. */
type SessionOverrides = Partial<LoggedSet> & {
  date?: string;
  feeling?: string | null;
  prescribedWorkingSets?: number | null;
};

/** A completed session in which one working set was logged. */
function makeSession(overrides: SessionOverrides = {}): SessionHistory {
  const { date, feeling, prescribedWorkingSets, ...set } = overrides;
  return {
    date: date ?? "2024-01-01",
    feeling: feeling === undefined ? "Good" : feeling,
    prescribedWorkingSets:
      prescribedWorkingSets === undefined ? 1 : prescribedWorkingSets,
    sets: [makeLoggedSet(set)],
  };
}

function makeLoggedSet(overrides: Partial<LoggedSet> = {}): LoggedSet {
  return {
    setNumber: 1,
    actualReps: 8,
    targetReps: 8,
    weightKg: "80.00",
    durationSeconds: null,
    rpe: 7,
    ...overrides,
  };
}

/** A session holding several working sets, numbered from 1. */
function makeMultiSession(
  sets: Partial<LoggedSet>[],
  overrides: {
    date?: string;
    feeling?: string | null;
    prescribedWorkingSets?: number | null;
  } = {},
): SessionHistory {
  return {
    date: overrides.date ?? "2024-01-01",
    feeling: overrides.feeling === undefined ? "Good" : overrides.feeling,
    prescribedWorkingSets:
      overrides.prescribedWorkingSets === undefined
        ? sets.length
        : overrides.prescribedWorkingSets,
    sets: sets.map((s, i) => makeLoggedSet({ setNumber: i + 1, ...s })),
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
    advance: "load",
    ...overrides,
  };
}

/** Build N identical sessions, newest first (dates 2024-01-0N, 2024-01-0N-1, …) */
function makeSessions(
  n: number,
  override: SessionOverrides = {},
): SessionHistory[] {
  return Array.from({ length: n }, (_, i) =>
    makeSession({ ...override, date: `2024-01-${String(n - i).padStart(2, "0")}` }),
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

// ─── metTargetReps ────────────────────────────────────────────────────────────

describe("metTargetReps", () => {
  it("returns true when the target was met, whatever the effort", () => {
    expect(metTargetReps(makeLoggedSet({ rpe: 6, actualReps: 8, targetReps: 8 }), 8)).toBe(true);
    expect(metTargetReps(makeLoggedSet({ rpe: 8, actualReps: 8, targetReps: 8 }), 8)).toBe(true);
    expect(metTargetReps(makeLoggedSet({ rpe: 10, actualReps: 8, targetReps: 8 }), 8)).toBe(true);
  });

  it("returns true when no effort was logged", () => {
    expect(metTargetReps(makeLoggedSet({ rpe: null, actualReps: 8, targetReps: 8 }), 8)).toBe(true);
  });

  it("returns false when target reps not met", () => {
    expect(metTargetReps(makeLoggedSet({ rpe: 6, actualReps: 6, targetReps: 8 }), 8)).toBe(false);
  });

  it("returns true for null targets when reps > 0 (open-ended sets clear on any rep)", () => {
    expect(metTargetReps(makeLoggedSet({ rpe: 6, actualReps: 8, targetReps: null }), null)).toBe(true);
    expect(metTargetReps(makeLoggedSet({ rpe: null, actualReps: 8, targetReps: null }), null)).toBe(true);
  });

  it("returns false for null targets when actualReps = 0 (nothing performed)", () => {
    expect(metTargetReps(makeLoggedSet({ rpe: 6, actualReps: 0, targetReps: null }), null)).toBe(false);
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
    const rows = [makeSession({ rpe: 6 })]; // 1 hit, need 2
    const result = buildSuggestion(rows, makePs(), null);
    expect(result?.reason).toBe("held");
  });

  it("progresses when REQUIRED_HITS sessions hit target with confidence", () => {
    const rows = makeSessions(REQUIRED_HITS, { rpe: 6, actualReps: 8, targetReps: 8 });
    const result = buildSuggestion(rows, makePs(), null);
    expect(result?.reason).toBe("progressed");
    expect(result?.suggestedWeightKg).toBeCloseTo(82.5); // 80 + 2.5
  });

  it("progresses when the last session was a grind, as long as the target was met", () => {
    const rows = [
      makeSession({ rpe: 10, actualReps: 8, date: "2024-01-03" }),
      makeSession({ rpe: 6,  actualReps: 8, date: "2024-01-02" }),
      makeSession({ rpe: 6,  actualReps: 8, date: "2024-01-01" }),
    ];
    const result = buildSuggestion(rows, makePs(), null);
    expect(result?.reason).toBe("progressed");
  });

  it("progresses off hits the retired RPE ladder would have rejected", () => {
    // Three sessions at the target, all logged RIR 1. The old absolute ladder
    // held these forever; a prescribed RIR cap is how a lifter asks for that
    // now, and no exercise carries one.
    const rows = makeSessions(3, { rpe: 9, actualReps: 8, targetReps: 8 });
    const result = buildSuggestion(rows, makePs(), null);
    expect(result?.reason).toBe("progressed");
  });

  it("counts sessions with no effort logged", () => {
    const rows = makeSessions(REQUIRED_HITS, { rpe: null, actualReps: 8, targetReps: 8 });
    const result = buildSuggestion(rows, makePs(), null);
    expect(result?.reason).toBe("progressed");
  });
});

describe("buildSuggestion — felt-easy override", () => {
  it("progresses off a single easy set that would otherwise hold", () => {
    const rows = [makeSession({ rpe: 6, wasEasy: true })]; // 1 hit, need 2
    const result = buildSuggestion(rows, makePs(), null);
    expect(result?.reason).toBe("progressed");
    expect(result?.suggestedWeightKg).toBeCloseTo(82.5); // 80 + 2.5
    expect(result?.easyOverride).toBe(true);
  });

  it("ignores an easy verdict on a set that missed its target", () => {
    const rows = [makeSession({ rpe: 6, actualReps: 5, targetReps: 8, wasEasy: true })];
    const result = buildSuggestion(rows, makePs(), null);
    expect(result?.reason).toBe("held");
    expect(result?.easyOverride).toBeUndefined();
  });

  it("only reads the most recent session's easy verdict", () => {
    const rows = [
      makeSession({ rpe: 6, date: "2024-01-02" }),
      makeSession({ rpe: 6, date: "2024-01-01", wasEasy: true }),
    ];
    // Two confident hits — progresses on consensus, so the stale verdict is moot.
    const result = buildSuggestion(rows, makePs(), null);
    expect(result?.reason).toBe("progressed");
    expect(result?.easyOverride).toBeUndefined();
  });

  it("does not flag a progression the consensus gate earned on its own", () => {
    const rows = makeSessions(REQUIRED_HITS, { rpe: 6, wasEasy: true });
    const result = buildSuggestion(rows, makePs(), null);
    expect(result?.reason).toBe("progressed");
    expect(result?.easyOverride).toBeUndefined();
  });

  it("progresses reps instead of weight for a bodyweight set", () => {
    const rows = [makeSession({ rpe: 6, weightKg: "0.00", wasEasy: true })];
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
    const rows = [makeSession({ rpe: 6, wasEasy: true })];
    const result = buildSuggestion(rows, makePs(), null, 2);
    expect(result?.reason).toBe("held-readiness");
    expect(result?.easyOverride).toBeUndefined();
  });

  it("yields to a deload — three misses outrank an easy verdict", () => {
    const rows = makeSessions(DELOAD_THRESHOLD, { actualReps: 5, targetReps: 8, rpe: 9 });
    rows[0].sets[0].wasEasy = true;
    const result = buildSuggestion(rows, makePs(), null);
    expect(result?.reason).toBe("deload");
  });
});

describe("buildSuggestion — deload detection", () => {
  it("suggests deload after DELOAD_THRESHOLD consecutive failures", () => {
    const rows = makeSessions(DELOAD_THRESHOLD, { actualReps: 5, targetReps: 8, rpe: 9 });
    const result = buildSuggestion(rows, makePs(), null);
    expect(result?.reason).toBe("deload");
    // 10% deload: 80 * 0.9 = 72, rounded to nearest 2.5 = 72.5
    expect(result?.suggestedWeightKg).toBeCloseTo(72.5);
  });

  it("does not deload with fewer than DELOAD_THRESHOLD rows", () => {
    const rows = makeSessions(DELOAD_THRESHOLD - 1, { actualReps: 5, targetReps: 8 });
    const result = buildSuggestion(rows, makePs(), null);
    expect(result?.reason).toBe("held");
  });

  it("does not deload in manual mode", () => {
    const rows = makeSessions(DELOAD_THRESHOLD, { actualReps: 5, targetReps: 8 });
    const result = buildSuggestion(rows, makePs({ advance: "manual" }), null);
    expect(result?.reason).toBe("manual");
  });
});

describe("buildSuggestion — reps mode", () => {
  it("increments reps when target hit with consensus", () => {
    const rows = makeSessions(REQUIRED_HITS, { actualReps: 8, targetReps: 8, rpe: 6 });
    const result = buildSuggestion(rows, makePs({ advance: "reps", overloadIncrementReps: 1 }), null);
    expect(result?.reason).toBe("progressed-reps");
    expect(result?.suggestedReps).toBe(9);
  });

  it("holds when targetReps is null (no safe target to add to)", () => {
    const rows = makeSessions(REQUIRED_HITS, { actualReps: 8, targetReps: null, rpe: 6 });
    const result = buildSuggestion(
      rows,
      makePs({ advance: "reps", targetReps: null, overloadIncrementReps: 1 }),
      null,
    );
    expect(result?.reason).toBe("held");
    expect(result?.suggestedReps).toBeUndefined();
  });
});

describe("buildSuggestion — time mode", () => {
  it("suggests longer duration when target duration hit with consensus", () => {
    const rows = makeSessions(REQUIRED_HITS, {
      durationSeconds: 60,
      actualReps: 1, // not relevant in time mode
      targetReps: null,
      rpe: 6,
    });
    const ps = makePs({
      advance: "duration",
      durationSeconds: 60,
      overloadIncrementReps: 15, // 15s increment stored in incrementReps for time mode
    });
    const result = buildSuggestion(rows, ps, null);
    expect(result?.reason).toBe("progressed-time");
    expect(result?.suggestedDurationSeconds).toBe(75);
  });

  it("holds when duration not met", () => {
    const rows = makeSessions(REQUIRED_HITS, { durationSeconds: 45 });
    const ps = makePs({ advance: "duration", durationSeconds: 60 });
    const result = buildSuggestion(rows, ps, null);
    expect(result?.reason).toBe("held");
  });

  it("defaults to 10s increment when overloadIncrementReps is 0", () => {
    const rows = makeSessions(REQUIRED_HITS, { durationSeconds: 60 });
    const ps = makePs({ advance: "duration", durationSeconds: 60, overloadIncrementReps: 0 });
    const result = buildSuggestion(rows, ps, null);
    expect(result?.suggestedDurationSeconds).toBe(70); // 60 + 10
  });
});

describe("buildSuggestion — user profile increment defaults", () => {
  it("uses beginner default of 5kg when increment is null (unconfigured)", () => {
    const rows = makeSessions(REQUIRED_HITS, { rpe: 6 });
    const profile: UserProfile = { experienceLevel: "beginner", goal: null };
    const result = buildSuggestion(rows, makePs(), profile);
    expect(result?.suggestedWeightKg).toBeCloseTo(85); // 80 + 5
  });

  it("uses advanced default of 1.25kg when increment is null (unconfigured)", () => {
    const rows = makeSessions(REQUIRED_HITS, { weightKg: "80.00", rpe: 6 });
    const profile: UserProfile = { experienceLevel: "advanced", goal: null };
    const result = buildSuggestion(rows, makePs(), profile);
    expect(result?.suggestedWeightKg).toBeCloseTo(81.25);
  });

  it("ignores profile when user has a custom increment set", () => {
    const rows = makeSessions(REQUIRED_HITS, { rpe: 6 });
    const profile: UserProfile = { experienceLevel: "beginner", goal: null };
    const result = buildSuggestion(rows, makePs({ overloadIncrementKg: "10.00" }), profile);
    expect(result?.suggestedWeightKg).toBeCloseTo(90); // 80 + 10
  });

  it("respects explicit 2.5 override even for beginner profile", () => {
    const rows = makeSessions(REQUIRED_HITS, { rpe: 6 });
    const profile: UserProfile = { experienceLevel: "beginner", goal: null };
    const result = buildSuggestion(rows, makePs({ overloadIncrementKg: "2.50" }), profile);
    expect(result?.suggestedWeightKg).toBeCloseTo(82.5); // 80 + 2.5, not 80 + 5
  });
});

describe("buildSuggestion — recovery (retry)", () => {
  it("suggests previous weight when most recent session logged less than the one before", () => {
    const rows = [
      makeSession({ weightKg: "75.00", actualReps: 8, date: "2024-01-02" }), // dropped
      makeSession({ weightKg: "80.00", actualReps: 8, date: "2024-01-01" }), // was here
    ];
    const result = buildSuggestion(rows, makePs(), null);
    expect(result?.reason).toBe("retry");
    expect(result?.suggestedWeightKg).toBe(80);
  });

  it("suggests previous reps when same weight but fewer reps last session", () => {
    const rows = [
      makeSession({ weightKg: "80.00", actualReps: 9, date: "2024-01-02" }), // dropped reps
      makeSession({ weightKg: "80.00", actualReps: 10, date: "2024-01-01" }), // was here
    ];
    const result = buildSuggestion(rows, makePs(), null);
    expect(result?.reason).toBe("retry");
    expect(result?.suggestedWeightKg).toBe(80);
    expect(result?.suggestedReps).toBe(10);
  });

  it("does not dress an ordinary miss up as a rep retry", () => {
    // 12 then 10 against a fixed target of 12: there is no ground above the
    // prescription to reclaim, so this is a missed session, not a retry. Only
    // honest rep logging makes this branch reachable at all, which is why the
    // rule needed the extra clause.
    const rows = [
      makeSession({ weightKg: "80.00", actualReps: 10, targetReps: 12, date: "2024-01-02" }),
      makeSession({ weightKg: "80.00", actualReps: 12, targetReps: 12, date: "2024-01-01" }),
    ];
    const result = buildSuggestion(rows, makePs({ targetReps: 12 }), null);
    expect(result?.reason).toBe("held");
    expect(result?.suggestedReps).toBeUndefined();
  });

  it("does not trigger retry when weight is the same and reps are the same", () => {
    const rows = [
      makeSession({ weightKg: "80.00", actualReps: 8, date: "2024-01-02" }),
      makeSession({ weightKg: "80.00", actualReps: 8, date: "2024-01-01" }),
    ];
    const result = buildSuggestion(rows, makePs(), null);
    expect(result?.reason).not.toBe("retry");
  });

  it("does not trigger retry when weight increased (normal progression path)", () => {
    const rows = [
      makeSession({ weightKg: "82.50", actualReps: 8, date: "2024-01-02" }),
      makeSession({ weightKg: "80.00", actualReps: 8, date: "2024-01-01" }),
    ];
    const result = buildSuggestion(rows, makePs(), null);
    expect(result?.reason).not.toBe("retry");
  });

  it("deload takes priority over weight retry when stuck", () => {
    // DELOAD_THRESHOLD consecutive misses → deload fires even though weight dropped
    const rows = Array.from({ length: DELOAD_THRESHOLD }, (_, i) =>
      makeSession({ weightKg: "75.00", actualReps: 4, targetReps: 8, rpe: 9, date: `2024-01-${String(DELOAD_THRESHOLD - i).padStart(2, "0")}` }),
    );
    // previous row at higher weight, also a miss (rpe 9 so not a confident hit)
    rows.push(makeSession({ weightKg: "80.00", actualReps: 4, targetReps: 8, rpe: 9, date: "2023-12-31" }));
    const result = buildSuggestion(rows, makePs(), null);
    expect(result?.reason).toBe("deload");
  });

  it("does not trigger retry with only one row of history", () => {
    const rows = [makeSession({ weightKg: "80.00", actualReps: 8 })];
    const result = buildSuggestion(rows, makePs(), null);
    expect(result?.reason).not.toBe("retry");
  });
});

describe("buildSuggestion — basedOn fields", () => {
  it("exposes basedOnRpe from the most recent row", () => {
    const rows = makeSessions(REQUIRED_HITS, { rpe: 7 });
    const result = buildSuggestion(rows, makePs(), null);
    expect(result?.basedOnRpe).toBe(7);
  });

  it("exposes basedOnHitCount for transparency", () => {
    const rows = [
      makeSession({ rpe: 6, date: "2024-01-03" }), // hit
      makeSession({ rpe: 6, date: "2024-01-02" }), // hit
      makeSession({ rpe: 9, actualReps: 6, date: "2024-01-01" }), // short of target
    ];
    const result = buildSuggestion(rows, makePs(), null);
    expect(result?.basedOnHitCount).toBe(2);
  });

  it("uses raw baseWeight without 0.5 rounding", () => {
    const rows = makeSessions(REQUIRED_HITS, { weightKg: "77.30", rpe: 6 });
    const result = buildSuggestion(rows, makePs({ overloadIncrementKg: "1.00" }), null);
    expect(result?.basedOnWeightKg).toBeCloseTo(77.3);
    // suggestion should be 77.3 + 1 = 78.3, rounded to nearest 1kg = 78
    expect(result?.suggestedWeightKg).toBeCloseTo(78);
  });
});

describe("buildSuggestion — readiness modulation", () => {
  it("downgrades weight progression to held-readiness when readiness ≤ 2", () => {
    const rows = makeSessions(REQUIRED_HITS, { rpe: 6 });
    const result = buildSuggestion(rows, makePs(), null, 2);
    expect(result?.reason).toBe("held-readiness");
    expect(result?.readinessModulated).toBe(true);
    expect(result?.suggestedWeightKg).toBeCloseTo(80); // reverted to base
  });

  it("downgrades rep progression to held-readiness when readiness ≤ 2", () => {
    const rows = makeSessions(REQUIRED_HITS, { rpe: 6 });
    const result = buildSuggestion(rows, makePs({ advance: "reps", overloadIncrementReps: 1 }), null, 1);
    expect(result?.reason).toBe("held-readiness");
    expect(result?.readinessModulated).toBe(true);
    expect(result?.suggestedReps).toBeUndefined();
  });

  it("does not suppress progression when readiness is 3", () => {
    const rows = makeSessions(REQUIRED_HITS, { rpe: 6 });
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
      makeSession({ weightKg: "72.00", actualReps: 8, targetReps: 8, rpe: 7, date: "2024-01-04" }), // post-deload success
      makeSession({ weightKg: "80.00", actualReps: 4, targetReps: 8, rpe: 9, date: "2024-01-03" }), // miss #2
      makeSession({ weightKg: "80.00", actualReps: 4, targetReps: 8, rpe: 9, date: "2024-01-02" }), // miss #1
    ];
    const result = buildSuggestion(rows, makePs(), null);
    expect(result?.reason).not.toBe("retry");
    // Should hold at current weight until consensus is rebuilt
    expect(result?.suggestedWeightKg).toBeCloseTo(72);
  });

  it("DOES suggest retry when weight drop is a one-off bad session (single miss)", () => {
    // Only 1 miss before the drop — accidental, not a systematic deload
    const rows = [
      makeSession({ weightKg: "77.50", actualReps: 8, targetReps: 8, rpe: 7, date: "2024-01-02" }), // dropped weight
      makeSession({ weightKg: "80.00", actualReps: 4, targetReps: 8, rpe: 9, date: "2024-01-01" }), // single miss
    ];
    const result = buildSuggestion(rows, makePs(), null);
    expect(result?.reason).toBe("retry");
    expect(result?.suggestedWeightKg).toBeCloseTo(80);
  });

  it("does NOT suggest retry when preceding streak is exactly DELOAD_THRESHOLD-1 misses", () => {
    const rows = [
      makeSession({ weightKg: "72.00", actualReps: 8, targetReps: 8, rpe: 7, date: "2024-01-03" }),
      // DELOAD_THRESHOLD-1 = 2 consecutive failures precede the drop
      makeSession({ weightKg: "80.00", actualReps: 3, targetReps: 8, rpe: 9, date: "2024-01-02" }),
      makeSession({ weightKg: "80.00", actualReps: 3, targetReps: 8, rpe: 9, date: "2024-01-01" }),
    ];
    const result = buildSuggestion(rows, makePs(), null);
    expect(result?.reason).not.toBe("retry");
  });
});

// ─── Bug fix: bodyweight (weight=0) in weight/smart mode ─────────────────────

describe("buildSuggestion — bodyweight fallback", () => {
  it("suggests more reps (not kg) for weight mode when baseWeight is 0", () => {
    const rows = makeSessions(REQUIRED_HITS, { weightKg: "0.00", actualReps: 10, targetReps: 10, rpe: 6 });
    const ps = makePs({ advance: "load", targetReps: 10, overloadIncrementReps: 2 });
    const result = buildSuggestion(rows, ps, null);
    expect(result?.reason).toBe("progressed-reps");
    expect(result?.suggestedReps).toBe(12);
    expect(result?.suggestedWeightKg).toBe(0);
  });

  it("adds one rep at weight=0 when no rep increment is configured", () => {
    // SI-D5: the column defaults to 0 and nothing in the app ever set it, so
    // this used to hold forever — a bodyweight exercise could not progress out
    // of the box. One rep is the smallest honest move the dimension has.
    const rows = makeSessions(REQUIRED_HITS, { weightKg: "0.00", actualReps: 10, targetReps: 10, rpe: 6 });
    const ps = makePs({ advance: "load", targetReps: 10, overloadIncrementReps: 0 });
    const result = buildSuggestion(rows, ps, null);
    expect(result?.reason).toBe("progressed-reps");
    expect(result?.suggestedReps).toBe(11);
  });

  it("still stops a bodyweight climb at the top of a configured range", () => {
    const rows = makeSessions(REQUIRED_HITS, { weightKg: "0.00", actualReps: 15, targetReps: 15, rpe: 6 });
    const ps = makePs({
      advance: "load",
      targetReps: 15,
      repRangeMax: 15,
      overloadIncrementReps: 0,
    });
    expect(buildSuggestion(rows, ps, null)?.reason).toBe("held");
  });

  it("suggests more reps (not kg) for smart mode when baseWeight is 0", () => {
    const rows = makeSessions(REQUIRED_HITS, { weightKg: "0.00", actualReps: 8, targetReps: 8, rpe: 6 });
    const ps = makePs({ advance: "load", targetReps: 8, overloadIncrementReps: 1 });
    const result = buildSuggestion(rows, ps, null);
    expect(result?.reason).toBe("progressed-reps");
    expect(result?.suggestedReps).toBe(9);
  });

  it("progresses by weight as normal when baseWeight > 0 in weight mode", () => {
    const rows = makeSessions(REQUIRED_HITS, { weightKg: "60.00", actualReps: 10, targetReps: 10, rpe: 6 });
    const result = buildSuggestion(rows, makePs({ advance: "load" }), null);
    expect(result?.reason).toBe("progressed");
    expect(result?.suggestedWeightKg).toBeGreaterThan(60);
  });
});

// ─── Time/distance modes clear on the target alone ───────────────────────────

describe("buildSuggestion — time mode effort", () => {
  it("counts a timed set that hit its duration at RPE 9", () => {
    const rows = makeSessions(REQUIRED_HITS, { durationSeconds: 60, actualReps: 1, targetReps: null, rpe: 9 });
    const ps = makePs({ advance: "duration", durationSeconds: 60, overloadIncrementReps: 10 });
    const result = buildSuggestion(rows, ps, null);
    expect(result?.reason).toBe("progressed-time");
  });

  it("counts a timed set as a hit when RPE is 8 and duration met", () => {
    const rows = makeSessions(REQUIRED_HITS, { durationSeconds: 60, actualReps: 1, targetReps: null, rpe: 8 });
    const ps = makePs({ advance: "duration", durationSeconds: 60, overloadIncrementReps: 10 });
    const result = buildSuggestion(rows, ps, null);
    expect(result?.reason).toBe("progressed-time");
    expect(result?.suggestedDurationSeconds).toBe(70);
  });

  it("counts a timed set with no effort logged", () => {
    const rows = makeSessions(REQUIRED_HITS, { durationSeconds: 60, actualReps: 1, targetReps: null, rpe: null });
    const ps = makePs({ advance: "duration", durationSeconds: 60, overloadIncrementReps: 10 });
    const result = buildSuggestion(rows, ps, null);
    expect(result?.reason).toBe("progressed-time");
  });
});

describe("buildSuggestion — distance mode effort", () => {
  it("counts a distance set that covered its target at RPE 9", () => {
    const rows = makeSessions(REQUIRED_HITS, {
      distanceMeters: 5000,
      actualReps: 1, targetReps: null, rpe: 9,
    });
    const ps = makePs({
      advance: "distance",
      distanceMeters: 5000,
      overloadIncrementReps: 500,
    });
    const result = buildSuggestion(rows, ps, null);
    expect(result?.reason).toBe("progressed-distance");
  });

  it("counts a distance set as a hit when RPE ≤ 8 and distance met", () => {
    const rows = makeSessions(REQUIRED_HITS, {
      distanceMeters: 5000,
      actualReps: 1, targetReps: null, rpe: 7,
    });
    const ps = makePs({
      advance: "distance",
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
    const rows = [makeSession({ actualReps: 8, targetReps: 8, rpe: 7 })];
    const result = buildSuggestion(rows, makePs({ requiredHits: 1 }), null);
    expect(result?.reason).toBe("progressed");
    expect(result?.hitsRequired).toBe(1);
  });

  it("holds at two hits when the gate is 3", () => {
    const rows = makeSessions(2, { actualReps: 8, targetReps: 8, rpe: 7 });
    const result = buildSuggestion(rows, makePs({ requiredHits: 3 }), null);
    expect(result?.reason).toBe("held");
    expect(result?.hitsAchieved).toBe(2);
    expect(result?.hitsRequired).toBe(3);
  });

  it("progresses at three hits when the gate is 3", () => {
    const rows = makeSessions(3, { actualReps: 8, targetReps: 8, rpe: 7 });
    const result = buildSuggestion(rows, makePs({ requiredHits: 3 }), null);
    expect(result?.reason).toBe("progressed");
  });

  it("falls back to REQUIRED_HITS when the override is null", () => {
    const rows = makeSessions(REQUIRED_HITS, { actualReps: 8, targetReps: 8, rpe: 7 });
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
    const rows: SessionHistory[] = [
      makeSession({ weightKg: "82.50", actualReps: 6, targetReps: 8, date: "2024-01-03" }),
      makeSession({ weightKg: "80.00", actualReps: 8, targetReps: 8, date: "2024-01-02" }),
      makeSession({ weightKg: "80.00", actualReps: 8, targetReps: 8, date: "2024-01-01" }),
    ];
    const result = buildSuggestion(rows, makePs({ overloadIncrementKg: "2.50" }), null);
    expect(result?.reason).toBe("held");
    expect(result?.suggestedWeightKg).toBe(82.5);
    expect(result?.hitsAchieved).toBe(0);
  });

  it("progresses once the target is hit twice at the new weight", () => {
    const rows: SessionHistory[] = [
      makeSession({ weightKg: "82.50", actualReps: 8, targetReps: 8, date: "2024-01-04" }),
      makeSession({ weightKg: "82.50", actualReps: 8, targetReps: 8, date: "2024-01-03" }),
      makeSession({ weightKg: "80.00", actualReps: 8, targetReps: 8, date: "2024-01-02" }),
    ];
    const result = buildSuggestion(rows, makePs({ overloadIncrementKg: "2.50" }), null);
    expect(result?.reason).toBe("progressed");
    expect(result?.suggestedWeightKg).toBe(85);
  });

  it("still counts hits logged above the current weight", () => {
    const rows: SessionHistory[] = [
      makeSession({ weightKg: "80.00", actualReps: 8, targetReps: 8, date: "2024-01-02" }),
      makeSession({ weightKg: "85.00", actualReps: 8, targetReps: 8, date: "2024-01-01" }),
    ];
    const result = buildSuggestion(rows, makePs({ overloadIncrementKg: "2.50" }), null);
    expect(result?.hitsAchieved).toBe(2);
  });

  it("leaves bodyweight sets unaffected (every row is 0kg)", () => {
    const rows = makeSessions(REQUIRED_HITS, {
      weightKg: "0.00",
      actualReps: 8,
      targetReps: 8,
      rpe: 7,
    });
    const result = buildSuggestion(
      rows,
      makePs({ advance: "load", overloadIncrementReps: 1 }),
      null,
    );
    expect(result?.reason).toBe("progressed-reps");
    expect(result?.suggestedReps).toBe(9);
  });
});

// ─── describeProgressionRule ──────────────────────────────────────────────────

describe("describeProgressionRule", () => {
  const base = {
    advance: "load",
    incrementKg: 2.5,
    incrementReps: 0,
    targetReps: 10,
    requiredHits: 2,
  };

  it("quotes the increment, rep target, scope and gate", () => {
    const text = describeProgressionRule(base)!;
    expect(text).toContain("+2.5kg");
    expect(text).toContain("10 reps");
    expect(text).toContain("every set");
    // "in a row", not "of the last 5": a miss resets the count, so the old
    // wording described a rule the engine no longer applies.
    expect(text).toContain("2 sessions in a row");
  });

  it("names the sets the scope actually reads", () => {
    expect(describeProgressionRule({ ...base, scope: "first" })).toContain("the first set");
    expect(describeProgressionRule({ ...base, scope: "last" })).toContain("the last set");
    expect(describeProgressionRule({ ...base, scope: "set" })).toContain("a set");
    // An unrecognised value falls back to the default rather than reading "undefined".
    expect(describeProgressionRule({ ...base, scope: "nonsense" })).toContain("every set");
  });

  it("no longer quotes an RPE gate, because there is not one", () => {
    expect(describeProgressionRule(base)).not.toContain("RPE");
    expect(describeProgressionRule({ ...base, advance: "duration", incrementReps: 10 })).not.toContain("RPE");
  });

  it("tracks a changed gate, and drops the count when one session is enough", () => {
    expect(describeProgressionRule({ ...base, requiredHits: 3 })).toContain(
      "3 sessions in a row",
    );
    expect(describeProgressionRule({ ...base, requiredHits: 1 })).toContain(
      "in a session",
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

  it("describes double progression as the climb and the reset", () => {
    expect(
      describeProgressionRule({
        ...base,
        advance: "double",
        incrementKg: 2.5,
        repRangeMin: 6,
        repRangeMax: 12,
      }),
    ).toBe(
      "Work 6 to 12 reps. Add reps once every set hits the target in 2 sessions in a row, then +2.5kg and back to 6." +
        " Back off 10% after 3 workouts short of target.",
    );
  });

  it("describes a rangeless double as the load progression it becomes", () => {
    expect(
      describeProgressionRule({ ...base, advance: "double", incrementKg: 2.5 }),
    ).toBe(
      "+2.5kg once every set hits 10 reps in 2 sessions in a row." +
        " Back off 10% after 3 workouts short of target.",
    );
  });

  it("describes reps mode in reps, singular and plural", () => {
    expect(
      describeProgressionRule({ ...base, advance: "reps", incrementReps: 1 }),
    ).toContain("+1 rep ");
    expect(
      describeProgressionRule({ ...base, advance: "reps", incrementReps: 2 }),
    ).toContain("+2 reps");
  });

  it("describes time and distance modes in their own units", () => {
    expect(
      describeProgressionRule({ ...base, advance: "duration", incrementReps: 30 }),
    ).toContain("+30s");
    expect(
      describeProgressionRule({ ...base, advance: "distance", incrementReps: 500 }),
    ).toContain("+0.5km");
  });

  it("says the cycle owns an anchored target rather than promising a bump", () => {
    // The sentence is the contract, and the engine refuses to write an
    // anchored duration. Quoting an increment here would be the sheet
    // promising something that never happens.
    const text = describeProgressionRule({
      ...base,
      advance: "duration",
      incrementReps: 30,
      anchored: true,
    })!;
    expect(text).toContain("training cycle");
    expect(text).not.toContain("+30s");
  });

  it("returns null for modes that never suggest anything", () => {
    expect(describeProgressionRule({ ...base, advance: "manual" })).toBeNull();
    expect(describeProgressionRule({ ...base, advance: "none" })).toBeNull();
    expect(describeProgressionRule({ ...base, advance: null })).toBeNull();
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

  // ── E-1: the reset step must get past the plan floor ──
  //
  // SI-37's floor exists to stop a suggestion built from history quietly
  // downgrading the plan. Double progression's reset raises the load and
  // *lowers* the target back to the bottom of the range in the same breath, so
  // a floor applied to its reps blocks the headline behaviour of phase 4.
  it("writes the reset's lower rep target, which the floor would otherwise block", () => {
    const result = pendingProgressions(
      [makeSet({ weightKg: "80.00", targetReps: 12 })],
      { 1: makeSuggestion({ reason: "reset", suggestedWeightKg: 82.5, suggestedReps: 6 }) },
      NONE,
    );
    expect(result).toEqual([{ setId: 1, weightKg: 82.5, targetReps: 6 }]);
  });

  it("refuses a reset whose load sits below the plan", () => {
    // Not a reset at all from the plan's point of view: it would drop the reps
    // without buying anything with load.
    const result = pendingProgressions(
      [makeSet({ weightKg: "90.00", targetReps: 12 })],
      { 1: makeSuggestion({ reason: "reset", suggestedWeightKg: 82.5, suggestedReps: 6 }) },
      NONE,
    );
    expect(result).toEqual([]);
  });

  it("is a no-op once the reset has been applied", () => {
    const result = pendingProgressions(
      [makeSet({ weightKg: "82.50", targetReps: 6 })],
      { 1: makeSuggestion({ reason: "reset", suggestedWeightKg: 82.5, suggestedReps: 6 }) },
      NONE,
    );
    expect(result).toEqual([]);
  });

  it("finishes a half-applied reset", () => {
    // The load landed, the reps did not. The remaining half is still owed, and
    // it is the half the floor would reject.
    const result = pendingProgressions(
      [makeSet({ weightKg: "82.50", targetReps: 12 })],
      { 1: makeSuggestion({ reason: "reset", suggestedWeightKg: 82.5, suggestedReps: 6 }) },
      NONE,
    );
    expect(result).toEqual([{ setId: 1, targetReps: 6 }]);
  });

  it("measures a reset against the plan, not today's override", () => {
    // Today's set was dropped to 70 by hand; the plan still says 80. The reset
    // to 82.5 is above the plan, so it writes.
    const result = pendingProgressions(
      [
        makeSet({
          weightKg: "70.00",
          targetReps: 12,
          planned: { weightKg: "80.00", targetReps: 12 },
        }),
      ],
      { 1: makeSuggestion({ reason: "reset", suggestedWeightKg: 82.5, suggestedReps: 6 }) },
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

  it("gives one set the same update whether applied alone or with the others", () => {
    // The per-set chip (applySuggestion) filters the shared input array down to
    // one set and calls this; the exercise-level chip passes the whole array.
    // They must agree, or tapping one row writes something different from
    // tapping "apply all" — which is exactly how the two paths drifted before
    // applySuggestion stopped hand-building its own payload.
    const sets = [
      makeSet({ id: 1 }),
      makeSet({ id: 2, weightKg: "70.00", planned: { weightKg: "80.00", targetReps: 8 } }),
      makeSet({ id: 3, targetReps: 12 }),
      makeSet({ id: 4, durationSeconds: 60 }),
    ];
    const suggestions = {
      1: makeSuggestion(),
      2: makeSuggestion({ suggestedWeightKg: 75 }),
      3: makeSuggestion({ reason: "progressed-reps", suggestedReps: 9 }),
      4: makeSuggestion({
        reason: "progressed-time",
        suggestedDurationSeconds: 70,
        suggestedWeightKg: 80,
      }),
    };
    const all = pendingProgressions(sets, suggestions, NONE);
    for (const set of sets) {
      expect(pendingProgressions([set], suggestions, NONE)).toEqual(
        all.filter((u) => u.setId === set.id),
      );
    }
  });

  it("returns nothing when there are no suggestions at all", () => {
    expect(pendingProgressions([makeSet()], undefined, NONE)).toEqual([]);
    expect(pendingProgressions([makeSet()], {}, NONE)).toEqual([]);
  });
});


// ─── Session scope, clearance and the consecutive gate ───────────────────────

/** A 4x12 session at one load, one entry per set's achieved reps. */
function straightSets(
  reps: number[],
  weightKg: string,
  date: string,
  overrides: { feeling?: string | null; prescribedWorkingSets?: number | null } = {},
): SessionHistory {
  return makeMultiSession(
    reps.map((actualReps) => ({ actualReps, targetReps: 12, weightKg })),
    { date, prescribedWorkingSets: 4, ...overrides },
  );
}

/** Table 4a's exercise: fixed 12, four sets, scope all, gate 2, +2.5kg. */
function fixedTwelvePs(overrides: Partial<ProgramSetData> = {}): ProgramSetData {
  return makePs({
    targetReps: 12,
    overloadIncrementKg: "2.50",
    requiredHits: 2,
    scope: "all",
    ...overrides,
  });
}

describe("buildSuggestion — worked example 4a (fixed 12, four sets, gate 2)", () => {
  // The plan's table, encoded literally. Sessions are listed oldest first and
  // the suggestion is read after each one, from the window that existed then.
  // If the code disagrees with this table the code is wrong.
  const s1 = straightSets([12, 12, 12, 12], "60.00", "2024-01-01");
  const s2 = straightSets([12, 12, 12, 10], "60.00", "2024-01-02");
  const s3 = straightSets([12, 12, 12, 12], "60.00", "2024-01-03");
  const s4 = straightSets([12, 12, 12, 12], "60.00", "2024-01-04");
  const s5 = straightSets([12, 12, 12, 12], "62.50", "2024-01-05");

  /** The window as it stands after `sessions` have been logged, newest first. */
  const after = (...sessions: SessionHistory[]) =>
    buildSuggestion([...sessions].reverse(), fixedTwelvePs(), null);

  it("session 1: one clear banked, nothing moves", () => {
    const r = after(s1);
    expect(r?.reason).toBe("held");
    expect(r?.hitsAchieved).toBe(1);
    expect(r?.hitsRequired).toBe(2);
    expect(r?.suggestedWeightKg).toBe(60);
  });

  it("session 2: set 4 falls two reps short and the dots empty", () => {
    const r = after(s1, s2);
    expect(r?.reason).toBe("held");
    // Not 1: a miss resets the count outright (D-11). An earlier draft had it
    // merely not add, which bumps a session early.
    expect(r?.hitsAchieved).toBe(0);
    expect(r?.sessions?.[0]).toMatchObject({ status: "missed", shortfall: 2 });
  });

  it("session 3: back to one, still short of the gate", () => {
    const r = after(s1, s2, s3);
    expect(r?.reason).toBe("held");
    expect(r?.hitsAchieved).toBe(1);
  });

  it("session 4: two in a row, so the whole exercise gets +2.5kg", () => {
    const r = after(s1, s2, s3, s4);
    expect(r?.reason).toBe("progressed");
    expect(r?.hitsAchieved).toBe(2);
    expect(r?.suggestedWeightKg).toBe(62.5);
  });

  it("session 5: the clears at 60 do not count once the load is 62.5", () => {
    const r = after(s1, s2, s3, s4, s5);
    expect(r?.reason).toBe("held");
    // 1, not 3. Without SI-11's at-this-load clause the exercise bumps every
    // session forever, which is the runaway this rebuild exists to fix.
    expect(r?.hitsAchieved).toBe(1);
    expect(r?.suggestedWeightKg).toBe(62.5);
  });

  it("gives every working set of the exercise the same advance", () => {
    const window = [s4, s3, s2, s1];
    for (const setNumber of [1, 2, 3, 4]) {
      const r = buildSuggestion(window, fixedTwelvePs({ setNumber }), null);
      expect(r?.suggestedWeightKg).toBe(62.5);
    }
  });
});

/** Table 4b's exercise: range 6-8, three sets, scope all, gate 1, +2.5kg. */
function rangePs(overrides: Partial<ProgramSetData> = {}): ProgramSetData {
  return makePs({
    advance: "double",
    targetReps: 8,
    repRangeMin: 6,
    repRangeMax: 8,
    overloadIncrementKg: "2.50",
    requiredHits: 1,
    scope: "all",
    ...overrides,
  });
}

/** Three working sets at one load, each carrying the target in force that day. */
function rangeSets(
  reps: number[],
  weightKg: string,
  targetReps: number,
  date: string,
): SessionHistory {
  return makeMultiSession(
    reps.map((r) => ({ actualReps: r, targetReps, weightKg })),
    { date, prescribedWorkingSets: 3 },
  );
}

describe("buildSuggestion — worked example 4b (range 6-8, climb then reset)", () => {
  // The plan's table, encoded literally. The prescription is `targetReps` as
  // the plan holds it that day, which is why session 4 is judged against 6:
  // session 3's reset rewrote it. If the code disagrees with this table the
  // code is wrong.
  const s1 = rangeSets([8, 7, 6], "80.00", 8, "2024-01-01");
  const s2 = rangeSets([8, 8, 7], "80.00", 8, "2024-01-02");
  const s3 = rangeSets([8, 8, 8], "80.00", 8, "2024-01-03");
  const s4 = rangeSets([6, 6, 6], "82.50", 6, "2024-01-04");

  it("session 1: two sets short of 8, nothing moves", () => {
    const r = buildSuggestion([s1], rangePs(), null);
    expect(r?.reason).toBe("held");
    expect(r?.hitsAchieved).toBe(0);
  });

  it("session 2: closer, still not every set", () => {
    const r = buildSuggestion([s2, s1], rangePs(), null);
    expect(r?.reason).toBe("held");
    expect(r?.hitsAchieved).toBe(0);
  });

  it("session 3: every set reaches 8, so the load buys the next range", () => {
    const r = buildSuggestion([s3, s2, s1], rangePs(), null);
    expect(r?.reason).toBe("reset");
    expect(r?.suggestedWeightKg).toBe(82.5);
    expect(r?.suggestedReps).toBe(6);
  });

  it("session 4: the reset session clears at once, and the reps climb", () => {
    // The point of the reset is that the new load is workable, which is why
    // double progression pairs with gate 1.
    const r = buildSuggestion([s4, s3, s2, s1], rangePs({ targetReps: 6 }), null);
    expect(r?.reason).toBe("progressed-reps");
    expect(r?.suggestedWeightKg).toBe(82.5);
    expect(r?.suggestedReps).toBe(7);
  });

  it("gives every working set of the exercise the same reset", () => {
    for (const setNumber of [1, 2, 3]) {
      const r = buildSuggestion([s3, s2, s1], rangePs({ setNumber }), null);
      expect(r?.reason).toBe("reset");
      expect(r?.suggestedWeightKg).toBe(82.5);
      expect(r?.suggestedReps).toBe(6);
    }
  });
});

describe("buildSuggestion — double progression, the rest of the range", () => {
  it("climbs to the reps the binding set actually did, not one more than asked", () => {
    // Range 6-12, prescription just reset to 6, and the lifter managed 12/12/11
    // at the new load. The prescription becomes 11 — the set that bound the
    // session — rather than 7, which would lag them for five more sessions.
    const session = rangeSets([12, 12, 11], "82.50", 6, "2024-02-01");
    const r = buildSuggestion(
      [session],
      rangePs({ targetReps: 6, repRangeMin: 6, repRangeMax: 12 }),
      null,
    );
    expect(r?.reason).toBe("progressed-reps");
    expect(r?.suggestedReps).toBe(11);
  });

  it("never climbs past the top of the range", () => {
    const session = rangeSets([20, 20, 20], "82.50", 6, "2024-02-01");
    const r = buildSuggestion(
      [session],
      rangePs({ targetReps: 6, repRangeMin: 6, repRangeMax: 8 }),
      null,
    );
    expect(r?.suggestedReps).toBe(8);
  });

  it("moves by at least one rep when the target was met exactly", () => {
    const session = rangeSets([6, 6, 6], "82.50", 6, "2024-02-01");
    const r = buildSuggestion(
      [session],
      rangePs({ targetReps: 6, repRangeMin: 6, repRangeMax: 12 }),
      null,
    );
    expect(r?.suggestedReps).toBe(7);
  });

  it("holds at the top of the range when there is no load to add", () => {
    // E-4: without an increment the reset cannot happen, and climbing past the
    // range the lifter configured is not the answer.
    const session = rangeSets([8, 8, 8], "80.00", 8, "2024-02-01");
    const r = buildSuggestion(
      [session],
      rangePs({ overloadIncrementKg: "0" }),
      null,
    );
    // Distinct from plain "held" (E-4): "not enough clears yet" and "there is
    // no weight to add" are different answers, and the sheet says which.
    expect(r?.reason).toBe("held-no-increment");
  });

  it("holds at the top of the range for a bodyweight exercise", () => {
    const session = rangeSets([8, 8, 8], "0.00", 8, "2024-02-01");
    const r = buildSuggestion([session], rangePs(), null);
    expect(r?.reason).toBe("held-no-increment");
  });

  it("falls back to load progression when no range is configured", () => {
    // Nothing can produce this pairing today; freezing the exercise would be a
    // worse answer than the progression the lifter plainly asked for.
    const session = rangeSets([8, 8, 8], "80.00", 8, "2024-02-01");
    const r = buildSuggestion(
      [session],
      rangePs({ repRangeMin: null, repRangeMax: null }),
      null,
    );
    expect(r?.reason).toBe("progressed");
    expect(r?.suggestedWeightKg).toBe(82.5);
  });

  it("holds below the gate like every other mode", () => {
    const session = rangeSets([8, 8, 7], "80.00", 8, "2024-02-01");
    const r = buildSuggestion([session], rangePs(), null);
    expect(r?.reason).toBe("held");
  });

  it("yields to low readiness — a reset is still a load increase", () => {
    const session = rangeSets([8, 8, 8], "80.00", 8, "2024-02-01");
    const r = buildSuggestion([session], rangePs(), null, 2);
    expect(r?.reason).toBe("held-readiness");
    expect(r?.suggestedWeightKg).toBe(80);
    expect(r?.suggestedReps).toBeUndefined();
  });
});

describe("buildSuggestion — a rep ladder stops at the top of its range", () => {
  const ladderPs = (overrides: Partial<ProgramSetData> = {}) =>
    makePs({
      advance: "reps",
      targetReps: 8,
      overloadIncrementReps: 2,
      requiredHits: 1,
      ...overrides,
    });

  it("climbs when there is no range, as it always has", () => {
    const r = buildSuggestion(makeSessions(1), ladderPs(), null);
    expect(r?.suggestedReps).toBe(10);
  });

  it("clamps the last step to the top of the range", () => {
    const r = buildSuggestion(makeSessions(1), ladderPs({ repRangeMax: 9 }), null);
    expect(r?.suggestedReps).toBe(9);
  });

  it("holds once the target is at the top of the range", () => {
    const r = buildSuggestion(makeSessions(1), ladderPs({ repRangeMax: 8 }), null);
    expect(r?.reason).toBe("held");
  });
});

describe("buildSuggestion — scope decides which sets have to clear", () => {
  // Set 4 is one rep short; sets 1-3 cleared.
  const short = [
    straightSets([12, 12, 12, 11], "60.00", "2024-01-02"),
    straightSets([12, 12, 12, 11], "60.00", "2024-01-01"),
  ];

  it("all: one short set holds the whole exercise", () => {
    const r = buildSuggestion(short, fixedTwelvePs({ scope: "all" }), null);
    expect(r?.reason).toBe("held");
    expect(r?.hitsAchieved).toBe(0);
  });

  it("first: the top set carries the session", () => {
    const r = buildSuggestion(short, fixedTwelvePs({ scope: "first" }), null);
    expect(r?.reason).toBe("progressed");
    expect(r?.hitsAchieved).toBe(2);
  });

  it("last: the trailing set decides, so the same history holds", () => {
    const r = buildSuggestion(short, fixedTwelvePs({ scope: "last" }), null);
    expect(r?.reason).toBe("held");
  });

  it("set: each set banks its own count — the old per-set behaviour", () => {
    const cleared = buildSuggestion(
      short,
      fixedTwelvePs({ scope: "set", setNumber: 1 }),
      null,
    );
    const missed = buildSuggestion(
      short,
      fixedTwelvePs({ scope: "set", setNumber: 4 }),
      null,
    );
    expect(cleared?.reason).toBe("progressed");
    expect(missed?.reason).toBe("held");
  });

  it("defaults to all when the column holds something unexpected", () => {
    const r = buildSuggestion(short, fixedTwelvePs({ scope: null }), null);
    expect(r?.reason).toBe("held");
  });

  it("levels drifted sets up rather than proposing a downgrade for the top one", () => {
    // A plan that already ratcheted apart: 62.5 / 62.5 / 60 / 60. Taking the
    // minimum would propose 62.5 for sets already at 62.5 and the plan floor
    // would refuse it, leaving the exercise permanently pending.
    const drifted = [
      makeMultiSession(
        [
          { actualReps: 12, targetReps: 12, weightKg: "62.50" },
          { actualReps: 12, targetReps: 12, weightKg: "62.50" },
          { actualReps: 12, targetReps: 12, weightKg: "60.00" },
          { actualReps: 12, targetReps: 12, weightKg: "60.00" },
        ],
        { date: "2024-01-02", prescribedWorkingSets: 4 },
      ),
      makeMultiSession(
        [
          { actualReps: 12, targetReps: 12, weightKg: "62.50" },
          { actualReps: 12, targetReps: 12, weightKg: "62.50" },
          { actualReps: 12, targetReps: 12, weightKg: "60.00" },
          { actualReps: 12, targetReps: 12, weightKg: "60.00" },
        ],
        { date: "2024-01-01", prescribedWorkingSets: 4 },
      ),
    ];
    const r = buildSuggestion(drifted, fixedTwelvePs({ setNumber: 4 }), null);
    expect(r?.reason).toBe("progressed");
    expect(r?.suggestedWeightKg).toBe(65);
    // "Last:" still reports what this set actually did.
    expect(r?.basedOnWeightKg).toBe(60);
  });
});

describe("buildSuggestion — a partly logged session is unknown", () => {
  const full = straightSets([12, 12, 12, 12], "60.00", "2024-01-01");
  const partial = makeMultiSession(
    [
      { actualReps: 12, targetReps: 12, weightKg: "60.00" },
      { actualReps: 12, targetReps: 12, weightKg: "60.00" },
      { actualReps: 12, targetReps: 12, weightKg: "60.00" },
    ],
    { date: "2024-01-02", prescribedWorkingSets: 4 },
  );

  it("neither banks a clear nor resets the ones already banked", () => {
    const r = buildSuggestion([partial, full], fixedTwelvePs(), null);
    expect(r?.sessions?.[0]).toMatchObject({
      status: "unknown",
      loggedSets: 3,
      prescribedSets: 4,
    });
    // The one full session before it still counts.
    expect(r?.hitsAchieved).toBe(1);
    expect(r?.reason).toBe("held");
  });

  it("does not count toward a back-off either", () => {
    const missed = straightSets([12, 12, 12, 4], "60.00", "2024-01-01");
    const r = buildSuggestion(
      [partial, missed, missed, missed],
      fixedTwelvePs(),
      null,
    );
    // Three misses is the back-off threshold, and the unknown session on top
    // of them neither adds to the streak nor breaks it.
    expect(r?.reason).toBe("deload");
    expect(r?.sessionsUntilDeload).toBe(0);
  });

  it("still consumes a slot in the window", () => {
    const r = buildSuggestion([partial, full], fixedTwelvePs(), null);
    expect(r?.sessions).toHaveLength(2);
  });

  it("judges against what the session prescribed, not today's plan", () => {
    // The exercise was edited down to 3 sets since. The old sessions are still
    // four-set sessions and are not retroactively completed.
    const threeOfThree = makeMultiSession(
      [
        { actualReps: 12, targetReps: 12, weightKg: "60.00" },
        { actualReps: 12, targetReps: 12, weightKg: "60.00" },
        { actualReps: 12, targetReps: 12, weightKg: "60.00" },
      ],
      { date: "2024-01-03", prescribedWorkingSets: 3 },
    );
    const r = buildSuggestion([threeOfThree, partial], fixedTwelvePs(), null);
    expect(r?.sessions?.[0].status).toBe("cleared");
    expect(r?.sessions?.[1].status).toBe("unknown");
  });

  it("checks nothing when the prescribed count was never recorded", () => {
    // Pre-migration rows carry no snapshot. Judging them against today's plan
    // is exactly the mistake the snapshot exists to prevent, so they are taken
    // at face value.
    const noSnapshot = { ...partial, prescribedWorkingSets: null };
    const r = buildSuggestion([noSnapshot, full], fixedTwelvePs(), null);
    expect(r?.sessions?.[0].status).toBe("cleared");
  });
});

describe("buildSuggestion — a Tired session's misses are held harmless", () => {
  const tiredMiss = straightSets([12, 12, 12, 8], "60.00", "2024-01-03", {
    feeling: "Tired",
  });
  const tiredClear = straightSets([12, 12, 12, 12], "60.00", "2024-01-03", {
    feeling: "Tired",
  });
  const clear = straightSets([12, 12, 12, 12], "60.00", "2024-01-02");

  it("does not reset the gate", () => {
    const r = buildSuggestion([tiredMiss, clear, clear], fixedTwelvePs(), null);
    expect(r?.sessions?.[0].status).toBe("unknown");
    expect(r?.hitsAchieved).toBe(2);
    expect(r?.reason).toBe("progressed");
  });

  it("still counts when it cleared", () => {
    const r = buildSuggestion([tiredClear, clear], fixedTwelvePs(), null);
    expect(r?.sessions?.[0].status).toBe("cleared");
    expect(r?.hitsAchieved).toBe(2);
  });

  it("still supplies the latest numbers rather than being dropped", () => {
    const r = buildSuggestion([tiredMiss, clear], fixedTwelvePs(), null);
    expect(r?.basedOnDate).toBe("2024-01-03");
    expect(r?.basedOnFeeling).toBe("Tired");
  });
});

describe("buildSuggestion — an easy verdict speaks for a session, not a set", () => {
  it("does not carry a session where another set fell short", () => {
    const session = makeMultiSession(
      [
        { actualReps: 12, targetReps: 12, weightKg: "60.00", wasEasy: true },
        { actualReps: 12, targetReps: 12, weightKg: "60.00" },
        { actualReps: 12, targetReps: 12, weightKg: "60.00" },
        { actualReps: 9, targetReps: 12, weightKg: "60.00" },
      ],
      { date: "2024-01-01", prescribedWorkingSets: 4 },
    );
    const r = buildSuggestion([session], fixedTwelvePs(), null);
    expect(r?.reason).toBe("held");
    expect(r?.easyOverride).toBeUndefined();
  });

  it("carries a session that cleared", () => {
    const session = makeMultiSession(
      [
        { actualReps: 12, targetReps: 12, weightKg: "60.00" },
        { actualReps: 12, targetReps: 12, weightKg: "60.00" },
        { actualReps: 12, targetReps: 12, weightKg: "60.00" },
        { actualReps: 12, targetReps: 12, weightKg: "60.00", wasEasy: true },
      ],
      { date: "2024-01-01", prescribedWorkingSets: 4 },
    );
    const r = buildSuggestion([session], fixedTwelvePs(), null);
    expect(r?.reason).toBe("progressed");
    expect(r?.easyOverride).toBe(true);
  });
});

describe("buildSuggestion — the window explains itself", () => {
  it("reports every session newest first, with the shortfall and the counts", () => {
    const r = buildSuggestion(
      [
        straightSets([12, 12, 12, 9], "60.00", "2024-01-03"),
        straightSets([12, 12, 12, 12], "60.00", "2024-01-02"),
      ],
      fixedTwelvePs(),
      null,
    );
    expect(r?.sessions).toEqual([
      {
        date: "2024-01-03",
        status: "missed",
        shortfall: 3,
        loggedSets: 4,
        prescribedSets: 4,
        feeling: "Good",
      },
      {
        date: "2024-01-02",
        status: "cleared",
        loggedSets: 4,
        prescribedSets: 4,
        feeling: "Good",
      },
    ]);
  });

  it("reports no shortfall for a timed set, which logs no target", () => {
    const r = buildSuggestion(
      makeSessions(2, { durationSeconds: 30, targetReps: null, weightKg: "0.00" }),
      makePs({ advance: "duration", durationSeconds: 60, targetReps: null }),
      null,
    );
    expect(r?.sessions?.[0]).toMatchObject({ status: "missed" });
    expect(r?.sessions?.[0].shortfall).toBeUndefined();
  });
});

// ─── Axis 3: the effort cap (D-1, D-2, D-8) ──────────────────────────────────

describe("buildSuggestion — effort cap", () => {
  const capped = (o: Partial<ProgramSetData> = {}) =>
    makePs({ advance: "load", requiredHits: 1, effortCap: 2, ...o });

  it("clears when the target came with the reserve that was asked for", () => {
    // RIR 2 against a cap of 2 clears. The cap is a minimum reserve, not a
    // ceiling — a set that had more left is not a failure.
    const rows = [makeSession({ actualReps: 8, targetReps: 8, rir: 2, rpe: 8 })];
    expect(buildSuggestion(rows, capped(), null)?.reason).toBe("progressed");
  });

  it("does not clear when the reserve came in under the cap", () => {
    // RIR 1 against a cap of 2: the reps were there, the reserve was not. This
    // is the grind an autoregulated scheme exists to catch.
    const rows = [makeSession({ actualReps: 8, targetReps: 8, rir: 1, rpe: 9 })];
    const r = buildSuggestion(rows, capped(), null);
    expect(r?.reason).toBe("held");
    expect(r?.hitsAchieved).toBe(0);
    expect(r?.sessions?.[0].status).toBe("missed");
    expect(r?.sessions?.[0].effortShort).toBe(true);
  });

  it("holds as unknown, not as a miss, when no effort was logged (D-2)", () => {
    const rows = [
      makeSession({ actualReps: 8, targetReps: 8, rir: null, rpe: null }),
    ];
    const r = buildSuggestion(rows, capped(), null);
    // Neither a clear nor a failure: the lifter asked to be measured on effort
    // and then said nothing, so there is no answer to bank in either direction.
    expect(r?.reason).toBe("held-unknown");
    expect(r?.hitsAchieved).toBe(0);
    expect(r?.sessions?.[0].status).toBe("unknown");
    expect(r?.sessions?.[0].unknownReason).toBe("effort");
  });

  it("does not gate at all without a cap — silence is fine (D-1)", () => {
    const rows = [
      makeSession({ actualReps: 8, targetReps: 8, rir: null, rpe: null }),
    ];
    const r = buildSuggestion(rows, makePs({ advance: "load", requiredHits: 1 }), null);
    expect(r?.reason).toBe("progressed");
  });

  it("falls back to the derived RIR for rows that predate the column", () => {
    // rir null, rpe 8 → RIR 2, which meets a cap of 2.
    const rows = [makeSession({ actualReps: 8, targetReps: 8, rir: null, rpe: 8 })];
    expect(buildSuggestion(rows, capped(), null)?.reason).toBe("progressed");
  });

  it("a missed target stays a miss whatever the effort says", () => {
    // The cap makes clearing stricter; it cannot rescue a session that came up
    // short on reps, so the target question is asked first.
    const rows = [
      makeSession({ actualReps: 6, targetReps: 8, rir: null, rpe: null }),
    ];
    expect(buildSuggestion(rows, capped(), null)?.sessions?.[0].status).toBe("missed");
  });

  it("reads the cap off the set the scope names — last, under scope all (D-8)", () => {
    // Set 1 has plenty in reserve, set 4 does not. Under scope "all" the last
    // working set adjudicates, where reserve is lowest by design.
    const session = makeMultiSession([
      { actualReps: 8, targetReps: 8, rir: 4, rpe: 6 },
      { actualReps: 8, targetReps: 8, rir: 1, rpe: 9 },
    ]);
    const r = buildSuggestion(
      [session],
      capped({ scope: "all", setNumber: 1 }),
      null,
    );
    expect(r?.sessions?.[0].status).toBe("missed");
  });

  it("reads the first set's effort under scope first (D-8)", () => {
    const session = makeMultiSession([
      { actualReps: 8, targetReps: 8, rir: 3, rpe: 7 },
      { actualReps: 8, targetReps: 8, rir: 0, rpe: 10 },
    ]);
    const r = buildSuggestion(
      [session],
      capped({ scope: "first", setNumber: 1 }),
      null,
    );
    // The back-off's effort does not speak for a top-set scheme.
    expect(r?.reason).toBe("progressed");
  });
});

// ─── Axis 7: regress ─────────────────────────────────────────────────────────

describe("buildSuggestion — regress axis", () => {
  const missed = () =>
    Array.from({ length: 3 }, (_, i) =>
      makeSession({
        actualReps: 5,
        targetReps: 8,
        date: `2024-01-0${3 - i}`,
      }),
    );

  it("holds instead of backing off when regress is hold", () => {
    const r = buildSuggestion(missed(), makePs({ advance: "load", regress: "hold" }), null);
    expect(r?.reason).toBe("held");
    expect(r?.sessionsUntilDeload).toBeNull();
  });

  it("backs off by the configured percentage after the configured run", () => {
    const rows = missed().slice(0, 2);
    const r = buildSuggestion(
      rows,
      makePs({ advance: "load", backoffAfter: 2, backoffPct: 20, overloadIncrementKg: "2.50" }),
      null,
    );
    expect(r?.reason).toBe("deload");
    expect(r?.suggestedWeightKg).toBe(65); // 80 - 20%, snapped to 2.5
  });

  it("never proposes less than one increment (E-18)", () => {
    const rows = Array.from({ length: 3 }, (_, i) =>
      makeSession({
        actualReps: 1,
        targetReps: 8,
        weightKg: "2.50",
        date: `2024-01-0${3 - i}`,
      }),
    );
    const r = buildSuggestion(
      rows,
      makePs({ advance: "load", overloadIncrementKg: "2.50" }),
      null,
    );
    expect(r?.suggestedWeightKg).toBe(2.5);
  });

  it("is a no-op at zero load — there is nothing to back off from (E-18)", () => {
    const rows = Array.from({ length: 3 }, (_, i) =>
      makeSession({
        actualReps: 5,
        targetReps: 8,
        weightKg: "0.00",
        date: `2024-01-0${3 - i}`,
      }),
    );
    const r = buildSuggestion(rows, makePs({ advance: "load" }), null);
    expect(r?.reason).not.toBe("deload");
  });
});

// ─── Axis 8: readiness ───────────────────────────────────────────────────────

describe("buildSuggestion — readiness axis", () => {
  const cleared = () => makeSessions(REQUIRED_HITS, { actualReps: 8, targetReps: 8 });

  it("holds on a low-readiness day by default", () => {
    const r = buildSuggestion(cleared(), makePs({ advance: "load" }), null, 1);
    expect(r?.reason).toBe("held-readiness");
    expect(r?.readinessModulated).toBe(true);
  });

  it("passes the advance through when readiness is set to ignore", () => {
    const r = buildSuggestion(
      cleared(),
      makePs({ advance: "load", readiness: "ignore" }),
      null,
      1,
    );
    expect(r?.reason).toBe("progressed");
    expect(r?.readinessModulated).toBe(false);
  });

  it("backs off rather than holding when readiness is set to reduce (E-7)", () => {
    const r = buildSuggestion(
      cleared(),
      makePs({ advance: "load", readiness: "reduce", overloadIncrementKg: "2.50" }),
      null,
      1,
    );
    // E-7 reuses the backoff reason with readinessModulated set, rather than
    // teaching every consumer a tenth code for a display distinction.
    expect(r?.reason).toBe("deload");
    expect(r?.readinessModulated).toBe(true);
    expect(r?.suggestedWeightKg).toBe(72.5);
  });
});

// ─── A5: duration and distance move the target, not the achievement ──────────

describe("buildSuggestion — duration and distance advance from the target", () => {
  const held = (seconds: number) =>
    makeSessions(REQUIRED_HITS, {
      actualReps: 0,
      targetReps: null,
      durationSeconds: seconds,
    });

  it("adds the increment to the target, not to what was held", () => {
    // Beating a 60s target by 30s used to make 90s the new prescription, so one
    // good session permanently reset what counted as clearing.
    const r = buildSuggestion(
      held(90),
      makePs({ advance: "duration", durationSeconds: 60, overloadIncrementReps: 10 }),
      null,
    );
    expect(r?.reason).toBe("progressed-time");
    expect(r?.suggestedDurationSeconds).toBe(70);
  });

  it("never writes an anchored duration — the cycle owns it (A5)", () => {
    const r = buildSuggestion(
      held(90),
      makePs({
        advance: "duration",
        durationSeconds: 60,
        overloadIncrementReps: 10,
        peakDurationSeconds: 300,
      }),
      null,
    );
    expect(r?.reason).toBe("held-anchored");
    expect(r?.suggestedDurationSeconds).toBeUndefined();
  });

  it("never writes an anchored distance either", () => {
    const rows = makeSessions(REQUIRED_HITS, {
      actualReps: 0,
      targetReps: null,
      distanceMeters: 5200,
    });
    const r = buildSuggestion(
      rows,
      makePs({
        advance: "distance",
        distanceMeters: 5000,
        peakDistanceMeters: 10000,
      }),
      null,
    );
    expect(r?.reason).toBe("held-anchored");
    expect(r?.suggestedDistanceMeters).toBeUndefined();
  });
});

// ─── SI-D1: the 1RM estimate needs logged effort ─────────────────────────────

describe("buildSuggestion — estimated 1RM", () => {
  it("is null when the lifter reported no effort", () => {
    const rows = makeSessions(1, { actualReps: 8, rir: null, rpe: null });
    expect(buildSuggestion(rows, makePs(), null)?.estimated1RM).toBeNull();
  });

  it("is null for a set with plenty left in reserve — Epley does not apply", () => {
    const rows = makeSessions(1, { actualReps: 8, rir: 5, rpe: 5 });
    expect(buildSuggestion(rows, makePs(), null)?.estimated1RM).toBeNull();
  });

  it("is computed for a near-max set", () => {
    const rows = makeSessions(1, { actualReps: 8, rir: 1, rpe: 9 });
    expect(buildSuggestion(rows, makePs(), null)?.estimated1RM).toBeCloseTo(101.3, 1);
  });
});

// ─── SI-41: the rate rule ────────────────────────────────────────────────────

describe("buildSuggestion — one step per session", () => {
  // A suggestion is offered once per session, so "how much can it move" and
  // "how fast can it move" are the same question. Nothing here may propose more
  // than a single step in the dimension it moves; the two documented exceptions
  // are bounded by something the lifter chose or already did.
  it("adds exactly one load increment however many sessions cleared", () => {
    const rows = makeSessions(5, { actualReps: 8, targetReps: 8 });
    const r = buildSuggestion(
      rows,
      makePs({ advance: "load", requiredHits: 1, overloadIncrementKg: "2.50" }),
      null,
    );
    expect(r?.suggestedWeightKg).toBe(82.5);
  });

  it("adds exactly one rep increment however far past the target the lifter went", () => {
    // 20 reps against a target of 8 still proposes 9. A rep ladder has no range
    // to climb inside, so "what was achieved" is not a bound the lifter set.
    const rows = makeSessions(2, { actualReps: 20, targetReps: 8 });
    const r = buildSuggestion(
      rows,
      makePs({ advance: "reps", overloadIncrementReps: 1 }),
      null,
    );
    expect(r?.suggestedReps).toBe(9);
  });

  it("bounds double progression's climb by the range, not by the session", () => {
    // The documented exception: the climb goes to what the binding set did,
    // which can be several reps at once, but never past a bound the lifter
    // configured. Without the exception the prescription lags what they can do.
    const session = makeMultiSession(
      [
        { actualReps: 12, targetReps: 8 },
        { actualReps: 11, targetReps: 8 },
      ],
      { date: "2024-02-01" },
    );
    const r = buildSuggestion(
      [session],
      makePs({
        advance: "double",
        requiredHits: 1,
        targetReps: 8,
        repRangeMin: 6,
        repRangeMax: 10,
      }),
      null,
    );
    expect(r?.suggestedReps).toBe(10);
  });

  it("adds one duration increment to the target, not to what was held", () => {
    const rows = makeSessions(2, {
      actualReps: 0,
      targetReps: null,
      durationSeconds: 300,
    });
    const r = buildSuggestion(
      rows,
      makePs({ advance: "duration", durationSeconds: 60, overloadIncrementReps: 10 }),
      null,
    );
    expect(r?.suggestedDurationSeconds).toBe(70);
  });
});

// ─── E-13: a settings change does not re-judge history ───────────────────────

describe("buildSuggestion — the config stamp", () => {
  const cleared = () =>
    Array.from({ length: 3 }, (_, i) =>
      makeSession({
        actualReps: 8,
        targetReps: 8,
        date: `2024-01-0${3 - i}`,
      }),
    );

  it("counts everything when the rules have never changed", () => {
    const r = buildSuggestion(cleared(), makePs({ advance: "load" }), null);
    expect(r?.hitsAchieved).toBe(3);
    expect(r?.reason).toBe("progressed");
  });

  it("holds sessions logged before the change inert, rather than re-judging them", () => {
    const r = buildSuggestion(
      cleared(),
      makePs({ advance: "load", configChangedAt: "2024-01-03" }),
      null,
    );
    // Only the session on the day of the change is still evidence.
    expect(r?.hitsAchieved).toBe(1);
    expect(r?.sessions?.[1].status).toBe("unknown");
    expect(r?.sessions?.[1].unknownReason).toBe("reconfigured");
  });

  it("still reports what was done last, even with the whole window inert", () => {
    // The failure this guards against: dropping the sessions instead of
    // marking them inert empties the window, and an empty window returns no
    // suggestion at all — so changing a setting would delete the chip, the
    // dots and the "Last: 80kg" line the lifter was reading.
    const r = buildSuggestion(
      cleared(),
      makePs({ advance: "load", configChangedAt: "2024-06-01" }),
      null,
    );
    expect(r).not.toBeNull();
    expect(r?.basedOnWeightKg).toBe(80);
    expect(r?.hitsAchieved).toBe(0);
    expect(r?.sessions).toHaveLength(3);
  });

  it("does not let an inert session count toward a back-off either", () => {
    const missed = Array.from({ length: 3 }, (_, i) =>
      makeSession({ actualReps: 5, targetReps: 8, date: `2024-01-0${3 - i}` }),
    );
    const r = buildSuggestion(
      missed,
      makePs({ advance: "load", configChangedAt: "2024-06-01" }),
      null,
    );
    expect(r?.reason).not.toBe("deload");
  });
});

// ─── A3: the increment ladder's order, and what the equipment can load ───────

describe("adaptiveIncrementKg — experience modifies the zone, it does not replace it", () => {
  // The bug this closes: anyone with a filled-in profile never reached the
  // load-zone table at all, so the part of the function that knows a 20kg lift
  // and a 200kg lift are different was dead for most users.
  it("gives a beginner a bigger step at every load, not a flat 5kg", () => {
    // 20kg isolation: zone says 1kg, beginner doubles it. Not 5kg, which is
    // more than the whole lift moves in a month.
    expect(adaptiveIncrementKg(null, 20, "curl", null, "beginner", "isolation")).toBe(2);
    // 80kg compound: zone says 2.5, beginner doubles it.
    expect(adaptiveIncrementKg(null, 80, "squat", null, "beginner", "compound")).toBe(5);
  });

  it("gives an advanced lifter a finer step at every load, not a flat 1.25kg", () => {
    // 200kg compound: zone says 5, advanced halves it. Not 1.25kg, which is
    // under a percent of the lift.
    expect(adaptiveIncrementKg(null, 200, "hinge", null, "advanced", "compound")).toBe(2.5);
    expect(adaptiveIncrementKg(null, 20, "curl", null, "advanced", "isolation")).toBe(0.5);
  });

  it("leaves intermediate on the zone alone", () => {
    expect(adaptiveIncrementKg(null, 80, "squat", null, "intermediate", "compound")).toBe(2.5);
  });

  it("still lets an explicit increment and an endurance goal win outright", () => {
    expect(adaptiveIncrementKg(2.5, 200, "hinge", null, "beginner", "compound")).toBe(2.5);
    expect(adaptiveIncrementKg(null, 200, "hinge", "endurance", "beginner", "compound")).toBe(1);
  });
});

describe("adaptiveIncrementKg — loadable granularity", () => {
  it("never proposes a barbell jump that needs microplates", () => {
    // 1.25kg on a barbell is 0.625 a side. The number reads precise and cannot
    // be loaded, so the lifter rounds it and the plan and the bar disagree.
    expect(
      adaptiveIncrementKg(null, 200, "hinge", null, "advanced", "compound", "barbell"),
    ).toBe(2.5);
    expect(
      adaptiveIncrementKg(null, 20, "curl", null, "advanced", "isolation", "barbell"),
    ).toBe(2.5);
  });

  it("rounds a fixed-dumbbell step up to the rack's own spacing", () => {
    expect(
      adaptiveIncrementKg(null, 20, "curl", null, null, "isolation", "dumbbell"),
    ).toBe(2);
  });

  it("lets a cable stack take the fine step it can actually make", () => {
    expect(
      adaptiveIncrementKg(null, 20, "curl", null, "advanced", "isolation", "cable"),
    ).toBe(1.25);
  });

  it("does not snap when no equipment is recorded", () => {
    // Most of the library carries no equipment. Defaulting to a step would
    // coarsen every one of those on no evidence, which is the opposite of the
    // problem this solves.
    expect(adaptiveIncrementKg(null, 20, "curl", null, null, "isolation")).toBe(1);
    expect(adaptiveIncrementKg(null, 20, "curl", null, null, "isolation", null)).toBe(1);
  });

  it("does not snap bodyweight or banded work, which has no load to add", () => {
    expect(
      adaptiveIncrementKg(null, 20, "pull", null, null, "compound", "bodyweight"),
    ).toBe(2.5);
    expect(adaptiveIncrementKg(null, 20, "pull", null, null, "compound", "bands")).toBe(2.5);
  });
});
