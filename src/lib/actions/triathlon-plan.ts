"use server";

import { db } from "@/db";
import {
  TRI_DISTANCES,
  exercises,
  programExercises,
  programSets,
  programs,
  seasonRaces,
  seasons,
  trainingCycleSlots,
  trainingCycles,
} from "@/db/schema";
import {
  buildTriathlonPlan,
  planDefaultsFromProfile,
  planExerciseNames,
  type PlanBlueprint,
  type PlanExercise,
  type PlanProgressionAdvance,
} from "@/lib/utils/triathlon-plan";
import { triathlonPhases } from "@/lib/utils/triathlon-phases";
import { PHASE_TYPE_LABELS } from "@/lib/utils/seasons";
import { getAthleteProfile } from "@/lib/athlete-profile";
import { enduranceEnabledFor } from "@/lib/endurance";
import { chainSeason, planWrite, type PlanWriteSession } from "@/lib/plan-revisions";
import { requireSession } from "@/lib/utils/session";
import { seasonFieldsSchema } from "@/lib/validators/seasons";
import type { ActionResult } from "@/types/workout";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

/**
 * "Make a triathlon plan" in New season (docs/plans/plan-tab-redesign.md, P4):
 * a season that ends on the A race, with one phase cycle per phase (general,
 * base, build, peak, taper) sized from the race date by triathlonPhases, the
 * taper ending on race day. Each phase gets the generator's week, its own
 * copy, with week 1 on that phase's curve.
 */
const generateTriathlonPlanSchema = seasonFieldsSchema.omit({ endDate: true }).extend({
  race: z.object({
    name: z.string().trim().min(1).max(100),
    raceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
    distance: z.enum(TRI_DISTANCES),
  }),
  restDays: z.array(z.number().int().min(1).max(7)).max(2).optional(),
  level: z.enum(["novice", "intermediate", "advanced"]).optional(),
  /** The user confirmed the first phase takes the scheduled start (addPhase `takeStart`). */
  takeStart: z.boolean().optional(),
});
// Canonical exercises the plan references. Endurance ones are new (discipline-tagged);
// the strength/plyometric lifts match the seed names so existing rows are reused, and
// a fresh (unseeded) DB still gets them. Inserted with onConflictDoNothing on name.
const ENSURED_EXERCISES = [
  { name: "Swim", category: "cardio", isTimed: false, bodyArea: "cardio", muscleGroup: "cardio", equipment: "bodyweight", movementPattern: "cardio", discipline: "swim", exerciseType: null },
  { name: "Bike", category: "cardio", isTimed: false, bodyArea: "cardio", muscleGroup: "cardio", equipment: "machine", movementPattern: "cardio", discipline: "bike", exerciseType: null },
  { name: "Run", category: "cardio", isTimed: false, bodyArea: "cardio", muscleGroup: "cardio", equipment: "bodyweight", movementPattern: "cardio", discipline: "run", exerciseType: null },
  // Workout A — Squat & Horizontal
  { name: "Front Squat", category: "strength", isTimed: false, bodyArea: "lower_body", muscleGroup: "quads", equipment: "barbell", movementPattern: "squat", discipline: null, exerciseType: "compound" },
  { name: "Dumbbell Bench Press", category: "strength", isTimed: false, bodyArea: "upper_body", muscleGroup: "chest", equipment: "dumbbell", movementPattern: "push", discipline: null, exerciseType: "compound" },
  { name: "Pendlay Row", category: "strength", isTimed: false, bodyArea: "upper_body", muscleGroup: "back", equipment: "barbell", movementPattern: "pull", discipline: null, exerciseType: "compound" },
  { name: "Bulgarian Split Squat", category: "strength", isTimed: false, bodyArea: "lower_body", muscleGroup: "quads", equipment: "dumbbell", movementPattern: "squat", discipline: null, exerciseType: "compound" },
  { name: "Seated Calf Raise", category: "strength", isTimed: false, bodyArea: "lower_body", muscleGroup: "calves", equipment: "machine", movementPattern: "push", discipline: null, exerciseType: "isolation" },
  // A timed hold, kept separate from Pallof Press so that row can stay rep-based.
  { name: "Pallof Hold", category: "strength", isTimed: true, bodyArea: "core", muscleGroup: "abs", equipment: "cable", movementPattern: "isometric", discipline: null, exerciseType: "isometric" },
  // Workout B — Hinge & Vertical
  { name: "Romanian Deadlift", category: "strength", isTimed: false, bodyArea: "lower_body", muscleGroup: "hamstrings", equipment: "barbell", movementPattern: "hinge", discipline: null, exerciseType: "compound" },
  { name: "Pull-up", category: "strength", isTimed: false, bodyArea: "upper_body", muscleGroup: "back", equipment: "bodyweight", movementPattern: "pull", discipline: null, exerciseType: "compound" },
  { name: "Dumbbell Shoulder Press", category: "strength", isTimed: false, bodyArea: "upper_body", muscleGroup: "shoulders", equipment: "dumbbell", movementPattern: "push", discipline: null, exerciseType: "compound" },
  { name: "Seated Leg Curl", category: "strength", isTimed: false, bodyArea: "lower_body", muscleGroup: "hamstrings", equipment: "machine", movementPattern: "pull", discipline: null, exerciseType: "isolation" },
  { name: "Face Pull", category: "strength", isTimed: false, bodyArea: "upper_body", muscleGroup: "shoulders", equipment: "cable", movementPattern: "pull", discipline: null, exerciseType: "isolation" },
  { name: "Cable Crunch", category: "strength", isTimed: false, bodyArea: "core", muscleGroup: "abs", equipment: "cable", movementPattern: "pull", discipline: null, exerciseType: "isolation" },
  // Plyometrics for the "get stronger" goal; the seed has both (scripts/seed.ts).
  { name: "Box Jump", category: "cardio", isTimed: false, bodyArea: "cardio", muscleGroup: "cardio", equipment: "bodyweight", movementPattern: "cardio", discipline: null, exerciseType: null },
  { name: "Pogo Hops", category: "cardio", isTimed: false, bodyArea: "cardio", muscleGroup: "cardio", equipment: "bodyweight", movementPattern: "cardio", discipline: null, exerciseType: null },
] as const;

