/**
 * What the plan builder and the "own AI chat" page both read: the exercise
 * library, the profile fields the prompt uses, the best lift per exercise and
 * the names of the user's live programs. Server-only; takes a resolved userId.
 */

import { db } from "@/db";
import { exercisePrs } from "@/db/schema/exercise-prs";
import { exercises } from "@/db/schema/exercises";
import { programs } from "@/db/schema/programs";
import { users } from "@/db/schema/users";
import { getAllExercises } from "@/lib/actions/exercises";
import { livePrograms } from "@/lib/plan-live";
import { type PrData } from "@/lib/utils/ai-prompt";
import { parseUserGoals } from "@/lib/utils/goals";
import { and, eq, isNull } from "drizzle-orm";

export async function loadAiSetupData(userId: string) {
  const [exerciseResult, user, rawPrs, userPrograms] = await Promise.all([
    getAllExercises(),
    db.query.users.findFirst({ where: eq(users.id, userId) }),
    db
      .select({ exerciseName: exercises.name, prType: exercisePrs.prType, value: exercisePrs.value })
      .from(exercisePrs)
      .innerJoin(exercises, eq(exercisePrs.exerciseId, exercises.id))
      .where(and(eq(exercisePrs.userId, userId), isNull(exercisePrs.supersededAt))),
    db.select({ name: programs.name }).from(programs).where(and(eq(programs.userId, userId), livePrograms)),
  ]);

  const userProfile = {
    gender: user?.gender ?? null,
    birthYear: user?.birthYear ?? null,
    heightCm: user?.heightCm ?? null,
    weightKg: user?.weightKg ?? null,
    goals: parseUserGoals(user?.goals),
    experienceLevel: user?.experienceLevel ?? null,
  };

  // Deduplicate: one entry per exercise, preferring estimated_1rm over weight
  const prMap = new Map<string, PrData>();
  for (const pr of rawPrs) {
    const entry = prMap.get(pr.exerciseName) ?? { exerciseName: pr.exerciseName };
    if (pr.prType === "estimated_1rm") entry.estimated1rm = Math.round(Number(pr.value));
    else if (pr.prType === "weight" && !entry.estimated1rm) entry.maxWeight = Math.round(Number(pr.value));
    prMap.set(pr.exerciseName, entry);
  }

  return {
    exercises: exerciseResult.success ? exerciseResult.data : [],
    userProfile,
    prs: Array.from(prMap.values()),
    existingProgramNames: userPrograms.map((p) => p.name),
    aiConsented: !!user?.aiConsentAt,
  };
}
