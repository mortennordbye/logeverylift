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

/**
 * Move the item `activeId` to the place of `overId`, as a drop does.
 *
 * A set moves together with the rests that follow it, because a rest is the
 * set's own (`restTimeSeconds`). Moved alone, the set left its rest behind:
 * computeMapping gave that rest to another set, and the set above the drop
 * point lost its rest (set 1 dragged below set 3 left set 3 at 0). A set
 * dragged down lands after the target and its rests; dragged up, before the
 * target set, or after a target rest so the set above keeps it. A rest
 * dragged alone moves alone.
 */
export function moveFlatItem(items: FlatItem[], activeId: string, overId: string): FlatItem[] {
  const from = items.findIndex((i) => i.id === activeId);
  const to = items.findIndex((i) => i.id === overId);
  if (from === -1 || to === -1 || from === to) return items;
  if (items[from].type === "rest") {
    const moved = [...items];
    moved.splice(to, 0, ...moved.splice(from, 1));
    return moved;
  }
  let end = from + 1;
  while (items[end]?.type === "rest") end++;
  // Dropped on its own rest: nothing moves.
  if (to > from && to < end) return items;
  const block = items.slice(from, end);
  const others = [...items.slice(0, from), ...items.slice(end)];
  const target = items[to];
  let at = others.indexOf(target);
  if (to > from) {
    at++;
    while (others[at]?.type === "rest") at++;
  } else if (target.type === "rest") {
    at++;
  }
  others.splice(at, 0, ...block);
  return others;
}
