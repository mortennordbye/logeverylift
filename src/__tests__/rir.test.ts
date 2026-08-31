import { describe, expect, it } from "vitest";
import { effectiveRir, rirFromRpe, rpeFromRir } from "@/lib/utils/rir";
import { metTargetReps } from "@/lib/utils/progression";
import type { LoggedSet } from "@/lib/utils/progression";

// ─── rpeFromRir ────────────────────────────────────────────────────────────────

describe("rpeFromRir", () => {
  it("maps the canonical RIR↔RPE pairs", () => {
    expect(rpeFromRir(0)).toBe(10); // to failure
    expect(rpeFromRir(1)).toBe(9);
    expect(rpeFromRir(2)).toBe(8);
    expect(rpeFromRir(3)).toBe(7);
    expect(rpeFromRir(4)).toBe(6);
    expect(rpeFromRir(5)).toBe(5); // 5+ left
  });

  it("clamps RPE into 1-10 for out-of-range RIR", () => {
    expect(rpeFromRir(12)).toBe(1);
    expect(rpeFromRir(-3)).toBe(10);
  });
});

// ─── rirFromRpe ────────────────────────────────────────────────────────────────

describe("rirFromRpe", () => {
  it("inverts the mapping and clamps to 0-5", () => {
    expect(rirFromRpe(10)).toBe(0);
    expect(rirFromRpe(8)).toBe(2);
    expect(rirFromRpe(5)).toBe(5);
    expect(rirFromRpe(3)).toBe(5); // clamped at 5+
  });
});

// ─── effectiveRir ──────────────────────────────────────────────────────────────

describe("effectiveRir", () => {
  it("prefers the logged RIR when present", () => {
    expect(effectiveRir({ rir: 2, rpe: 5 })).toBe(2);
  });

  it("falls back to the RPE-derived value for legacy rows", () => {
    expect(effectiveRir({ rir: null, rpe: 9 })).toBe(1);
    expect(effectiveRir({ rpe: 8 })).toBe(2);
  });
});

// ─── Logged effort no longer gates clearing ──────────────────────────────────

describe("logged effort does not decide whether a set cleared", () => {
  const base: LoggedSet = {
    setNumber: 1,
    actualReps: 5,
    targetReps: 5,
    weightKg: "80",
    durationSeconds: null,
    rpe: 7,
  };

  it("counts a hit at any logged RIR, including a grind", () => {
    expect(metTargetReps({ ...base, rpe: rpeFromRir(5) }, 5)).toBe(true);
    expect(metTargetReps({ ...base, rpe: rpeFromRir(2) }, 5)).toBe(true);
    // The retired ladder rejected these two: RIR 2 without an extra rep, and
    // RIR 0-1 outright. An exercise with no prescribed cap clears on the target.
    expect(metTargetReps({ ...base, rpe: rpeFromRir(1) }, 5)).toBe(true);
    expect(metTargetReps({ ...base, rpe: rpeFromRir(0) }, 5)).toBe(true);
  });

  it("counts a hit with no effort logged at all", () => {
    expect(metTargetReps({ ...base, rpe: null }, 5)).toBe(true);
  });

  it("still rejects a set that missed the target, however easy it felt", () => {
    expect(metTargetReps({ ...base, actualReps: 4, rpe: rpeFromRir(5) }, 5)).toBe(false);
  });
});
