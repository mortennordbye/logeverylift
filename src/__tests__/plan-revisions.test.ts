import { finishFlushPayloads } from "@/lib/utils/finish-flush";
import { replayOutcome } from "@/lib/utils/pending-queue";
import {
  ASSISTANT_CHANGE_SET_WINDOW_MS,
  canonical,
  changeSetFor,
  diffSnapshots,
  lastWriterOf,
  matchSets,
  queuedWriteConflicts,
  restoredSetValues,
  sameSnapshot,
  syncOwnedSetFields,
  type ProgramSnapshot,
} from "@/lib/utils/plan-revisions";
import { describe, expect, it } from "vitest";

/** Pure rules of the revision layer (docs/plans/revisions.md, section 2). */

const set = (id: number, setNumber: number, extra: Record<string, unknown> = {}) => ({
  id,
  setNumber,
  programExerciseId: 10,
  targetReps: 8,
  weightKg: "80.00",
  distanceMeters: null,
  durationSeconds: null,
  peakDistanceMeters: null,
  peakDurationSeconds: null,
  sessionRole: null,
  targetHeartRateZone: null,
  restTimeSeconds: 90,
  ...extra,
});

const snap = (sets: ReturnType<typeof set>[], name = "Push"): ProgramSnapshot => ({
  v: 1,
  program: { id: 1, name },
  exercises: [{ id: 10, exerciseId: 5, exerciseName: "Bench Press", notes: null, sets }],
});

describe("matchSets", () => {
  const live = [
    { id: 1, setNumber: 1 },
    { id: 2, setNumber: 2 },
    { id: 3, setNumber: 3 },
  ];

  it("updates by set number when no ids are given, so ids never change", () => {
    const m = matchSets(live, [{ setNumber: 1 }, { setNumber: 2 }, { setNumber: 3 }]);
    expect(m).toEqual({
      updates: [
        { id: 1, input: { setNumber: 1 } },
        { id: 2, input: { setNumber: 2 } },
        { id: 3, input: { setNumber: 3 } },
      ],
      inserts: [],
      deletes: [],
    });
  });

  it("matches by id first, then by number, inserts the rest and deletes the unclaimed", () => {
    const m = matchSets(live, [{ id: 3, setNumber: 1 }, { setNumber: 2 }, { setNumber: 4 }]);
    if ("error" in m) throw new Error(m.error);
    expect(m.updates.map((u) => u.id)).toEqual([3, 2]);
    expect(m.inserts).toEqual([{ setNumber: 4 }]);
    expect(m.deletes).toEqual([1]);
  });

  it("refuses an id that is not a set of this slot, or one named twice", () => {
    expect(matchSets(live, [{ id: 9, setNumber: 1 }])).toEqual({ error: "Set 9 is not a set of this exercise" });
    expect("error" in matchSets(live, [{ id: 1, setNumber: 1 }, { id: 1, setNumber: 2 }])).toBe(true);
  });

  it("does not let a numbered entry claim a set already claimed by id", () => {
    const m = matchSets(live, [{ id: 1, setNumber: 2 }, { setNumber: 1 }]);
    if ("error" in m) throw new Error(m.error);
    expect(m.updates.map((u) => u.id)).toEqual([1]);
    expect(m.inserts).toEqual([{ setNumber: 1 }]);
  });
});

describe("snapshots", () => {
  it("compare equal whatever the key order or date form", () => {
    const a = snap([set(1, 1)]);
    const b = JSON.parse(JSON.stringify({ exercises: a.exercises, program: a.program, v: 1 }));
    expect(sameSnapshot(a, b)).toBe(true);
    expect(canonical({ at: new Date("2026-01-01T00:00:00Z") })).toBe(canonical({ at: "2026-01-01T00:00:00.000Z" }));
  });

  it("read as short lines", () => {
    const before = snap([set(1, 1), set(2, 2)]);
    const after = snap([set(1, 1, { weightKg: "82.50" }), set(3, 3)], "Push A");
    expect(diffSnapshots(before, after)).toEqual([
      'Renamed "Push" → "Push A"',
      "Bench Press, set 1: weight 80 kg → 82.5 kg",
      "Bench Press: added set 3",
      "Bench Press: removed set 2",
    ]);
    expect(diffSnapshots(null, after)).toEqual(['Created "Push A"']);
  });
});

