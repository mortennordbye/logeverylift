"use server";

import { inArray, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
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
} from "@/db/schema";
import { ForbiddenError, requireAdmin, requireSession } from "@/lib/utils/session";
import { DEMO_USER_EMAIL, DEMO_USER_NAME } from "@/lib/constants/demo";
import { ActionResult } from "@/types/workout";

// ── Helpers ────────────────────────────────────────────────────────────────

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function toDateString(date: Date): string {
  return date.toISOString().split("T")[0];
}

function lastMonday(from: Date): Date {
  const d = new Date(from);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

// ── Program definitions ────────────────────────────────────────────────────

type SetBlueprint = {
  setNumber: number;
  targetReps: number;
  weightKg: number;
  restTimeSeconds: number;
};

type ExerciseBlueprint = {
  name: string;
  /** kg added to every set's weight each week (always a multiple of 2.5) */
  weeklyIncrementKg: number;
  sets: SetBlueprint[];
};

type ProgramBlueprint = {
  name: string;
  exercises: ExerciseBlueprint[];
};

const FAKE_PROGRAMS: ProgramBlueprint[] = [
  {
    name: "Push Pull Legs A",
    exercises: [
      {
        name: "Bench Press",
        weeklyIncrementKg: 2.5,
        sets: [
          { setNumber: 1, targetReps: 8, weightKg: 80, restTimeSeconds: 90 },
          { setNumber: 2, targetReps: 8, weightKg: 80, restTimeSeconds: 90 },
          { setNumber: 3, targetReps: 8, weightKg: 80, restTimeSeconds: 90 },
          { setNumber: 4, targetReps: 8, weightKg: 80, restTimeSeconds: 90 },
        ],
      },
      {
        name: "Incline Dumbbell Press",
        weeklyIncrementKg: 2.5,
        sets: [
          { setNumber: 1, targetReps: 10, weightKg: 30, restTimeSeconds: 75 },
          { setNumber: 2, targetReps: 10, weightKg: 30, restTimeSeconds: 75 },
          { setNumber: 3, targetReps: 10, weightKg: 30, restTimeSeconds: 75 },
        ],
      },
      {
        name: "Tricep Pushdown",
        weeklyIncrementKg: 2.5,
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
        weeklyIncrementKg: 2.5,
        sets: [
          { setNumber: 1, targetReps: 8, weightKg: 0, restTimeSeconds: 90 },
          { setNumber: 2, targetReps: 8, weightKg: 0, restTimeSeconds: 90 },
          { setNumber: 3, targetReps: 8, weightKg: 0, restTimeSeconds: 90 },
        ],
      },
      {
        name: "Barbell Row",
        weeklyIncrementKg: 2.5,
        sets: [
          { setNumber: 1, targetReps: 8, weightKg: 70, restTimeSeconds: 90 },
          { setNumber: 2, targetReps: 8, weightKg: 70, restTimeSeconds: 90 },
          { setNumber: 3, targetReps: 8, weightKg: 70, restTimeSeconds: 90 },
          { setNumber: 4, targetReps: 8, weightKg: 70, restTimeSeconds: 90 },
        ],
      },
      {
        name: "Overhead Press",
        weeklyIncrementKg: 2.5,
        sets: [
          { setNumber: 1, targetReps: 8, weightKg: 50, restTimeSeconds: 90 },
          { setNumber: 2, targetReps: 8, weightKg: 50, restTimeSeconds: 90 },
          { setNumber: 3, targetReps: 8, weightKg: 50, restTimeSeconds: 90 },
        ],
      },
    ],
  },
];

// ── Demo program definitions ───────────────────────────────────────────────
// Push/Pull/Legs — 3×/week, Mon/Wed/Fri. Weights represent an intermediate
// lifter mid-block; 6 weeks of history shows clear progressive overload.

const DEMO_PROGRAMS: ProgramBlueprint[] = [
  {
    name: "Push",
    exercises: [
      {
        // Week 1 @ 87.5 → Week 6 @ 100kg — clean progression toward the 100kg milestone
        name: "Bench Press",
        weeklyIncrementKg: 2.5,
        sets: [
          { setNumber: 1, targetReps: 5, weightKg: 87.5, restTimeSeconds: 180 },
          { setNumber: 2, targetReps: 5, weightKg: 87.5, restTimeSeconds: 180 },
          { setNumber: 3, targetReps: 5, weightKg: 87.5, restTimeSeconds: 180 },
          { setNumber: 4, targetReps: 5, weightKg: 87.5, restTimeSeconds: 180 },
        ],
      },
      {
        name: "Incline Dumbbell Press",
        weeklyIncrementKg: 2.5,
        sets: [
          { setNumber: 1, targetReps: 10, weightKg: 32.5, restTimeSeconds: 90 },
          { setNumber: 2, targetReps: 10, weightKg: 32.5, restTimeSeconds: 90 },
          { setNumber: 3, targetReps: 10, weightKg: 32.5, restTimeSeconds: 90 },
        ],
      },
      {
        name: "Overhead Press",
        weeklyIncrementKg: 1.25,
        sets: [
          { setNumber: 1, targetReps: 8, weightKg: 52.5, restTimeSeconds: 120 },
          { setNumber: 2, targetReps: 8, weightKg: 52.5, restTimeSeconds: 120 },
          { setNumber: 3, targetReps: 8, weightKg: 52.5, restTimeSeconds: 120 },
        ],
      },
      {
        name: "Cable Lateral Raise",
        weeklyIncrementKg: 0,
        sets: [
          { setNumber: 1, targetReps: 15, weightKg: 10, restTimeSeconds: 60 },
          { setNumber: 2, targetReps: 15, weightKg: 10, restTimeSeconds: 60 },
          { setNumber: 3, targetReps: 15, weightKg: 10, restTimeSeconds: 60 },
        ],
      },
      {
        name: "Tricep Pushdown",
        weeklyIncrementKg: 2.5,
        sets: [
          { setNumber: 1, targetReps: 12, weightKg: 30, restTimeSeconds: 60 },
          { setNumber: 2, targetReps: 12, weightKg: 30, restTimeSeconds: 60 },
          { setNumber: 3, targetReps: 12, weightKg: 30, restTimeSeconds: 60 },
        ],
      },
    ],
  },
  {
    name: "Pull",
    exercises: [
      {
        // Week 1 @ 120 → Week 6 @ 145kg
        name: "Deadlift",
        weeklyIncrementKg: 5,
        sets: [
          { setNumber: 1, targetReps: 5, weightKg: 120, restTimeSeconds: 240 },
          { setNumber: 2, targetReps: 5, weightKg: 120, restTimeSeconds: 240 },
          { setNumber: 3, targetReps: 5, weightKg: 120, restTimeSeconds: 240 },
        ],
      },
      {
        name: "Pull-up",
        weeklyIncrementKg: 0,
        sets: [
          { setNumber: 1, targetReps: 8, weightKg: 0, restTimeSeconds: 120 },
          { setNumber: 2, targetReps: 8, weightKg: 0, restTimeSeconds: 120 },
          { setNumber: 3, targetReps: 8, weightKg: 0, restTimeSeconds: 120 },
          { setNumber: 4, targetReps: 8, weightKg: 0, restTimeSeconds: 120 },
        ],
      },
      {
        name: "Seated Cable Row",
        weeklyIncrementKg: 2.5,
        sets: [
          { setNumber: 1, targetReps: 10, weightKg: 65, restTimeSeconds: 90 },
          { setNumber: 2, targetReps: 10, weightKg: 65, restTimeSeconds: 90 },
          { setNumber: 3, targetReps: 10, weightKg: 65, restTimeSeconds: 90 },
        ],
      },
      {
        name: "Face Pull",
        weeklyIncrementKg: 0,
        sets: [
          { setNumber: 1, targetReps: 15, weightKg: 22.5, restTimeSeconds: 60 },
          { setNumber: 2, targetReps: 15, weightKg: 22.5, restTimeSeconds: 60 },
          { setNumber: 3, targetReps: 15, weightKg: 22.5, restTimeSeconds: 60 },
        ],
      },
      {
        name: "Barbell Curl",
        weeklyIncrementKg: 2.5,
        sets: [
          { setNumber: 1, targetReps: 10, weightKg: 42.5, restTimeSeconds: 60 },
          { setNumber: 2, targetReps: 10, weightKg: 42.5, restTimeSeconds: 60 },
          { setNumber: 3, targetReps: 10, weightKg: 42.5, restTimeSeconds: 60 },
        ],
      },
    ],
  },
  {
    name: "Legs",
    exercises: [
      {
        // Week 1 @ 100 → Week 6 @ 112.5kg
        name: "Squat",
        weeklyIncrementKg: 2.5,
        sets: [
          { setNumber: 1, targetReps: 5, weightKg: 100, restTimeSeconds: 240 },
          { setNumber: 2, targetReps: 5, weightKg: 100, restTimeSeconds: 240 },
          { setNumber: 3, targetReps: 5, weightKg: 100, restTimeSeconds: 240 },
          { setNumber: 4, targetReps: 5, weightKg: 100, restTimeSeconds: 240 },
        ],
      },
      {
        name: "Romanian Deadlift",
        weeklyIncrementKg: 2.5,
        sets: [
          { setNumber: 1, targetReps: 8, weightKg: 80, restTimeSeconds: 120 },
          { setNumber: 2, targetReps: 8, weightKg: 80, restTimeSeconds: 120 },
          { setNumber: 3, targetReps: 8, weightKg: 80, restTimeSeconds: 120 },
        ],
      },
      {
        name: "Leg Press",
        weeklyIncrementKg: 5,
        sets: [
          { setNumber: 1, targetReps: 10, weightKg: 140, restTimeSeconds: 90 },
          { setNumber: 2, targetReps: 10, weightKg: 140, restTimeSeconds: 90 },
          { setNumber: 3, targetReps: 10, weightKg: 140, restTimeSeconds: 90 },
        ],
      },
      {
        name: "Leg Curl",
        weeklyIncrementKg: 2.5,
        sets: [
          { setNumber: 1, targetReps: 12, weightKg: 47.5, restTimeSeconds: 60 },
          { setNumber: 2, targetReps: 12, weightKg: 47.5, restTimeSeconds: 60 },
          { setNumber: 3, targetReps: 12, weightKg: 47.5, restTimeSeconds: 60 },
        ],
      },
      {
        name: "Calf Raise",
        weeklyIncrementKg: 5,
        sets: [
          { setNumber: 1, targetReps: 15, weightKg: 80, restTimeSeconds: 60 },
          { setNumber: 2, targetReps: 15, weightKg: 80, restTimeSeconds: 60 },
          { setNumber: 3, targetReps: 15, weightKg: 80, restTimeSeconds: 60 },
          { setNumber: 4, targetReps: 15, weightKg: 80, restTimeSeconds: 60 },
        ],
      },
    ],
  },
];

async function seedDemoDataForUser(userId: string): Promise<void> {
  const exerciseNames = DEMO_PROGRAMS.flatMap((p) =>
    p.exercises.map((e) => e.name)
  );
  const exerciseRows = await db
    .select({ id: exercises.id, name: exercises.name })
    .from(exercises)
    .where(inArray(exercises.name, exerciseNames));

  const exerciseIdByName = new Map(exerciseRows.map((e) => [e.name, e.id]));

  const createdPrograms: Array<{ id: number; blueprint: ProgramBlueprint }> = [];

  for (const blueprint of DEMO_PROGRAMS) {
    const [program] = await db
      .insert(programs)
      .values({ userId, name: blueprint.name })
      .returning({ id: programs.id });

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
    }

    createdPrograms.push({ id: program.id, blueprint });
  }

  // Training cycle: "Push Pull Legs" — Mon/Wed/Fri (3×/week), 6 weeks in
  const today = new Date();
  const startDate = addDays(lastMonday(today), -42); // 6 weeks back

  const pushProgram = createdPrograms.find((p) => p.blueprint.name === "Push");
  const pullProgram = createdPrograms.find((p) => p.blueprint.name === "Pull");
  const legsProgram = createdPrograms.find((p) => p.blueprint.name === "Legs");

  const [cycle] = await db
    .insert(trainingCycles)
    .values({
      userId,
      name: "Push Pull Legs",
      durationWeeks: 12,
      scheduleType: "day_of_week",
      startDate: toDateString(startDate),
      status: "active",
      endAction: "none",
    })
    .returning({ id: trainingCycles.id });

  type SlotValue = { trainingCycleId: number; dayOfWeek: number; programId: number; label: string };
  const slotValues: SlotValue[] = [
    pushProgram ? { trainingCycleId: cycle.id, dayOfWeek: 1, programId: pushProgram.id, label: "Push" } : null,
    pullProgram ? { trainingCycleId: cycle.id, dayOfWeek: 3, programId: pullProgram.id, label: "Pull" } : null,
    legsProgram ? { trainingCycleId: cycle.id, dayOfWeek: 5, programId: legsProgram.id, label: "Legs" } : null,
  ].filter((v): v is SlotValue => v !== null);

  if (slotValues.length > 0) {
    await db.insert(trainingCycleSlots).values(slotValues);
  }

  // Workout history: Mon/Wed/Fri over past 6 weeks — clear progressive overload
  const monday = lastMonday(today);
  // dayOffset 0=Mon, 2=Wed, 4=Fri; matched to Push/Pull/Legs
  const schedule = [
    { dayOffset: 0, prog: pushProgram },
    { dayOffset: 2, prog: pullProgram },
    { dayOffset: 4, prog: legsProgram },
  ];

  for (let week = 0; week < 6; week++) {
    const weekStart = addDays(monday, -42 + week * 7);

    for (const { dayOffset, prog } of schedule) {
      if (!prog) continue;
      const sessionDate = addDays(weekStart, dayOffset);
      if (sessionDate >= today) continue;

      // Vary workout start time slightly to look natural (6:30–8:30am)
      const startHour = 6 + Math.floor(Math.random() * 3);
      const startMin = Math.random() < 0.5 ? 0 : 30;
      const startTime = new Date(sessionDate);
      startTime.setHours(startHour, startMin, 0, 0);

      // Duration: 55–75 min, heavier weeks take a little longer
      const durationMin = 55 + week * 2 + Math.floor(Math.random() * 10);
      const endTime = new Date(startTime);
      endTime.setMinutes(endTime.getMinutes() + durationMin);

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

      for (const exBlueprint of prog.blueprint.exercises) {
        const exerciseId = exerciseIdByName.get(exBlueprint.name);
        if (!exerciseId) continue;

        for (const setBlueprint of exBlueprint.sets) {
          const weightKg = setBlueprint.weightKg + week * exBlueprint.weeklyIncrementKg;
          // Mostly hit target; early weeks occasionally beat it by 1 rep
          const bonusRep = week < 3 && Math.random() < 0.3 ? 1 : 0;
          const actualReps = setBlueprint.targetReps + bonusRep;
          // RPE climbs as weight increases: week 0 ≈ 7, week 5 ≈ 9
          const rpe = Math.min(10, 7 + Math.round(week * 0.4) + (Math.random() < 0.4 ? 1 : 0));

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
}

// ── Actions ────────────────────────────────────────────────────────────────

export async function adminResetUserData(): Promise<ActionResult<{ sessions: number; programs: number; cycles: number }>> {
  const auth = await requireSession();
  if (auth.session.impersonatedBy) {
    return { success: false, error: "Cannot reset data while impersonating another user." };
  }
  const userId = auth.user.id;
  try {
    const deletedSessions = await db
      .delete(workoutSessions)
      .where(eq(workoutSessions.userId, userId))
      .returning({ id: workoutSessions.id });

    const deletedPrograms = await db
      .delete(programs)
      .where(eq(programs.userId, userId))
      .returning({ id: programs.id });

    const deletedCycles = await db
      .delete(trainingCycles)
      .where(eq(trainingCycles.userId, userId))
      .returning({ id: trainingCycles.id });

    revalidatePath("/", "layout");

    return {
      success: true,
      data: {
        sessions: deletedSessions.length,
        programs: deletedPrograms.length,
        cycles: deletedCycles.length,
      },
    };
  } catch (err) {
    if (err instanceof ForbiddenError) return { success: false, error: err.message };
    console.error("[adminResetUserData] failed", err);
    return { success: false, error: "Failed to reset user data" };
  }
}

async function seedDataForUser(userId: string): Promise<{ programs: number; sessions: number }> {
  // Fetch exercise IDs by name
  const exerciseNames = FAKE_PROGRAMS.flatMap((p) =>
    p.exercises.map((e) => e.name)
  );
  const exerciseRows = await db
    .select({ id: exercises.id, name: exercises.name })
    .from(exercises)
    .where(inArray(exercises.name, exerciseNames));

  const exerciseIdByName = new Map(exerciseRows.map((e) => [e.name, e.id]));

  // Create programs
  const createdPrograms: Array<{
    id: number;
    blueprint: ProgramBlueprint;
  }> = [];

  for (const blueprint of FAKE_PROGRAMS) {
    const [program] = await db
      .insert(programs)
      .values({ userId, name: blueprint.name })
      .returning({ id: programs.id });

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
    }

    createdPrograms.push({ id: program.id, blueprint });
  }

  // Create training cycle
  const today = new Date();
  const startDate = addDays(lastMonday(today), -28);

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

  // Create workout sessions (Mon/Wed/Fri over past 4 weeks)
  const monday = lastMonday(today);
  let sessionCount = 0;

  for (let week = 0; week < 4; week++) {
    const weekStart = addDays(monday, -28 + week * 7);
    const dayOffsets = [0, 2, 4];
    const sessionPrograms = [pplProgram, upperProgram, pplProgram];

    for (let d = 0; d < 3; d++) {
      const sessionDate = addDays(weekStart, dayOffsets[d]);
      if (sessionDate >= today) continue;
      const prog = sessionPrograms[d];
      if (!prog) continue;

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

      for (const exBlueprint of prog.blueprint.exercises) {
        const exerciseId = exerciseIdByName.get(exBlueprint.name);
        if (!exerciseId) continue;

        for (const setBlueprint of exBlueprint.sets) {
          // Progressive overload: add increment each week, always a clean multiple of 2.5
          const weightKg = setBlueprint.weightKg + week * exBlueprint.weeklyIncrementKg;
          // Reps always hit target; occasionally +1 when weights are lighter (early weeks)
          const actualReps = setBlueprint.targetReps + (week < 2 && Math.random() < 0.25 ? 1 : 0);
          const rpe = 6 + week + (Math.random() < 0.4 ? 1 : 0); // harder as weeks progress

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

      sessionCount++;
    }
  }

  return { programs: createdPrograms.length, sessions: sessionCount };
}

export async function adminSeedFakeData(): Promise<ActionResult<{ programs: number; sessions: number }>> {
  const auth = await requireSession();
  if (auth.session.impersonatedBy) {
    return { success: false, error: "Cannot seed data while impersonating another user." };
  }
  try {
    const data = await seedDataForUser(auth.user.id);
    revalidatePath("/", "layout");
    return { success: true, data };
  } catch (err) {
    if (err instanceof ForbiddenError) return { success: false, error: err.message };
    console.error("[adminSeedFakeData] failed", err);
    return { success: false, error: "Failed to seed fake data" };
  }
}

async function wipeDemoUserData(demoUserId: string): Promise<void> {
  await db.delete(workoutSessions).where(eq(workoutSessions.userId, demoUserId));
  await db.delete(programs).where(eq(programs.userId, demoUserId));
  await db.delete(trainingCycles).where(eq(trainingCycles.userId, demoUserId));
}

export async function adminPrepareDemoUser(forceReseed = false): Promise<ActionResult<{ userId: string }>> {
  try {
    const auth = await requireAdmin();
    if (auth.session.impersonatedBy) {
      return { success: false, error: "Cannot enter demo mode while impersonating another user." };
    }
    // Find or create demo user
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, DEMO_USER_EMAIL))
      .limit(1);

    let demoUserId: string;

    if (existing.length === 0) {
      const now = new Date();
      const [created] = await db
        .insert(users)
        .values({
          id: crypto.randomUUID(),
          name: DEMO_USER_NAME,
          email: DEMO_USER_EMAIL,
          emailVerified: false,
          role: "user",
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: users.id });
      demoUserId = created.id;
    } else {
      demoUserId = existing[0].id;
    }

    // Seed data if empty or force-reseed requested
    const existingPrograms = await db
      .select({ id: programs.id })
      .from(programs)
      .where(eq(programs.userId, demoUserId))
      .limit(1);

    if (existingPrograms.length === 0 || forceReseed) {
      if (forceReseed) await wipeDemoUserData(demoUserId);
      await seedDemoDataForUser(demoUserId);
    }

    return { success: true, data: { userId: demoUserId } };
  } catch (e) {
    if (e instanceof ForbiddenError) return { success: false, error: e.message };
    console.error("[adminPrepareDemoUser] failed", e);
    return { success: false, error: "Failed to prepare demo user" };
  }
}
