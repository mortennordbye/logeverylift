import { db } from "@/db";
import { exercises, programExercises, programs, users, workoutSessions, workoutSets } from "@/db/schema";
import { parseUserGoals } from "@/lib/utils/goals";
import { type Equipment, isCustomWeight } from "@/lib/utils/picker-options";
import { adaptiveIncrementKg, roundToNearest } from "@/lib/utils/progression";
import { pickStack, pickStackForStep, stackRungs } from "@/lib/utils/weight-stacks";
import { and, desc, eq, gt, inArray, isNull, or } from "drizzle-orm";

/**
 * Remember the stack pattern of each cable and machine exercise in a session,
 * and of exercises with no equipment recorded, whose weights are all we know.
 *
 * Two things in a slot's newest session teach a pattern:
 *  - a custom weight, which picks the most common pattern containing all of
 *    that session's working weights;
 *  - with no pattern yet, a weight not lifted before, exactly one step of a
 *    pattern above the closest weight below it, which the app did not suggest. A
 *    5 kg stack never produces a custom weight, because 20 and 25 are both on the
 *    default ladder, so the step is the only evidence of it. Returning to a weight
 *    already lifted proves nothing, and neither does a jump of several steps.
 *
 * Sets don't store what the app suggested, so the checks for "that was the app's
 * own number" work from the increment it would have used.
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
        exerciseId: workoutSets.exerciseId,
        weightStack: programExercises.weightStack,
        overloadIncrementKg: programExercises.overloadIncrementKg,
        progressionAdvance: programExercises.progressionAdvance,
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

      const history = await db
        .select({ sessionId: workoutSessions.id, weightKg: workoutSets.weightKg })
        .from(workoutSets)
        .innerJoin(workoutSessions, eq(workoutSessions.id, workoutSets.sessionId))
        .where(
          and(
            eq(workoutSets.programExerciseId, slotId),
            eq(workoutSets.exerciseId, first.exerciseId),
            eq(workoutSets.setType, "working"),
            eq(workoutSessions.userId, userId),
          ),
        )
        .orderBy(desc(workoutSessions.startTime), desc(workoutSessions.id));
      if (history[0]?.sessionId !== sessionId) continue;
      const earlier = history.filter((row) => row.sessionId !== sessionId);

      let next: string | null = null;
      if (stackRungs(first.weightStack)) {
        // A learned stack is a claim about the machine, and any weight off it
        // disproves that, including one the app would have suggested without it.
        if (weights.some((kg) => isCustomWeight(kg, first.weightStack, equipment))) {
          next = pickStack(weights);
        }
      } else {
        const incrementAt = (loadKg: number) =>
          adaptiveIncrementKg(
            first.overloadIncrementKg != null ? Number(first.overloadIncrementKg) : null,
            loadKg,
            first.movementPattern,
            goal,
            profile?.experienceLevel,
            first.exerciseTypeOverride ?? first.exerciseTypeDefault,
            equipment,
          );
        const lifted = earlier.map((row) => Number(row.weightKg));
        const lastSessionId = earlier[0]?.sessionId;
        const lastHeaviest = Math.max(
          0,
          ...earlier.filter((row) => row.sessionId === lastSessionId).map((row) => Number(row.weightKg)),
        );
        // Manual and off slots are never offered a weight, so nothing they log
        // can be the app's own number.
        const appSuggests = first.progressionAdvance !== "manual" && first.progressionAdvance !== "none";
        // The app only ever suggests multiples of its increment, whether as a
        // step up, a hold or a lighter set. Once it has had a session to suggest
        // from, or the lifter set the increment themselves, a weight on that grid
        // says nothing about the machine.
        const trustGrid = (appSuggests && lifted.length > 0) || first.overloadIncrementKg != null;
        const onAppGrid = (kg: number) => {
          const increment = incrementAt(kg);
          return trustGrid && increment > 0 && Math.abs(roundToNearest(kg, increment) - kg) < 0.001;
        };

        if (weights.some((kg) => isCustomWeight(kg, null, equipment) && !onAppGrid(kg))) {
          // Only this session: earlier weights may be from another machine.
          next = pickStack(weights);
        } else if (heaviest > lastHeaviest && !lifted.includes(heaviest)) {
          // Up from last time, which rules out the app's back-offs, and measured
          // from the closest weight below, so neither a dip nor one older heavy
          // session hides the step.
          const below = Math.max(0, ...lifted.filter((kg) => kg < heaviest));
          if (below > 0) {
            const increment = incrementAt(below);
            const tookSuggestion =
              appSuggests && Math.abs(roundToNearest(below + increment, increment) - heaviest) < 0.001;
            if (!tookSuggestion) next = pickStackForStep(below, heaviest, weights);
          }
        }
      }
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
