import { describe, expect, it } from "vitest";
import { computeMapping, toFlatItems } from "@/lib/utils/set-mapping";
import type { FlatItem } from "@/lib/utils/set-mapping";
import type { ProgramSet } from "@/types/workout";

function makeSet(id: number, restTimeSeconds = 0): ProgramSet {
  return {
    id,
    programExerciseId: 1,
    setNumber: id,
    targetReps: 10,
    weightKg: "50.00",
    durationSeconds: null,
    restTimeSeconds,
  } as ProgramSet;
}

function set(id: number): FlatItem {
  return { type: "set", id: `set-${id}`, set: makeSet(id) };
}

function rest(id: string, seconds: number): FlatItem {
  return { type: "rest", id, seconds };
}

// ─── toFlatItems ──────────────────────────────────────────────────────────────

describe("toFlatItems", () => {
  it("returns only set items when no rests", () => {
    const sets = [makeSet(1), makeSet(2)];
    const items = toFlatItems(sets);
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.type === "set")).toBe(true);
  });

  it("interleaves rest after set when restTimeSeconds > 0", () => {
    const sets = [makeSet(1, 60), makeSet(2)];
    const items = toFlatItems(sets);
    expect(items).toHaveLength(3);
    expect(items[0].type).toBe("set");
    expect(items[1].type).toBe("rest");
    expect(items[2].type).toBe("set");
  });

  it("skips rest when restTimeSeconds is 0", () => {
    const sets = [makeSet(1, 0), makeSet(2, 0)];
    expect(toFlatItems(sets)).toHaveLength(2);
  });

  it("returns empty array for empty input", () => {
    expect(toFlatItems([])).toHaveLength(0);
  });
});

// ─── computeMapping ───────────────────────────────────────────────────────────

describe("computeMapping", () => {
  it("returns empty collections for empty input", () => {
    const { orderedSetIds, restAssignments } = computeMapping([]);
    expect(orderedSetIds).toHaveLength(0);
    expect(restAssignments.size).toBe(0);
  });

  it("returns all sets with 0 rest when no rests in list", () => {
    const items: FlatItem[] = [set(1), set(2), set(3)];
    const { orderedSetIds, restAssignments } = computeMapping(items);
    expect(orderedSetIds).toEqual([1, 2, 3]);
    expect(restAssignments.get(1)).toBe(0);
    expect(restAssignments.get(2)).toBe(0);
    expect(restAssignments.get(3)).toBe(0);
  });

  it("assigns rest to the preceding set", () => {
    // [Set1, Set2, Rest60, Set3] → Rest goes to Set2
    const items: FlatItem[] = [set(1), set(2), rest("r1", 60), set(3)];
    const { restAssignments } = computeMapping(items);
    expect(restAssignments.get(1)).toBe(0);
    expect(restAssignments.get(2)).toBe(60);
    expect(restAssignments.get(3)).toBe(0);
  });

  it("assigns rest at start to the following set", () => {
    // [Rest60, Set1, Set2] → Rest goes to Set1
    const items: FlatItem[] = [rest("r1", 60), set(1), set(2)];
    const { restAssignments } = computeMapping(items);
    expect(restAssignments.get(1)).toBe(60);
    expect(restAssignments.get(2)).toBe(0);
  });

  it("preserves set order", () => {
    const items: FlatItem[] = [set(3), set(1), set(2)];
    const { orderedSetIds } = computeMapping(items);
    expect(orderedSetIds).toEqual([3, 1, 2]);
  });

  it("overwrites with the last rest when consecutive rests follow a set", () => {
    // [Set1, Rest60, Rest90, Set2]
    // Rest60 → assigns to Set1 (preceding)
    // Rest90 → finds Set1 as preceding, overwrites with 90 (last rest wins)
    //          → Set2 keeps rest=0
    const items: FlatItem[] = [set(1), rest("r1", 60), rest("r2", 90), set(2)];
    const { restAssignments } = computeMapping(items);
    expect(restAssignments.get(1)).toBe(90);
    expect(restAssignments.get(2)).toBe(0);
  });

  it("handles a trailing rest after last set", () => {
    // [Set1, Set2, Rest60] → Rest goes to Set2
    const items: FlatItem[] = [set(1), set(2), rest("r1", 60)];
    const { restAssignments } = computeMapping(items);
    expect(restAssignments.get(2)).toBe(60);
    expect(restAssignments.get(1)).toBe(0);
  });

  it("handles a single set with no rests", () => {
    const items: FlatItem[] = [set(1)];
    const { orderedSetIds, restAssignments } = computeMapping(items);
    expect(orderedSetIds).toEqual([1]);
    expect(restAssignments.get(1)).toBe(0);
  });

  it("handles only rests with no sets", () => {
    const items: FlatItem[] = [rest("r1", 60), rest("r2", 90)];
    const { orderedSetIds, restAssignments } = computeMapping(items);
    expect(orderedSetIds).toHaveLength(0);
    expect(restAssignments.size).toBe(0);
  });
});