const ENDURANCE_NAMES = ["Swim", "Bike", "Run"] as const;

export async function generateTriathlonPlan(data: unknown): Promise<ActionResult<{ seasonId: number }>> {
  const auth = await requireSession();
  const parsed = generateTriathlonPlanSchema.safeParse(data);
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid input",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const input = parsed.data;

  try {
    // Part of the endurance add-on; the form hides it, this holds the gate.
    if (!(await enduranceEnabledFor(auth.user.id))) {
      return { success: false, error: "Endurance features are not on for this account" };
    }
    const race = { raceDate: input.race.raceDate, discipline: "triathlon" as const, distance: input.race.distance, distanceMeters: null };
    const phases = triathlonPhases(input.startDate, race);
    if (typeof phases === "string") return { success: false, error: phases };

    // The level, rest days and strength part follow the athlete profile
    // (docs/plans/athlete-profile.md, 2.7). Read here, not taken from the
    // form: the profile owns them.
    const profile = await getAthleteProfile(auth.user.id);
    const defaults = planDefaultsFromProfile({
      availableDays: profile?.availableDays ?? null,
      enduranceLevel: profile?.enduranceLevel ?? null,
    });
    const level = input.level ?? defaults.level;
    const restDays = input.restDays ?? defaults.restDays;
    const plans = phases.map((p) =>
      buildTriathlonPlan({
        weeks: p.durationWeeks,
        restDays: restDays.length > 0 ? restDays : undefined,
        level,
        strengthGoal: profile?.strengthGoal ?? null,
        phaseType: p.phaseType,
      }),
    );
    const nameToId = await ensurePlanExercises([...new Set(plans.flatMap(planExerciseNames))]);
    if (!nameToId) return { success: false, error: "Could not resolve required exercises" };

    const { result: seasonId } = await planWrite({ userId: auth.user.id, writer: "user" }, async (w) => {
      const [season] = await w.tx
        .insert(seasons)
        .values({
          userId: auth.user.id,
          name: input.name,
          goal: input.goal ?? null,
          startDate: input.startDate,
          endDate: input.race.raceDate,
          nextGoal: input.nextGoal ?? null,
        })
        .returning({ id: seasons.id });
      w.create({ type: "season", id: season.id });
      // A new season's first race: nothing was planned before it, so no re-plan flag.
      await w.tx.insert(seasonRaces).values({
        seasonId: season.id,
        userId: auth.user.id,
        name: input.race.name,
        raceDate: input.race.raceDate,
        discipline: "triathlon",
        distance: input.race.distance,
        priority: "A",
      });

      for (const [i, phase] of phases.entries()) {
        const [cycle] = await w.tx
          .insert(trainingCycles)
          .values({
            userId: auth.user.id,
            name: phase.name,
            durationWeeks: phase.durationWeeks,
            durationDays: phase.durationDays,
            scheduleType: "day_of_week",
            goal: "build",
            athleteLevel: level,
            status: "draft",
            seasonId: season.id,
            phaseOrder: i + 1,
            phaseType: phase.phaseType,
          })
          .returning({ id: trainingCycles.id });
        w.create({ type: "cycle", id: cycle.id });
        await insertPlanWeek(w, cycle.id, plans[i], nameToId, PHASE_TYPE_LABELS[phase.phaseType]);
      }
      // A season that starts later gets its first phase scheduled for its start.
      // It takes the start from another block only when the user confirmed that.
      await chainSeason(w, season.id, { claim: input.takeStart === true });
      return season.id;
    });

    revalidatePath("/cycles");
    revalidatePath(`/seasons/${seasonId}`);
    revalidatePath("/");
    return { success: true, data: { seasonId } };
  } catch (err) {
    console.error("[generateTriathlonPlan] failed", err);
    return { success: false, error: "Failed to generate plan" };
  }
}

