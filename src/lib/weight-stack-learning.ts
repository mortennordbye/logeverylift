import { db } from "@/db";
import { exercises, programExercises, programs, users, workoutSessions, workoutSets } from "@/db/schema";
import { parseUserGoals } from "@/lib/utils/goals";
import { type Equipment, isCustomWeight } from "@/lib/utils/picker-options";
import { adaptiveIncrementKg, roundToNearest } from "@/lib/utils/progression";
import { pickStack } from "@/lib/utils/weight-stacks";
import { and, desc, eq, gt, inArray, isNull, max, or } from "drizzle-orm";

/**
 * Remember the stack pattern of each cable and machine exercise in a session,
 * and of exercises with no equipment recorded, whose weights are all we know.
 *
 * Two things in a slot's newest session teach a pattern:
 *  - a custom weight, which picks the most common pattern containing all of
 *    that session's working weights;
 *  - with no pattern yet, a jump up from the previous session that the app did
 *    not suggest. A 5 kg stack never produces a custom weight, because 20 and 25
 *    are both on the default ladder, so the gap is the only evidence of it.
 *
 * Accepting the app's own suggestion teaches nothing: that number came from the
 * app. Sets don't store what was suggested, so it is recomputed from the
 * previous session.
 *
 * Editing an older session changes nothing, so a correction months later can't
 * undo newer learning.
 *
 * Not a Server Action: it takes a userId, so it must never be callable from a
 * client. Callers pass the session's user. It runs inside saves that matter more
 * than it does, so it never throws.
 */
export async function learnWeightStacks(sessionId: number, userId: string): Promise<void> {
  try {
    const rows = await db
      .select({
        slotId: programExercises.id,
        weightStack: programExercises.weightStack,
        overloadIncrementKg: programExercises.overloadIncrementKg,
        exerciseTypeOverride: programExercises.exerciseType,
        exerciseTypeDefault: exercises.exerciseType,
        movementPattern: exercises.movementPattern,
        equipment: exercises.equipment,
        weightKg: workoutSets.weightKg,
      })
      .from(workoutSets)
      .innerJoin(workoutSessions, eq(workoutSessions.id, workoutSets.sessionId))
      .innerJoin(
        programExercises,
        and(
          eq(programExercises.id, workoutSets.programExerciseId),
          // A row logged before the slot's exercise was swapped says nothing
          // about the machine it uses now.
          eq(programExercises.exerciseId, workoutSets.exerciseId),
        ),
      )
      .innerJoin(programs, eq(programs.id, programExercises.programId))
      .innerJoin(exercises, eq(exercises.id, workoutSets.exerciseId))
      .where(
        and(
          eq(workoutSets.sessionId, sessionId),
          eq(workoutSessions.userId, userId),
          eq(programs.userId, userId),
          eq(workoutSets.setType, "working"),
          gt(workoutSets.weightKg, "0"),
          or(inArray(exercises.equipment, ["cable", "machine"]), isNull(exercises.equipment)),
        ),
      );
    if (rows.length === 0) return;

    const slots = new Map<number, typeof rows>();
    for (const row of rows) {
      slots.set(row.slotId, [...(slots.get(row.slotId) ?? []), row]);
    }

    const [profile] = await db
      .select({ experienceLevel: users.experienceLevel, goals: users.goals })
      .from(users)
      .where(eq(users.id, userId));
    const userGoals = parseUserGoals(profile?.goals);
    const goal = userGoals.includes("endurance") ? "endurance" : (userGoals[0] ?? null);

    for (const [slotId, sets] of slots) {
      const first = sets[0];
      const equipment = first.equipment as Equipment | null;
      const weights = sets.map((set) => Number(set.weightKg));
      const heaviest = Math.max(...weights);

      const [newest, previous] = await db
        .select({ sessionId: workoutSessions.id, heaviest: max(workoutSets.weightKg) })
        .from(workoutSets)
        .innerJoin(workoutSessions, eq(workoutSessions.id, workoutSets.sessionId))
        .where(
          and(
            eq(workoutSets.programExerciseId, slotId),
            eq(workoutSets.setType, "working"),
            eq(workoutSessions.userId, userId),
          ),
        )
        .groupBy(workoutSessions.id, workoutSessions.startTime)
        .orderBy(desc(workoutSessions.startTime), desc(workoutSessions.id))
        .limit(2);
      if (newest?.sessionId !== sessionId) continue;

      const previousKg = previous?.heaviest != null ? Number(previous.heaviest) : null;
      const movedUp = previousKg != null && previousKg > 0 && heaviest > previousKg;
      const increment = movedUp
        ? adaptiveIncrementKg(
            first.overloadIncrementKg != null ? Number(first.overloadIncrementKg) : null,
            previousKg,
            first.movementPattern,
            goal,
            profile?.experienceLevel,
            first.exerciseTypeOverride ?? first.exerciseTypeDefault,
            equipment,
          )
        : 0;
      const tookSuggestion =
        movedUp && Math.abs(heaviest - roundToNearest(previousKg + increment, increment)) < 0.001;

      const custom = weights.some(
        (kg) => isCustomWeight(kg, first.weightStack, equipment) && !(tookSuggestion && kg === heaviest),
      );
      const jumped = movedUp && !tookSuggestion && first.weightStack == null;

      // A custom weight may mean a different machine, so the old weights are no
      // evidence. A jump is only a gap because of them.
      const next = custom ? pickStack(weights) : jumped ? pickStack([previousKg, ...weights]) : null;
      if (next == null || next === first.weightStack) continue;

      await db
        .update(programExercises)
        .set({ weightStack: next })
        .where(eq(programExercises.id, slotId));
    }
  } catch (e) {
    console.error("[learnWeightStacks] failed", { sessionId }, e);
  }
}
