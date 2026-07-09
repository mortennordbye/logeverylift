import type { ProgramSet } from "@/types/workout";

export type SetFlatItem = { type: "set"; id: string; set: ProgramSet };
export type RestFlatItem = { type: "rest"; id: string; seconds: number };
export type FlatItem = SetFlatItem | RestFlatItem;

export function toFlatItems(sets: ProgramSet[]): FlatItem[] {
  const items: FlatItem[] = [];
  for (const set of sets) {
    items.push({ type: "set", id: `set-${set.id}`, set });
    if (Number(set.restTimeSeconds) > 0) {
      items.push({ type: "rest", id: `rest-${set.id}`, seconds: Number(set.restTimeSeconds) });
    }
  }
  return items;
}

/**
 * Derive ordered set IDs and rest assignments from a flat list.
 * Each rest is assigned to the nearest preceding set.
 * If no preceding set exists, falls back to the nearest following set.
 */
export function computeMapping(items: FlatItem[]): {
  orderedSetIds: number[];
  restAssignments: Map<number, number>;
} {
  const orderedSetIds = items
    .filter((i): i is SetFlatItem => i.type === "set")
    .map((i) => i.set.id);

  const restAssignments = new Map<number, number>(
    orderedSetIds.map((id) => [id, 0]),
  );

  for (let i = 0; i < items.length; i++) {
    if (items[i].type === "rest") {
      const restSeconds = (items[i] as RestFlatItem).seconds;
      let assigned = false;
      // Assign to nearest preceding set (always overwrite — last rest wins)
      for (let j = i - 1; j >= 0; j--) {
        if (items[j].type === "set") {
          const setId = (items[j] as SetFlatItem).set.id;
          restAssignments.set(setId, restSeconds);
          assigned = true;
          break;
        }
      }
      // No preceding set: fall back to nearest following set
      if (!assigned) {
        for (let j = i + 1; j < items.length; j++) {
          if (items[j].type === "set") {
            const setId = (items[j] as SetFlatItem).set.id;
            restAssignments.set(setId, restSeconds);
            break;
          }
        }
      }
    }
  }

  return { orderedSetIds, restAssignments };
}
