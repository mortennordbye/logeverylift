import { describe, expect, it } from "vitest";
import { computeMapping, moveFlatItem, toFlatItems } from "@/lib/utils/set-mapping";
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

// ─── moveFlatItem ─────────────────────────────────────────────────────────────

describe("moveFlatItem", () => {
  // Three sets, each with its own rest: [S1, R60, S2, R90, S3, R120].
  const items = () => toFlatItems([makeSet(1, 60), makeSet(2, 90), makeSet(3, 120)]);
  const rests = (moved: FlatItem[]) => Object.fromEntries(computeMapping(moved).restAssignments);

  it("moves a set dragged down with its rest, and every set keeps its own rest", () => {
    // The steps journey review (2026-11-16): set 1 dragged below set 3 left
    // set 3 with no rest, and set 1 took set 3's.
    const moved = moveFlatItem(items(), "set-1", "set-3");
    expect(computeMapping(moved).orderedSetIds).toEqual([2, 3, 1]);
    expect(rests(moved)).toEqual({ 1: 60, 2: 90, 3: 120 });
  });

  it("moves a set dragged up with its rest", () => {
    const moved = moveFlatItem(items(), "set-3", "set-1");
    expect(computeMapping(moved).orderedSetIds).toEqual([3, 1, 2]);
    expect(rests(moved)).toEqual({ 1: 60, 2: 90, 3: 120 });
  });

  it("drops a set dragged up onto a rest after that rest, so the set above keeps it", () => {
    const moved = moveFlatItem(items(), "set-3", "rest-1");
    expect(moved.map((i) => i.id)).toEqual(["set-1", "rest-1", "set-3", "rest-3", "set-2", "rest-2"]);
  });

  it("drops a set dragged down onto a rest after that rest", () => {
    const moved = moveFlatItem(items(), "set-1", "rest-2");
    expect(moved.map((i) => i.id)).toEqual(["set-2", "rest-2", "set-1", "rest-1", "set-3", "rest-3"]);
  });

  it("moves a set with no rest on its own", () => {
    const list = toFlatItems([makeSet(1), makeSet(2, 90), makeSet(3, 120)]);
    const moved = moveFlatItem(list, "set-1", "set-3");
    expect(moved.map((i) => i.id)).toEqual(["set-2", "rest-2", "set-3", "rest-3", "set-1"]);
  });

  it("moves a dragged rest on its own", () => {
    const moved = moveFlatItem(items(), "rest-1", "set-3");
    expect(moved.map((i) => i.id)).toEqual(["set-1", "set-2", "rest-2", "set-3", "rest-1", "rest-3"]);
  });

  it("leaves the list as it is for an unknown id", () => {
    const list = items();
    expect(moveFlatItem(list, "set-1", "set-9")).toBe(list);
  });
});
