"use server";

import { db } from "@/db";
import { exercises, programs, workoutSessions, workoutSets } from "@/db/schema";
import { ForbiddenError, assertOwner, requireSession } from "@/lib/utils/session";
import {
  completeWorkoutSessionSchema,
  createWorkoutSessionSchema,
} from "@/lib/validators/workout";
import type { ActionResult, ExportedSessions, WorkoutSession } from "@/types/workout";
import { and, asc, desc, eq, inArray, lt } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export async function createWorkoutSession(
  data: unknown,
): Promise<ActionResult<WorkoutSession>> {
  const auth = await requireSession();

  const validation = createWorkoutSessionSchema.safeParse(data);
  if (!validation.success) {
    return {
      success: false,
      error: "Invalid input data",
      fieldErrors: validation.error.flatten().fieldErrors,
    };
  }

  try {
    const { date, startTime, notes, programId, intendedDate } = validation.data;

    // Sweep orphaned open sessions for this user. Without this, a user who
    // closes the tab mid-workout leaves a `isCompleted=false` row that
    // lingers forever; subsequent `createWorkoutSession` calls compound the
    // mess. Bound to >1h to avoid clobbering a legitimate concurrent start.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    await db
      .update(workoutSessions)
      .set({ isCompleted: true, endTime: new Date() })
      .where(
        and(
          eq(workoutSessions.userId, auth.user.id),
          eq(workoutSessions.isCompleted, false),
          lt(workoutSessions.startTime, oneHourAgo),
        ),
      );

    const [session] = await db
      .insert(workoutSessions)
      .values({
        userId: auth.user.id,
        date,
        startTime: startTime ? new Date(startTime) : new Date(),
        notes,
        programId,
        intendedDate,
        isCompleted: false,
      })
      .returning();

    revalidatePath("/workout");
    revalidatePath(`/workout/${session.id}`);
    return { success: true, data: session };
  } catch (error) {
    console.error("[createWorkoutSession] failed", error);
    return { success: false, error: "Failed to create workout session." };
  }
}

export async function completeWorkoutSession(
  data: unknown,
): Promise<ActionResult<WorkoutSession>> {
  const auth = await requireSession();

  const validation = completeWorkoutSessionSchema.safeParse(data);
  if (!validation.success) {
    return {
      success: false,
      error: "Invalid input data",
      fieldErrors: validation.error.flatten().fieldErrors,
    };
  }

  try {
    const { sessionId, endTime, notes, feeling } = validation.data;

    const [existing] = await db
      .select({ userId: workoutSessions.userId })
      .from(workoutSessions)
      .where(eq(workoutSessions.id, sessionId));
    assertOwner(existing, auth.user.id);

    const [session] = await db
      .update(workoutSessions)
      .set({
        endTime: endTime ? new Date(endTime) : new Date(),
        notes,
        feeling,
        isCompleted: true,
      })
      .where(eq(workoutSessions.id, sessionId))
      .returning();

    revalidatePath("/workout");
    revalidatePath(`/workout/${sessionId}`);
    revalidatePath("/history");
    return { success: true, data: session };
  } catch (e) {
    if (e instanceof ForbiddenError) return { success: false, error: e.message };
    console.error("[completeWorkoutSession] failed", e);
    return { success: false, error: "Failed to complete workout session." };
  }
}

/**
 * Failsafe: auto-complete the current user's workout sessions that have been
 * left open (isCompleted=false) for more than 10 hours. A user who forgets to
 * tap "Finish" — or whose tab was evicted mid-workout — would otherwise leave a
 * row open indefinitely. Logged sets are kept; we just close out the session.
 *
 * Called on home-screen load so it runs without needing a new workout to start
 * (the createWorkoutSession sweep only fires on the next start).
 */
export async function closeStaleOpenSessions(): Promise<void> {
  const auth = await requireSession();
  try {
    const tenHoursAgo = new Date(Date.now() - 10 * 60 * 60 * 1000);
    await db
      .update(workoutSessions)
      .set({ isCompleted: true, endTime: new Date() })
      .where(
        and(
          eq(workoutSessions.userId, auth.user.id),
          eq(workoutSessions.isCompleted, false),
          lt(workoutSessions.startTime, tenHoursAgo),
        ),
      );
  } catch (e) {
    console.error("[closeStaleOpenSessions] failed", e);
  }
}

export async function deleteWorkoutSession(
  sessionId: number,
): Promise<ActionResult<undefined>> {
  const auth = await requireSession();

  try {
    const [existing] = await db
      .select({ userId: workoutSessions.userId })
      .from(workoutSessions)
      .where(eq(workoutSessions.id, sessionId));
    assertOwner(existing, auth.user.id);

    await db.delete(workoutSessions).where(eq(workoutSessions.id, sessionId));
    revalidatePath("/history");
    revalidatePath("/");
    return { success: true, data: undefined };
  } catch (e) {
    if (e instanceof ForbiddenError) return { success: false, error: e.message };
    console.error("[deleteWorkoutSession] failed", e);
    return { success: false, error: "Failed to delete workout session" };
  }
}

type LastSession = {
  feeling: string | null;
  notes: string | null;
  date: string;
  durationMinutes: number;
};

