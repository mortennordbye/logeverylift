/**
 * Fake data seed script
 *
 * Populates DEMO_USER_ID=1 with realistic programs, a training cycle,
 * and 4 weeks of workout history. Safe to run multiple times — exits
 * early if fake data already exists unless --force flag is passed.
 *
 * Usage (inside Docker):
 *   docker-compose exec app pnpm db:seed-fake
 *   docker-compose exec app pnpm db:seed-fake --force  # wipe first
 */

import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import {
  exercises,
  programExercises,
  programSets,
  programs,
  trainingCycleSlots,
  trainingCycles,
  users,
  workoutSessions,
  workoutSets,
} from "../src/db/schema";

const FORCE = process.argv.includes("--force");

// ── Program definitions ────────────────────────────────────────────────────

type SetBlueprint = {
  setNumber: number;
  targetReps: number;
  weightKg: number;
  restTimeSeconds: number;
};

type ExerciseBlueprint = {
  name: string;
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
        name: "Bench Press",
        sets: [
          { setNumber: 1, targetReps: 8, weightKg: 80, restTimeSeconds: 90 },
          { setNumber: 2, targetReps: 8, weightKg: 80, restTimeSeconds: 90 },
          { setNumber: 3, targetReps: 8, weightKg: 80, restTimeSeconds: 90 },
          { setNumber: 4, targetReps: 8, weightKg: 80, restTimeSeconds: 90 },
        ],
      },
      {
        name: "Incline Dumbbell Press",
        sets: [
          { setNumber: 1, targetReps: 10, weightKg: 30, restTimeSeconds: 75 },
          { setNumber: 2, targetReps: 10, weightKg: 30, restTimeSeconds: 75 },
          { setNumber: 3, targetReps: 10, weightKg: 30, restTimeSeconds: 75 },
        ],
      },
      {
        name: "Tricep Pushdown",
        sets: [
          { setNumber: 1, targetReps: 12, weightKg: 25, restTimeSeconds: 60 },
          { setNumber: 2, targetReps: 12, weightKg: 25, restTimeSeconds: 60 },
          { setNumber: 3, targetReps: 12, weightKg: 25, restTimeSeconds: 60 },
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
    ],
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────

function jitter(value: number, range: number): number {
  return Math.round((value + (Math.random() * range * 2 - range)) * 100) / 100;
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

// ── Main ───────────────────────────────────────────────────────────────────

async function seedFake() {
  console.log("🏋️  Seeding fake data...");

  // Resolve user ID
  const targetEmail = process.env.USER_EMAIL;
  const user = targetEmail
    ? await db.query.users.findFirst({ where: eq(users.email, targetEmail) })
    : await db.query.users.findFirst();

  if (!user) {
    console.error("❌ No users found. Run `pnpm create-admin` first.");
    process.exit(1);
  }
  const DEMO_USER_ID = user.id;
  console.log(`👤 Seeding for user: ${user.email}`);

  // Check if fake data already exists
  const existingPrograms = await db
    .select({ id: programs.id })
    .from(programs)
    .where(eq(programs.userId, DEMO_USER_ID));

  if (existingPrograms.length > 0 && !FORCE) {
    console.log(
      `ℹ️  Demo user already has ${existingPrograms.length} program(s). Run with --force to overwrite.`
    );
    process.exit(0);
  }

  if (FORCE && existingPrograms.length > 0) {
    console.log("🗑️  --force: clearing existing user data first...");
    await db
      .delete(workoutSessions)
      .where(eq(workoutSessions.userId, DEMO_USER_ID));
    await db.delete(programs).where(eq(programs.userId, DEMO_USER_ID));
    await db
      .delete(trainingCycles)
      .where(eq(trainingCycles.userId, DEMO_USER_ID));
    console.log("✅ Cleared");
  }

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
    exerciseMap: Map<string, { programExerciseId: number; blueprint: ExerciseBlueprint }>;
  }> = [];

  for (const blueprint of PROGRAMS) {
    const [program] = await db
      .insert(programs)
      .values({ userId: DEMO_USER_ID, name: blueprint.name })
      .returning({ id: programs.id });

    const exerciseMap = new Map<
      string,
      { programExerciseId: number; blueprint: ExerciseBlueprint }
    >();

    for (let i = 0; i < blueprint.exercises.length; i++) {
      const exBlueprint = blueprint.exercises[i];
      const exerciseId = exerciseIdByName.get(exBlueprint.name);
      if (!exerciseId) continue;

      const [pe] = await db
        .insert(programExercises)
        .values({ programId: program.id, exerciseId, orderIndex: i })
        .returning({ id: programExercises.id });

      await db.insert(programSets).values(
        exBlueprint.sets.map((s) => ({
          programExerciseId: pe.id,
          setNumber: s.setNumber,
          targetReps: s.targetReps,
          weightKg: s.weightKg.toString(),
          restTimeSeconds: s.restTimeSeconds,
        }))
      );

      exerciseMap.set(exBlueprint.name, {
        programExerciseId: pe.id,
        blueprint: exBlueprint,
      });
    }

    createdPrograms.push({ id: program.id, blueprint, exerciseMap });
    console.log(`✅ Created program: ${blueprint.name}`);
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
      userId: DEMO_USER_ID,
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

  console.log("✅ Created training cycle: 12-Week Strength Block");

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
          userId: DEMO_USER_ID,
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

        for (const setBlueprint of exBlueprint.sets) {
          const actualReps = Math.max(
            1,
            setBlueprint.targetReps + Math.round(Math.random() * 2 - 1)
          );
          const weightKg = jitter(setBlueprint.weightKg, 2.5);
          const rpe = 6 + Math.floor(Math.random() * 3); // 6, 7, or 8

          await db.insert(workoutSets).values({
            sessionId: session.id,
            exerciseId,
            setNumber: setBlueprint.setNumber,
            targetReps: setBlueprint.targetReps,
            actualReps,
            weightKg: weightKg.toString(),
            rpe,
            restTimeSeconds: setBlueprint.restTimeSeconds,
            isCompleted: true,
          });
        }
      }
    }
  }

  const sessionCount = await db
    .select({ id: workoutSessions.id })
    .from(workoutSessions)
    .where(eq(workoutSessions.userId, DEMO_USER_ID));

  console.log(`✅ Created ${sessionCount.length} workout sessions with sets`);
  console.log("✅ Fake data seeding completed");
  process.exit(0);
}

seedFake().catch((err) => {
  console.error("❌ Fake seed failed:", err);
  process.exit(1);
});
