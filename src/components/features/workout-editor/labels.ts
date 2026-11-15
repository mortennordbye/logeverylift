import type { WorkoutStep } from "@/lib/utils/workout-steps";

/** Step types as the editor names them (docs/plans/bike-sessions.md, 5.3). */
export const STEP_LABEL: Record<WorkoutStep["type"], string> = {
  warmup: "Warm-up",
  work: "Work",
  recovery: "Recovery",
  steady: "Steady",
  cooldown: "Cool-down",
  rest: "Rest",
};
