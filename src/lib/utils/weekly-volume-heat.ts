import type { MuscleHeat } from "@/components/features/MuscleMap";
import { MUSCLES, type Muscle } from "@/lib/exercise-art/skeleton";

/**
 * Heat level per muscle from this week's sets: the way to the target minimum
 * is split into thirds (levels 1–3, so 1–3, 4–6 and 7–9 sets for a 10-set
 * target) and reaching the target is level 4. Groups the map does not draw
 * (cardio, full body) and untrained muscles are left out.
 */
export function weeklyVolumeHeat(rows: { muscleGroup: string; setCount: number; targetMin: number }[]): MuscleHeat {
  const heat: MuscleHeat = {};
  for (const row of rows) {
    if (row.setCount <= 0 || !(MUSCLES as readonly string[]).includes(row.muscleGroup)) continue;
    heat[row.muscleGroup as Muscle] =
      row.setCount >= row.targetMin ? 4 : (Math.min(3, Math.ceil((row.setCount / row.targetMin) * 3)) as 1 | 2 | 3);
  }
  return heat;
}
