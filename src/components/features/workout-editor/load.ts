/**
 * What the editor pages read on the server: the user's numbers for the target
 * forms, and a dated session the editor may open. Callers check the session
 * and the endurance switch.
 */

import { db } from "@/db";
import { plannedSessions, workoutSessions } from "@/db/schema";
import { getBikeNumbers } from "@/lib/bike-numbers";
import { livePlannedSessions } from "@/lib/plan-live";
import { isPlannedDone } from "@/lib/planned-sessions";
import { thresholdValues } from "@/lib/session-compliance";
import { userToday } from "@/lib/user-settings";
import { toDateStr } from "@/lib/utils/cycle-position";
import type { EditNumbers } from "@/lib/utils/workout-edit";
import { parseWorkout, type Workout } from "@/lib/utils/workout-steps";
import { and, eq } from "drizzle-orm";

export async function editorNumbers(userId: string): Promise<EditNumbers> {
  const [bike, t] = await Promise.all([getBikeNumbers(userId), thresholdValues(userId)]);
  return { ftp: bike.ftp?.value ?? null, lthrBike: t.lthr_bike ?? null, zones: bike.zones };
}

export type EditableSession =
  | { open: true; workout: Workout; libraryId: number | null; date: string }
  | { open: false; why: string; date: string | null };

/** A dated workout session of the user, or null. Closed when it is done, started, past, or not a bike workout. */
export async function sessionForEditor(userId: string, id: number): Promise<EditableSession | null> {
  const [row] = await db
    .select()
    .from(plannedSessions)
    .where(and(eq(plannedSessions.id, id), eq(plannedSessions.userId, userId), livePlannedSessions));
  if (!row || row.workout == null) return null;
  const parsed = parseWorkout(row.workout);
  if (!parsed.ok) return null;
  const [started] = await db.select({ id: workoutSessions.id }).from(workoutSessions).where(and(eq(workoutSessions.plannedSessionId, id), eq(workoutSessions.userId, userId))).limit(1);
  if (started || (await isPlannedDone(userId, id))) return { open: false, why: "This session is started or done. It cannot change.", date: row.date };
  const today = toDateStr(await userToday(userId));
  if (row.date == null || row.date < today) return { open: false, why: "A past session cannot change. Move it to a coming day first.", date: row.date };
  if (parsed.workout.sport !== "bike") return { open: false, why: "The editor is for bike workouts. Ask your assistant to change this one.", date: row.date };
  return { open: true, workout: parsed.workout, libraryId: row.workoutId, date: row.date };
}