describe("what a restore keeps", () => {
  it("leaves distance on an anchored set and zone and rest on a work set to the sync", () => {
    expect(syncOwnedSetFields(set(1, 1, { peakDistanceMeters: 10000, sessionRole: "work" }))).toEqual([
      "distanceMeters",
      "targetHeartRateZone",
      "restTimeSeconds",
    ]);
    expect(syncOwnedSetFields(set(1, 1, { sessionRole: "work" }))).toEqual([]);
  });

  it("keeps a weight progression set since, and restores one the user set after it", () => {
    const target = snap([set(1, 1), set(2, 2)]);
    const s1 = snap([set(1, 1, { weightKg: "82.50" }), set(2, 2, { weightKg: "82.50" })]);
    const s2 = snap([set(1, 1, { weightKg: "82.50" }), set(2, 2, { weightKg: "95.00" })]);
    const history = [
      { writer: "progression" as const, snapshot: s1 },
      { writer: "user" as const, snapshot: s2 },
    ];
    expect(lastWriterOf(target, history, 1, "weightKg")).toBe("progression");
    expect(lastWriterOf(target, history, 2, "weightKg")).toBe("user");
    expect(restoredSetValues(target.exercises[0].sets[0], s2.exercises[0].sets[0], target, history).weightKg).toBe("82.50");
    expect(restoredSetValues(target.exercises[0].sets[1], s2.exercises[0].sets[1], target, history).weightKg).toBe("80.00");
  });

  it("takes every value from the target for a set that is gone now", () => {
    const target = snap([set(1, 1)]);
    expect(restoredSetValues(target.exercises[0].sets[0], undefined, target, []).weightKg).toBe("80.00");
  });
});

describe("queuedWriteConflicts", () => {
  it("is empty when nobody changed the field, or it is already at the new value", () => {
    expect(queuedWriteConflicts({ weightKg: "80.00" }, { weightKg: "80.00" }, { weightKg: 82.5 })).toEqual([]);
    expect(queuedWriteConflicts({ weightKg: "80.00" }, { weightKg: "82.50" }, { weightKg: 82.5 })).toEqual([]);
  });

  it("names a field that changed since the base and differs from the new value", () => {
    expect(queuedWriteConflicts({ weightKg: "80.00", targetReps: 8 }, { weightKg: "100.00", targetReps: 8 }, { weightKg: 82.5, targetReps: 8 })).toEqual([
      "weightKg",
    ]);
  });

  it("treats an unknown base as changed", () => {
    expect(queuedWriteConflicts(undefined, { weightKg: "80.00" }, { weightKg: 82.5 })).toEqual(["weightKg"]);
  });
});

describe("changeSetFor", () => {
  const now = new Date("2026-11-12T12:00:00Z");
  it("joins the last change set within the window, else starts a new one", () => {
    const recent = { changeSetId: "mcp:a", createdAt: new Date(now.getTime() - 60_000) };
    const old = { changeSetId: "mcp:a", createdAt: new Date(now.getTime() - ASSISTANT_CHANGE_SET_WINDOW_MS) };
    expect(changeSetFor(recent, now, () => "mcp:b")).toBe("mcp:a");
    expect(changeSetFor(old, now, () => "mcp:b")).toBe("mcp:b");
    expect(changeSetFor(null, now, () => "mcp:b")).toBe("mcp:b");
  });
});

describe("the finish flush", () => {
  it("sends the version the workout started on with each set", () => {
    expect(finishFlushPayloads({ 3: { targetReps: 8, weightKg: 82.5 } }, 4)).toEqual([
      { id: 3, targetReps: 8, weightKg: 82.5, baseVersion: 4 },
    ]);
    expect(finishFlushPayloads({ 3: { targetReps: 8, weightKg: 82.5, durationSeconds: 30 } }, null)).toEqual([
      { id: 3, targetReps: 8, weightKg: 82.5, durationSeconds: 30 },
    ]);
  });
});

describe("replayOutcome", () => {
  it("sorts a replayed result into done, a final conflict, or a retry", () => {
    expect(replayOutcome({ success: true })).toBe("done");
    expect(replayOutcome({ success: false, conflict: { programId: 1, revisionId: 2 } })).toBe("conflict");
    expect(replayOutcome({ success: false })).toBe("retry");
  });
});
