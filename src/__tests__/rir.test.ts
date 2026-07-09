import { describe, expect, it } from "vitest";
import { effectiveRir, rirFromRpe, rpeFromRir } from "@/lib/utils/rir";
import { isConfidentHit } from "@/lib/utils/progression";
import type { HistoryRow } from "@/lib/utils/progression";

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

// ─── AI transitivity: RIR drives the progression confidence gate via derived RPE ─

describe("RIR feeds isConfidentHit through the derived RPE", () => {
  const base: HistoryRow = {
    exerciseId: 1,
    setNumber: 1,
    actualReps: 5,
    targetReps: 5,
    weightKg: "80",
    durationSeconds: null,
    feeling: null,
    date: "2026-06-01",
    rpe: 7,
  };

  it("RIR ≥ 3 (rpe ≤ 7) on a hit is confident", () => {
    expect(isConfidentHit({ ...base, rpe: rpeFromRir(3) }, 5)).toBe(true);
    expect(isConfidentHit({ ...base, rpe: rpeFromRir(5) }, 5)).toBe(true);
  });

  it("RIR 2 (rpe 8) is confident only with an extra rep", () => {
    expect(isConfidentHit({ ...base, rpe: rpeFromRir(2) }, 5)).toBe(false);
    expect(isConfidentHit({ ...base, actualReps: 6, rpe: rpeFromRir(2) }, 5)).toBe(true);
  });

  it("RIR 0-1 (rpe 9-10) is never confident", () => {
    expect(isConfidentHit({ ...base, rpe: rpeFromRir(1) }, 5)).toBe(false);
    expect(isConfidentHit({ ...base, actualReps: 7, rpe: rpeFromRir(0) }, 5)).toBe(false);
  });
});
