/**
 * What the program workout screen shows of structured endurance steps
 * (docs/plans/one-program-model.md, 3): one summary line per structured
 * exercise, the session's planned totals, and the way into the guided player
 * when today's planned session runs this program. Null for a program with no
 * steps, so a strength program reads nothing more.
 */

import { db } from "@/db";
import { exercises, plannedSessions, programExercises, programSets } from "@/db/schema";
import { enduranceEnabledFor } from "@/lib/endurance";
import { livePlannedSessions, liveProgramExercises, liveProgramSets } from "@/lib/plan-live";
import { distanceLabel } from "@/lib/planned-view";
import { programWorkouts } from "@/lib/program-workouts";
import { thresholdValues } from "@/lib/session-compliance";
import { getUserSettings, userToday } from "@/lib/user-settings";
import { toDateStr } from "@/lib/utils/cycle-position";
import { formatSessionLength, loadText } from "@/lib/utils/format";
import { workoutPlannedLoad } from "@/lib/utils/step-results";
import { describeWorkout, estimateWorkout, resolveTarget, type WorkoutTarget } from "@/lib/utils/workout-steps";
import { and, asc, eq, isNotNull } from "drizzle-orm";

export type ProgramGuided = { totals: string; href: string | null };

export async function programStepsView(userId: string, programId: number): Promise<{ summaries: Map<number, string>; guided: ProgramGuided } | null> {
  if (!(await enduranceEnabledFor(userId))) return null;
  const all = (await programWorkouts(db, [programId])).get(programId);
  if (!all?.length) return null;
  const [anchors, { units }, today] = await Promise.all([thresholdValues(userId), getUserSettings(userId), userToday(userId)]);
  const summaries = new Map(all.map((p) => [p.programExerciseId, describeWorkout(p.workout, units)]));

  const est = all.map((p) => estimateWorkout(p.workout, anchors));
  const seconds = est.reduce((a, e) => a + e.durationSeconds, 0);
  const meters = est.reduce((a, e) => a + e.distanceMeters, 0);
  const loads = all.map((p) => workoutPlannedLoad(p.workout, anchors));
  const load = { load: loads.reduce((a, l) => a + l.load, 0), partial: loads.some((l) => l.partial) };
  const sport = all[0].sport;
  const totals = [
    seconds > 0 ? `${est.every((e) => e.durationComplete) ? "" : "at least "}${formatSessionLength(seconds)}` : null,
    meters > 0 ? `${est.every((e) => e.distanceComplete) ? "" : "at least "}${distanceLabel(meters, sport, units)}` : null,
    load.load > 0 ? loadText(load) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const [planned] = await db
    .select({ id: plannedSessions.id })
    .from(plannedSessions)
    .where(and(eq(plannedSessions.userId, userId), eq(plannedSessions.programId, programId), eq(plannedSessions.date, toDateStr(today)), eq(plannedSessions.status, "planned"), livePlannedSessions))
    .orderBy(asc(plannedSessions.position))
    .limit(1);
  const swimOnly = all.every((p) => p.sport === "swim");
  return { summaries, guided: { totals, href: planned ? `/planned/${planned.id}/${swimOnly ? "pool" : "play"}` : null } };
}

/** One step row as the set list shows it: "Work · 2/4" and its target in the user's numbers. */
export type StepLabel = { title: string; target: string | null };

const KIND_WORD: Record<string, string> = { warmup: "Warm-up", work: "Work", recovery: "Easy", cooldown: "Cool-down", rest: "Rest" };

/** Labels of an exercise's step rows by set id; null when it has none (a strength exercise reads one row). */
export async function stepLabels(userId: string, programExerciseId: number): Promise<Record<number, StepLabel> | null> {
  const rows = await db
    .select({ set: programSets, discipline: exercises.discipline })
    .from(programSets)
    .innerJoin(programExercises, eq(programExercises.id, programSets.programExerciseId))
    .innerJoin(exercises, eq(exercises.id, programExercises.exerciseId))
    .where(and(eq(programSets.programExerciseId, programExerciseId), isNotNull(programSets.stepKind), liveProgramExercises, liveProgramSets));
  if (!rows.length || rows[0].discipline == null) return null;
  const sport = rows[0].discipline;
  const [anchors, { units }] = await Promise.all([thresholdValues(userId), getUserSettings(userId)]);
  const rounds = new Map<number, number>();
  for (const { set } of rows) if (set.blockId != null) rounds.set(set.blockId, Math.max(rounds.get(set.blockId) ?? 0, set.blockRound ?? 0));
  const out: Record<number, StepLabel> = {};
  for (const { set } of rows) {
    const of = set.blockId != null ? rounds.get(set.blockId) : undefined;
    const targets = Array.isArray(set.targets) ? (set.targets as WorkoutTarget[]) : [];
    const text = targets.map((t) => resolveTarget(t, sport, anchors, units).text).filter(Boolean);
    out[set.id] = { title: `${KIND_WORD[set.stepKind!]}${of ? ` · ${set.blockRound}/${of}` : ""}`, target: text.length ? text.join(" · ") : null };
  }
  return out;
}
