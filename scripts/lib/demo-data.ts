/**
 * The demo account's programs, cycle and four weeks of history.
 *
 * Shared by `scripts/seed-fake.ts` (a dev account, random history) and the e2e
 * reset (`e2e/fixtures/reset.ts`), which passes a seeded `random` so every spec
 * starts from the same data: suggestions and PR rows depend on the history, and
 * a spec that passes on one random draw and fails on the next is not a test.
 */

import { inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../src/db/schema";
import {
  exercises,
  programExercises,
  programSets,
  programs,
  trainingCycleSlots,
  trainingCycles,
  workoutSessions,
  workoutSets,
} from "../../src/db/schema";
import { rpeFromRir } from "../../src/lib/utils/rir";

export type SeedDb = Pick<NodePgDatabase<typeof schema>, "insert" | "select">;

/**
 * Effort for one seeded set, logged about two-thirds of the time.
 *
 * A tap on the set toggle records that the set happened, not how hard it was,
 * so seeded history has to contain unknowns too — otherwise the demo account is
 * the only place where every set carries an effort value and the code paths that
 * handle a missing one never run locally.
 */
function seededEffort(intendedRir: number, random: () => number): { rir: number | null; rpe: number | null } {
  if (random() < 0.35) return { rir: null, rpe: null };
  const rir = Math.max(0, Math.min(5, intendedRir));
  return { rir, rpe: rpeFromRir(rir) };
}

// ── Program definitions ────────────────────────────────────────────────────

type SetBlueprint = {
  setNumber: number;
  restTimeSeconds: number;
  // Rep-based sets carry targetReps + weightKg; timed sets (Plank and friends)
  // carry durationSeconds instead and leave both null, which is what the set
  // summary keys off to render mm:ss rather than "8 x 70kg".
  targetReps?: number;
  weightKg?: number;
  durationSeconds?: number;
  // Double progression's range. The seeded programme carries exactly one
  // exercise with it, because until the preset picker lands (phase 5 of
  // docs/progression-revamp-plan.md) nothing in the app can configure a range,
  // and a scheme nobody can see is a scheme nobody tests.
  repRangeMin?: number;
  repRangeMax?: number;
  targetRir?: number;
};

type ExerciseBlueprint = {
  name: string;
  /** Axis 6. Defaults to the column default ("manual") when absent. */
  progressionAdvance?: string;
  sets: SetBlueprint[];
};

type ProgramBlueprint = {
  name: string;
  exercises: ExerciseBlueprint[];
};

const PROGRAMS: ProgramBlueprint[] = [
  {
    name: "Push Pull Legs A",
    exercises: [
      {
        // Plain load progression, the common case: fixed reps, no cap, clears
        // on the target alone.
        name: "Bench Press",
        progressionAdvance: "load",
        sets: [
          { setNumber: 1, targetReps: 8, weightKg: 80, restTimeSeconds: 90 },
          { setNumber: 2, targetReps: 8, weightKg: 80, restTimeSeconds: 90 },
          { setNumber: 3, targetReps: 8, weightKg: 80, restTimeSeconds: 90 },
          { setNumber: 4, targetReps: 8, weightKg: 80, restTimeSeconds: 90 },
        ],
      },
      {
        // The capped one. Seeded effort is only logged about two thirds of the
        // time, so this exercise actually produces unknown sessions and the
        // "log effort to progress" path is reachable in a dev account.
        name: "Incline Dumbbell Press",
        progressionAdvance: "load",
        sets: [
          { setNumber: 1, targetReps: 10, weightKg: 30, restTimeSeconds: 75, targetRir: 2 },
          { setNumber: 2, targetReps: 10, weightKg: 30, restTimeSeconds: 75, targetRir: 2 },
          { setNumber: 3, targetReps: 10, weightKg: 30, restTimeSeconds: 75, targetRir: 2 },
        ],
      },
      {
        name: "Tricep Pushdown",
        // The demonstrable double-progression exercise: work 8 up to 12, then
        // add load and drop back to 8.
        progressionAdvance: "double",
        sets: [
          { setNumber: 1, targetReps: 12, weightKg: 25, restTimeSeconds: 60, repRangeMin: 8, repRangeMax: 12 },
          { setNumber: 2, targetReps: 12, weightKg: 25, restTimeSeconds: 60, repRangeMin: 8, repRangeMax: 12 },
          { setNumber: 3, targetReps: 12, weightKg: 25, restTimeSeconds: 60, repRangeMin: 8, repRangeMax: 12 },
        ],
      },
    ],
  },
  {
    name: "Upper Body",
    exercises: [
      {
        name: "Pull-up",
        sets: [
          { setNumber: 1, targetReps: 8, weightKg: 0, restTimeSeconds: 90 },
          { setNumber: 2, targetReps: 8, weightKg: 0, restTimeSeconds: 90 },
          { setNumber: 3, targetReps: 8, weightKg: 0, restTimeSeconds: 90 },
        ],
      },
      {
        name: "Barbell Row",
        sets: [
          { setNumber: 1, targetReps: 8, weightKg: 70, restTimeSeconds: 90 },
          { setNumber: 2, targetReps: 8, weightKg: 70, restTimeSeconds: 90 },
          { setNumber: 3, targetReps: 8, weightKg: 70, restTimeSeconds: 90 },
          { setNumber: 4, targetReps: 8, weightKg: 70, restTimeSeconds: 90 },
        ],
      },
      {
        name: "Overhead Press",
        sets: [
          { setNumber: 1, targetReps: 8, weightKg: 50, restTimeSeconds: 90 },
          { setNumber: 2, targetReps: 8, weightKg: 50, restTimeSeconds: 90 },
          { setNumber: 3, targetReps: 8, weightKg: 50, restTimeSeconds: 90 },
        ],
      },
      {
        // Timed exercise: keeps the countdown/auto-complete path represented in
        // seeded data. Without one, the timed-set flow has nothing to walk.
        name: "Plank",
        sets: [
          { setNumber: 1, durationSeconds: 45, restTimeSeconds: 60 },
          { setNumber: 2, durationSeconds: 45, restTimeSeconds: 60 },
          { setNumber: 3, durationSeconds: 60, restTimeSeconds: 60 },
        ],
      },
    ],
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────

function jitter(value: number, range: number, random: () => number): number {
  return Math.round((value + (random() * range * 2 - range)) * 100) / 100;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function toDateString(date: Date): string {
  return date.toISOString().split("T")[0];
}

/** Returns the most recent Monday on or before the given date */
function lastMonday(from: Date): Date {
  const d = new Date(from);
  const day = d.getDay(); // 0=Sun, 1=Mon, …
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}


/**
 * Insert the demo programs, cycle and history for `userId`. Expects the user
 * to have none yet; callers clear first.
 */
export async function seedDemoData(
  db: SeedDb,
  userId: string,
  random: () => number = Math.random,
): Promise<void> {
  // ── 1. Fetch exercise IDs by name ────────────────────────────────────────
  const exerciseNames = PROGRAMS.flatMap((p) => p.exercises.map((e) => e.name));
  const exerciseRows = await db
    .select({ id: exercises.id, name: exercises.name })
    .from(exercises)
    .where(inArray(exercises.name, exerciseNames));

  const exerciseIdByName = new Map(exerciseRows.map((e) => [e.name, e.id]));

  for (const name of exerciseNames) {
    if (!exerciseIdByName.has(name)) {
      console.warn(`⚠️  Exercise not found in DB: "${name}" — skipping`);
    }
  }

  // ── 2. Create programs with exercises and sets ───────────────────────────
  const createdPrograms: Array<{
    id: number;
    blueprint: ProgramBlueprint;
    exerciseMap: Map<
      string,
      {
        programExerciseId: number;
        blueprint: ExerciseBlueprint;
        /** program_sets.id per set number — workout_sets records the slot it was logged against. */
        setIdByNumber: Map<number, number>;
      }
    >;
  }> = [];

  for (const blueprint of PROGRAMS) {
    const [program] = await db
      .insert(programs)
      .values({ userId, name: blueprint.name })
      .returning({ id: programs.id });

    const exerciseMap = new Map<
      string,
      {
        programExerciseId: number;
        blueprint: ExerciseBlueprint;
        setIdByNumber: Map<number, number>;
      }
    >();

    for (let i = 0; i < blueprint.exercises.length; i++) {
      const exBlueprint = blueprint.exercises[i];
      const exerciseId = exerciseIdByName.get(exBlueprint.name);
      if (!exerciseId) continue;

      const [pe] = await db
        .insert(programExercises)
        .values({
          programId: program.id,
          exerciseId,
          orderIndex: i,
          ...(exBlueprint.progressionAdvance
            ? { progressionAdvance: exBlueprint.progressionAdvance }
            : {}),
        })
        .returning({ id: programExercises.id });

      const insertedSets = await db
        .insert(programSets)
        .values(
          exBlueprint.sets.map((s) => ({
            programExerciseId: pe.id,
            setNumber: s.setNumber,
            targetReps: s.targetReps ?? null,
            weightKg: s.weightKg?.toString() ?? null,
            durationSeconds: s.durationSeconds ?? null,
            restTimeSeconds: s.restTimeSeconds,
            targetRir: s.targetRir ?? null,
            repRangeMin: s.repRangeMin ?? null,
            repRangeMax: s.repRangeMax ?? null,
          }))
        )
        .returning({ id: programSets.id, setNumber: programSets.setNumber });

      exerciseMap.set(exBlueprint.name, {
        programExerciseId: pe.id,
        blueprint: exBlueprint,
        setIdByNumber: new Map(insertedSets.map((ps) => [ps.setNumber, ps.id])),
      });
    }

    createdPrograms.push({ id: program.id, blueprint, exerciseMap });
  }

  // ── 3. Create training cycle ─────────────────────────────────────────────
  const today = new Date();
  const startDate = addDays(lastMonday(today), -28); // ~4 weeks ago

  const pplProgram = createdPrograms.find(
    (p) => p.blueprint.name === "Push Pull Legs A"
  );
  const upperProgram = createdPrograms.find(
    (p) => p.blueprint.name === "Upper Body"
  );

  const [cycle] = await db
    .insert(trainingCycles)
    .values({
      userId,
      name: "12-Week Strength Block",
      durationWeeks: 12,
      scheduleType: "day_of_week",
      startDate: toDateString(startDate),
      status: "active",
      endAction: "none",
    })
    .returning({ id: trainingCycles.id });

  // Mon=1, Wed=3, Fri=5
  if (pplProgram) {
    await db.insert(trainingCycleSlots).values([
      { trainingCycleId: cycle.id, dayOfWeek: 1, programId: pplProgram.id, label: "Push" },
      { trainingCycleId: cycle.id, dayOfWeek: 5, programId: pplProgram.id, label: "Push" },
    ]);
  }
  if (upperProgram) {
    await db.insert(trainingCycleSlots).values([
      { trainingCycleId: cycle.id, dayOfWeek: 3, programId: upperProgram.id, label: "Upper" },
    ]);
  }

  // ── 4. Create workout sessions (4 weeks, Mon/Wed/Fri) ────────────────────
  // Schedule: Mon → PPL, Wed → Upper, Fri → PPL
  const schedule: Array<{ dayOffset: number; program: typeof createdPrograms[0] }> = [];

  const monday = lastMonday(today);

  for (let week = 0; week < 4; week++) {
    const weekStart = addDays(monday, -28 + week * 7);
    const dayOffsets = [0, 2, 4]; // Mon, Wed, Fri
    const sessionPrograms = [pplProgram, upperProgram, pplProgram];

    for (let d = 0; d < 3; d++) {
      const sessionDate = addDays(weekStart, dayOffsets[d]);
      // Skip future dates
      if (sessionDate >= today) continue;
      const prog = sessionPrograms[d];
      if (!prog) continue;
      schedule.push({ dayOffset: 0, program: prog });

      const startTime = new Date(sessionDate);
      startTime.setHours(7, 0, 0, 0);
      const endTime = new Date(startTime);
      endTime.setMinutes(endTime.getMinutes() + 60);

      const [session] = await db
        .insert(workoutSessions)
        .values({
          userId,
          programId: prog.id,
          date: toDateString(sessionDate),
          startTime,
          endTime,
          isCompleted: true,
        })
        .returning({ id: workoutSessions.id });

      // Log sets for each exercise in the program
      for (const exBlueprint of prog.blueprint.exercises) {
        const exerciseId = exerciseIdByName.get(exBlueprint.name);
        if (!exerciseId) continue;

        // Roughly one exercise in eight loses its last set. An account where
        // every session logs every prescribed set never exercises the
        // "unknown" verdict the session gate hangs on, so the dot detail view
        // has nothing to explain locally.
        const dropsLastSet =
          exBlueprint.sets.length > 1 && random() < 0.12;

        for (const [setIndex, setBlueprint] of exBlueprint.sets.entries()) {
          if (dropsLastSet && setIndex === exBlueprint.sets.length - 1) continue;
          const effort = seededEffort(2 + Math.floor(random() * 3), random); // RIR 2-4
          const slot = prog.exerciseMap.get(exBlueprint.name);

          // A timed set has no reps or load to vary — jitter the hold instead.
          // actualReps and weightKg are NOT NULL, so they record 1 x 0kg.
          const isTimedSet = setBlueprint.durationSeconds != null;
          const actualReps = isTimedSet
            ? 1
            : Math.max(1, (setBlueprint.targetReps ?? 1) + Math.round(random() * 2 - 1));
          const weightKg = isTimedSet ? 0 : jitter(setBlueprint.weightKg ?? 0, 2.5, random);

          await db.insert(workoutSets).values({
            sessionId: session.id,
            exerciseId,
            programExerciseId: slot?.programExerciseId ?? null,
            programSetId: slot?.setIdByNumber.get(setBlueprint.setNumber) ?? null,
            setType: "working",
            prescribedWorkingSets: exBlueprint.sets.length,
            setNumber: setBlueprint.setNumber,
            targetReps: setBlueprint.targetReps ?? null,
            actualReps,
            weightKg: weightKg.toString(),
            durationSeconds: isTimedSet
              ? Math.max(10, Math.round(jitter(setBlueprint.durationSeconds!, 5, random)))
              : null,
            rir: effort.rir,
            rpe: effort.rpe,
            restTimeSeconds: setBlueprint.restTimeSeconds,
            isCompleted: true,
          });
        }
      }
    }
  }
}
