import { describe, expect, it } from "vitest";
import {
  describeLiveMiss,
  liveSessionMiss,
  type LiveSet,
} from "@/lib/utils/progression";

function live(sets: Partial<LiveSet>[]): LiveSet[] {
  return sets.map((s, i) => ({
    setNumber: i + 1,
    targetReps: 8,
    actualReps: 8,
    weightKg: 20,
    rir: null,
    targetRir: null,
    completed: true,
    ...s,
  }));
}

describe("liveSessionMiss", () => {
  it("is null while every logged set met its target", () => {
    expect(liveSessionMiss(live([{}, {}, { completed: false }]), "all", 1)).toBeNull();
  });

  it("under scope all, any short set is a miss for every set", () => {
    const sets = live([{}, {}, { targetReps: 8, actualReps: 7 }]);
    for (const n of [1, 2, 3]) {
      expect(liveSessionMiss(sets, "all", n)).toMatchObject({
        setNumber: 3,
        actualReps: 7,
        targetReps: 8,
      });
    }
  });

  it("ignores a short count on a set that is not logged", () => {
    // The row can carry a recorded count before the set is ticked, or after
    // it is un-logged. Only a logged set is evidence (D-9).
    const sets = live([{}, { actualReps: 6, completed: false }]);
    expect(liveSessionMiss(sets, "all", 1)).toBeNull();
  });

  it("under scope first, only set 1 decides", () => {
    const sets = live([{}, { actualReps: 5 }]);
    expect(liveSessionMiss(sets, "first", 2)).toBeNull();
    expect(liveSessionMiss(live([{ actualReps: 5 }, {}]), "first", 2)).toMatchObject({ setNumber: 1 });
  });

  it("under scope last, only the last working set decides", () => {
    expect(liveSessionMiss(live([{ actualReps: 5 }, {}]), "last", 1)).toBeNull();
    expect(liveSessionMiss(live([{}, { actualReps: 5 }]), "last", 1)).toMatchObject({ setNumber: 2 });
  });

  it("under scope set, a miss only resets the set that missed", () => {
    const sets = live([{}, { actualReps: 5 }]);
    expect(liveSessionMiss(sets, "set", 1)).toBeNull();
    expect(liveSessionMiss(sets, "set", 2)).toMatchObject({ setNumber: 2 });
  });

  it("an open-ended set clears on any completed rep", () => {
    expect(liveSessionMiss(live([{ targetReps: null, actualReps: 3 }]), "all", 1)).toBeNull();
  });

  it("logged reserve below the cap on the deciding set is a miss (D-1, D-8)", () => {
    const sets = live([{ targetRir: 2, rir: 0 }, { targetRir: 2, rir: 1 }]);
    expect(liveSessionMiss(sets, "all", 1)).toMatchObject({
      setNumber: 2,
      effort: { rir: 1, cap: 2 },
    });
  });

  it("unlogged effort is not a miss (D-2)", () => {
    expect(liveSessionMiss(live([{ targetRir: 2, rir: null }]), "all", 1)).toBeNull();
  });
});

describe("describeLiveMiss", () => {
  it("says what fell short, that the count restarts, and what moves it", () => {
    const text = describeLiveMiss(
      { setNumber: 3, actualReps: 7, targetReps: 8, weightKg: 20 },
      "all",
      2,
    );
    expect(text).toBe(
      "Set 3: 7 of 8. Count starts over. Stay at 20kg until every set hits its target in 2 sessions in a row.",
    );
  });

  it("names the scope's set and drops the weight for bodyweight", () => {
    const text = describeLiveMiss(
      { setNumber: 1, actualReps: 5, targetReps: 8, weightKg: 0 },
      "first",
      1,
    );
    expect(text).toBe("Set 1: 5 of 8. Count starts over. Stay here until set 1 hits its target in a session.");
  });

  it("describes an effort miss in RIR", () => {
    const text = describeLiveMiss(
      { setNumber: 2, actualReps: 8, targetReps: 8, weightKg: 60, effort: { rir: 1, cap: 2 } },
      "all",
      2,
    );
    expect(text).toMatch(/^Set 2: 1 RIR, the plan asks for at least 2\. Count starts over\./);
  });
});