/** Make sure the plan's system exercises exist, and map their names to ids. Null when one cannot be found. */
async function ensurePlanExercises(neededNames: string[]): Promise<Map<string, number> | null> {
  // Ensure all referenced exercises exist (idempotent — keeps existing rows).
  await db
    .insert(exercises)
    .values(ENSURED_EXERCISES.map((e) => ({ ...e, isCustom: false })))
    .onConflictDoNothing({ target: exercises.name, where: isNull(exercises.userId) });

  // Backfill discipline on the canonical endurance rows if a pre-existing row lacked it.
  for (const name of ENDURANCE_NAMES) {
    const discipline = ENSURED_EXERCISES.find((e) => e.name === name)!.discipline!;
    await db
      .update(exercises)
      .set({ discipline })
      .where(and(eq(exercises.name, name), isNull(exercises.userId), isNull(exercises.discipline)));
  }

  const rows = await db
    .select({ id: exercises.id, name: exercises.name })
    .from(exercises)
    // System rows only: another user may have a custom exercise of the same name.
    .where(and(inArray(exercises.name, neededNames), isNull(exercises.userId)));
  const nameToId = new Map(rows.map((r) => [r.name, r.id]));
  const missing = neededNames.filter((n) => !nameToId.has(n));
  if (missing.length > 0) {
    console.error("[generateTriathlonPlan] unresolved exercises", { missing });
    return null;
  }
  return nameToId;
}

/**
 * One cycle's week: a slot per day, each training day with its own program.
 * Each phase has its own copies (their week content differs), so a program's
 * name starts with the phase, "Base · Long Run", to keep them apart and
 * grouped in the program list.
 */
async function insertPlanWeek(w: PlanWriteSession, cycleId: number, plan: PlanBlueprint, nameToId: Map<string, number>, phaseWord: string) {
  const tx = w.tx;
  for (const day of plan.days) {
    // Rest day: a slot with no program.
    if (day.exercises.length === 0) {
      await tx.insert(trainingCycleSlots).values({
        trainingCycleId: cycleId,
        dayOfWeek: day.dayOfWeek,
        label: day.label,
        programId: null,
      });
      continue;
    }

    const [program] = await tx
      .insert(programs)
      .values({ userId: w.ctx.userId, name: `${phaseWord} · ${day.label}`, createdByCycleId: cycleId })
      .returning({ id: programs.id });
    w.create({ type: "program", id: program.id });

    let orderIndex = 0;
    for (const ex of day.exercises) {
      await insertPlanExercise(tx, program.id, nameToId.get(ex.name)!, orderIndex, ex);
      orderIndex++;
    }

    await tx.insert(trainingCycleSlots).values({
      trainingCycleId: cycleId,
      dayOfWeek: day.dayOfWeek,
      label: day.label,
      programId: program.id,
      autoComplete: day.autoComplete,
    });
  }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The retired mode each advance corresponds to. See E-12 on the staged retirement. */
const LEGACY_MODE_FOR_ADVANCE: Record<PlanProgressionAdvance, string> = {
  manual: "manual",
  distance: "distance",
  load: "weight",
  reps: "reps",
  duration: "time",
};

async function insertPlanExercise(
  tx: Tx,
  programId: number,
  exerciseId: number,
  orderIndex: number,
  ex: PlanExercise,
): Promise<void> {
  const [pe] = await tx
    .insert(programExercises)
    .values({
      programId,
      exerciseId,
      orderIndex,
      progressionAdvance: ex.progressionAdvance,
      // Still written while the column exists, so a share or an export of a
      // generated plan carries something a pre-axes client can read.
      progressionMode: LEGACY_MODE_FOR_ADVANCE[ex.progressionAdvance],
      overloadIncrementReps: ex.overloadIncrementReps,
      overloadIncrementKg:
        ex.overloadIncrementKg != null ? String(ex.overloadIncrementKg) : null,
      // The plan is authoritative about each exercise's role in the program, so
      // persist it as an explicit override (independent of the library default).
      exerciseType: ex.exerciseType ?? null,
    })
    .returning({ id: programExercises.id });

  await tx.insert(programSets).values(
    ex.sets.map((s, i) => ({
      programExerciseId: pe.id,
      setNumber: i + 1,
      targetReps: s.targetReps ?? null,
      weightKg: s.weightKg != null ? String(s.weightKg) : null,
      durationSeconds: s.durationSeconds ?? null,
      startDelaySeconds: s.startDelaySeconds ?? null,
      distanceMeters: s.distanceMeters ?? null,
      peakDistanceMeters: s.peakDistanceMeters ?? null,
      targetHeartRateZone: s.targetHeartRateZone ?? null,
      sessionRole: s.sessionRole ?? null,
      restTimeSeconds: s.restTimeSeconds,
      setType: s.setType ?? "working",
      targetRir: s.targetRir ?? null,
    })),
  );
}