export async function getLastCompletedSession(
  programId: number,
): Promise<ActionResult<LastSession | null>> {
  const auth = await requireSession();
  try {
    const session = await db.query.workoutSessions.findFirst({
      where: (s, { eq, and }) =>
        and(
          eq(s.userId, auth.user.id),
          eq(s.programId, programId),
          eq(s.isCompleted, true),
        ),
      orderBy: (s, { desc }) => [desc(s.startTime)],
    });
    if (!session) return { success: true, data: null };
    const durationMinutes =
      session.endTime && session.startTime
        ? Math.max(1, Math.round((session.endTime.getTime() - session.startTime.getTime()) / 60000))
        : 0;
    return {
      success: true,
      data: {
        feeling: session.feeling ?? null,
        notes: session.notes ?? null,
        date: session.date,
        durationMinutes,
      },
    };
  } catch (error) {
    console.error("[getLastCompletedSession] failed", error);
    return { success: false, error: "Failed to fetch last session" };
  }
}

/**
 * Bulk export of every completed session + its sets for the authenticated user.
 * The client renders this as a JSON download for backup / analysis / migration
 * to another tool. Mirrors the program export pattern in actions/programs.ts.
 */
export async function exportAllSessions(): Promise<ActionResult<ExportedSessions>> {
  const auth = await requireSession();
  const userId = auth.user.id;
  try {
    const sessions = await db
      .select({
        id: workoutSessions.id,
        date: workoutSessions.date,
        startTime: workoutSessions.startTime,
        endTime: workoutSessions.endTime,
        notes: workoutSessions.notes,
        feeling: workoutSessions.feeling,
        readiness: workoutSessions.readiness,
        programName: programs.name,
      })
      .from(workoutSessions)
      .leftJoin(programs, eq(workoutSessions.programId, programs.id))
      .where(
        and(
          eq(workoutSessions.userId, userId),
          eq(workoutSessions.isCompleted, true),
        ),
      )
      .orderBy(desc(workoutSessions.startTime));

    if (sessions.length === 0) {
      return {
        success: true,
        data: { version: 1, exportedAt: new Date().toISOString(), sessions: [] },
      };
    }

    const sessionIds = sessions.map((s) => s.id);
    const setsAll = await db
      .select({
        sessionId: workoutSets.sessionId,
        exerciseName: exercises.name,
        setNumber: workoutSets.setNumber,
        targetReps: workoutSets.targetReps,
        actualReps: workoutSets.actualReps,
        weightKg: workoutSets.weightKg,
        durationSeconds: workoutSets.durationSeconds,
        distanceMeters: workoutSets.distanceMeters,
        inclinePercent: workoutSets.inclinePercent,
        heartRateZone: workoutSets.heartRateZone,
        rpe: workoutSets.rpe,
        restTimeSeconds: workoutSets.restTimeSeconds,
        isCompleted: workoutSets.isCompleted,
      })
      .from(workoutSets)
      .innerJoin(exercises, eq(workoutSets.exerciseId, exercises.id))
      .where(inArray(workoutSets.sessionId, sessionIds))
      .orderBy(asc(workoutSets.sessionId), asc(workoutSets.setNumber));

    const setsBySession = new Map<number, ExportedSessions["sessions"][number]["sets"]>();
    for (const r of setsAll) {
      const list = setsBySession.get(r.sessionId) ?? [];
      list.push({
        exerciseName: r.exerciseName,
        setNumber: r.setNumber,
        targetReps: r.targetReps ?? null,
        actualReps: r.actualReps,
        weightKg: Number(r.weightKg),
        durationSeconds: r.durationSeconds ?? null,
        distanceMeters: r.distanceMeters ?? null,
        inclinePercent: r.inclinePercent ?? null,
        heartRateZone: r.heartRateZone ?? null,
        rpe: r.rpe,
        restTimeSeconds: r.restTimeSeconds,
        isCompleted: r.isCompleted,
      });
      setsBySession.set(r.sessionId, list);
    }

    return {
      success: true,
      data: {
        version: 1,
        exportedAt: new Date().toISOString(),
        sessions: sessions.map((s) => ({
          id: s.id,
          date: s.date,
          startTime: s.startTime.toISOString(),
          endTime: s.endTime ? s.endTime.toISOString() : null,
          notes: s.notes ?? null,
          feeling: s.feeling ?? null,
          readiness: s.readiness ?? null,
          programName: s.programName ?? null,
          sets: setsBySession.get(s.id) ?? [],
        })),
      },
    };
  } catch (error) {
    console.error("[exportAllSessions] failed", error);
    return { success: false, error: "Failed to export sessions" };
  }
}

/**
 * Record the user's pre-workout readiness score (1–5) on the active session.
 * Called once when the user responds to the readiness check-in sheet.
 */
export async function setSessionReadiness(
  sessionId: number,
  readiness: number,
): Promise<ActionResult<undefined>> {
  const auth = await requireSession();

  if (!Number.isInteger(readiness) || readiness < 1 || readiness > 5) {
    return { success: false, error: "Readiness must be an integer between 1 and 5" };
  }
  try {
    const [existing] = await db
      .select({ userId: workoutSessions.userId })
      .from(workoutSessions)
      .where(eq(workoutSessions.id, sessionId));
    assertOwner(existing, auth.user.id);

    await db
      .update(workoutSessions)
      .set({ readiness })
      .where(eq(workoutSessions.id, sessionId));
    return { success: true, data: undefined };
  } catch (e) {
    if (e instanceof ForbiddenError) return { success: false, error: e.message };
    console.error("[setSessionReadiness] failed", e);
    return { success: false, error: "Failed to set readiness" };
  }
}
