/**
 * A workout split into warm-up, main set and cool-down, as the Today card and
 * the session page list it (docs/plans/bike-sessions.md, 5.1 and 5.2).
 */

import type { Workout, WorkoutNode } from "@/lib/utils/workout-steps";

export type WorkoutGroup = { kind: "warmup" | "main" | "cooldown"; nodes: WorkoutNode[] };

/** Leading warm-up steps, then the main set, then trailing cool-down steps. An empty group is left out. */
export function groupWorkout(w: Workout): WorkoutGroup[] {
  const nodes = w.steps;
  let start = 0;
  while (start < nodes.length && nodes[start].type === "warmup") start++;
  let end = nodes.length;
  while (end > start && nodes[end - 1].type === "cooldown") end--;
  const groups: WorkoutGroup[] = [
    { kind: "warmup", nodes: nodes.slice(0, start) },
    { kind: "main", nodes: nodes.slice(start, end) },
    { kind: "cooldown", nodes: nodes.slice(end) },
  ];
  return groups.filter((g) => g.nodes.length > 0);
}
