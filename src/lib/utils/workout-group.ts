/**
 * A workout split into warm-up, main set and cool-down, as the Today card and
 * the session page list it (docs/plans/bike-sessions.md, 5.1 and 5.2).
 */

import type { Workout, WorkoutNode } from "@/lib/utils/workout-steps";

export type WorkoutGroup = { kind: "warmup" | "main" | "cooldown"; nodes: WorkoutNode[] };

/** Contract stub: the whole workout as one main group. S2 builds the real split. */
export function groupWorkout(w: Workout): WorkoutGroup[] {
  return [{ kind: "main", nodes: w.steps }];
}
