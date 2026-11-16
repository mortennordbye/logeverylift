/**
 * Per-step results of a planned session that runs a program with structured
 * steps (docs/plans/one-program-model.md, 2 and 1.2). The results are logged
 * sets: one workout_sets row per step, linked to its program set, with the
 * step's status, extra time, measured value and a copy of its plan.
 *
 * All structured exercises of the program play as one run, in exercise order
 * (a brick in one program is the ride, then the run). With more than one,
 * each play key carries the exercise's place: "e2:s1#3".
 *
 * The save takes the input and gives the view that src/lib/step-results.ts
 * exports, so the player, the results form and MCP log_step_results share it.
 *
 * Plain server code: callers resolve the user and check the endurance switch.
 */

import { db } from "@/db";
import { plannedSessions, programExercises, programSets, workoutSessions, workoutSets } from "@/db/schema";
import { writeLoggedSession, type LoggedSet } from "@/lib/logged-sessions";
import type { Tx } from "@/lib/plan-revisions";
import { PlanStateError } from "@/lib/plan-revisions";
import { liveProgramExercises, liveProgramSets } from "@/lib/plan-live";
import { programWorkouts, type ProgramWorkout } from "@/lib/program-workouts";
import { thresholdValues } from "@/lib/session-compliance";
import { StepResultsError, type SaveStepResultsInput, type SaveStepResultsResult, type StepResultsView } from "@/lib/step-results";
import { appSessionLoads } from "@/lib/training-load";
import { getUserSettings, userToday } from "@/lib/user-settings";
import { toDateStr } from "@/lib/utils/cycle-position";
import type { PlannedStepSnapshot } from "@/lib/utils/program-steps";
import { programPlay, type ProgramPlay } from "@/lib/utils/program-steps";
import { compareStep, plannedRows, resultTotals, stepResultsSchema, workoutPlannedLoad, type PlannedRow, type StepResult } from "@/lib/utils/step-results";
import { localDateStr } from "@/lib/utils/user-date";
import type { ThresholdValues, WorkoutStep } from "@/lib/utils/workout-steps";
import { rebuildPRsFrom } from "@/lib/workout-records";
import { and, asc, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";

export { programPlay, type ProgramPlay } from "@/lib/utils/program-steps";

/** The planned session's structured exercises, or null when it runs none. */
export async function plannedProgramWorkouts(
  userId: string,
  plannedSessionId: number,
): Promise<{ planned: { id: number; date: string; programId: number }; all: ProgramWorkout[] } | null> {
  const [row] = await db
    .select({ id: plannedSessions.id, date: plannedSessions.date, programId: plannedSessions.programId, deletedAt: plannedSessions.deletedAt })
    .from(plannedSessions)
    .where(and(eq(plannedSessions.id, plannedSessionId), eq(plannedSessions.userId, userId)));
  if (!row?.date || row.programId == null || row.deletedAt != null) return null;
  const all = (await programWorkouts(db, [row.programId])).get(row.programId) ?? [];
  if (!all.length) return null;
  return { planned: { id: row.id, date: row.date, programId: row.programId }, all };
}

/** True when the planned session runs a program with steps. */
export async function isProgramStepSession(userId: string, plannedSessionId: number): Promise<boolean> {
  return (await plannedProgramWorkouts(userId, plannedSessionId)) != null;
}

/** The live step rows of an exercise in play order (setNumber), one per play step. */
async function stepRows(programExerciseIds: number[]) {
  return db
    .select({
      id: programSets.id,
      programExerciseId: programSets.programExerciseId,
      exerciseId: programExercises.exerciseId,
      setNumber: programSets.setNumber,
      blockId: programSets.blockId,
      blockRound: programSets.blockRound,
    })
    .from(programSets)
    .innerJoin(programExercises, eq(programExercises.id, programSets.programExerciseId))
    .where(and(inArray(programSets.programExerciseId, programExerciseIds), liveProgramExercises, liveProgramSets, isNotNull(programSets.stepKind)))
    .orderBy(asc(programSets.setNumber), asc(programSets.id));
}

/** Results that fit the play steps: known keys, each once. */
function checkKeys(play: ProgramPlay[], input: unknown): StepResult[] {
  const r = stepResultsSchema.safeParse(input);
  if (!r.success) throw new StepResultsError(r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  const keys = new Set(play.flatMap((p) => p.play.map((s) => s.key)));
  const seen = new Set<string>();
  const errors: { path: string; message: string }[] = [];
  r.data.forEach((s, i) => {
    if (!keys.has(s.key)) errors.push({ path: `${i}.key`, message: `no step "${s.key}" in this session` });
    else if (seen.has(s.key)) errors.push({ path: `${i}.key`, message: `step "${s.key}" is given twice` });
    seen.add(s.key);
  });
  if (errors.length) throw new StepResultsError(errors);
  return r.data;
}

type StepSet = LoggedSet & { step: NonNullable<LoggedSet["step"]> };

/** The steps into a session that exists, one row per program set (the log's own key). */
async function upsertSets(tx: Tx, sessionId: number, sets: StepSet[]) {
  for (const s of sets) {
    const values = {
      sessionId,
      exerciseId: s.exerciseId,
      setNumber: s.setNumber,
      actualReps: 0,
      weightKg: "0",
      durationSeconds: s.durationSeconds ?? null,
      distanceMeters: s.distanceMeters ?? null,
      rpe: s.rpe ?? null,
      notes: s.notes ?? null,
      restTimeSeconds: 0,
      ...s.step,
    };
    const { sessionId: _session, ...update } = values;
    void _session;
    // A step already logged as done (by hand, during the workout) stays done:
    // a run that skipped it never undoes it.
    await tx
      .insert(workoutSets)
      .values(values)
      .onConflictDoUpdate({ target: [workoutSets.sessionId, workoutSets.programSetId], set: update, setWhere: sql`${workoutSets.isCompleted} = false OR excluded.is_completed = true` });
  }
}

export async function saveProgramStepResults(userId: string, input: SaveStepResultsInput, source: "player" | "manual" | "assistant"): Promise<SaveStepResultsResult> {
  if (input.clientKey) {
    const [repeat] = await db
      .select({ id: workoutSessions.id })
      .from(workoutSessions)
      .where(and(eq(workoutSessions.userId, userId), eq(workoutSessions.clientKey, input.clientKey)));
    if (repeat) return { workoutSessionId: repeat.id, resultId: repeat.id, created: "repeat" };
  }
  const found = await plannedProgramWorkouts(userId, input.plannedSessionId);
  if (!found) throw new PlanStateError("That session has no structured steps");
  const { planned, all } = found;
  const anchors = await thresholdValues(userId);
  const plays = programPlay(all, anchors);
  const results = new Map(checkKeys(plays, input.steps).map((r) => [r.key, r]));
  const rowsAll = await stepRows(all.map((p) => p.programExerciseId));

  const sets: StepSet[] = plays.flatMap(({ pw, play }) => {
    const rows = rowsAll.filter((r) => r.programExerciseId === pw.programExerciseId);
    if (rows.length !== play.length) throw new PlanStateError("The program changed while saving; open the session again");
    return play.map((p, i) => {
      const r: StepResult = results.get(p.key) ?? { key: p.key, status: "not_done" };
      const row = rows[i];
      const snapshot: PlannedStepSnapshot = { v: 1, sport: pw.sport, step: p.step as WorkoutStep, blockId: row.blockId, blockRound: row.blockRound, thresholds: anchors };
      const done = r.status === "done" || r.status === "partial";
      const rpe = r.rpe ?? input.sessionRpe ?? null;
      return {
        exerciseId: row.exerciseId,
        setNumber: row.setNumber,
        ...(r.activeSeconds !== undefined && r.activeSeconds > 0 && { durationSeconds: r.activeSeconds }),
        ...(r.distanceMeters !== undefined && r.distanceMeters > 0 && { distanceMeters: Math.round(r.distanceMeters) }),
        // The session RPE goes on each step without its own, so the
        // time-weighted RPE of the load stays the session's.
        ...(rpe != null && done && { rpe }),
        ...(r.notes && { notes: r.notes }),
        step: {
          programExerciseId: pw.programExerciseId,
          programSetId: row.id,
          isCompleted: done,
          stepStatus: r.status,
          extendedSeconds: r.extendedSeconds ?? null,
          measuredValue: r.value ?? null,
          avgHr: null,
          plannedStep: snapshot,
        },
      };
    });
  });
  const totals = resultTotals(plays.flatMap((p) => p.rows), [...results.values()]);

  // An app session already linked to this planned day takes the results;
  // else a new completed one is written (lock, duplicate check, PR rebuild).
  const [linked] = await db
    .select({ id: workoutSessions.id, start: workoutSessions.startTime })
    .from(workoutSessions)
    .where(and(eq(workoutSessions.userId, userId), eq(workoutSessions.plannedSessionId, planned.id), inArray(workoutSessions.source, ["app", "assistant"])))
    .limit(1);
  if (linked) {
    await db.transaction(async (tx) => {
      await upsertSets(tx, linked.id, sets);
      // A later save (a hand edit of the results) may bring neither: the run's own details stay.
      const details = { ...(input.clientKey && { clientKey: input.clientKey }), ...(input.pausedSeconds !== undefined && { pausedSeconds: input.pausedSeconds }) };
      if (Object.keys(details).length) await tx.update(workoutSessions).set(details).where(eq(workoutSessions.id, linked.id));
      for (const exerciseId of [...new Set(sets.map((s) => s.exerciseId))].sort((a, b) => a - b)) await rebuildPRsFrom(tx, userId, exerciseId, linked.start);
    });
    return { workoutSessionId: linked.id, resultId: linked.id, created: "attached" };
  }

  const activeSeconds = totals.activeSeconds > 0 ? totals.activeSeconds : (input.durationSeconds ?? 0);

  // A workout of this program left open today (the workout screen opened it
  // before "Start guided") takes the results and ends with them, so the day
  // never holds two sessions.
  const today = toDateStr(await userToday(userId));
  const [open] = await db
    .select({ id: workoutSessions.id, start: workoutSessions.startTime, date: workoutSessions.date })
    .from(workoutSessions)
    .where(
      and(
        eq(workoutSessions.userId, userId),
        eq(workoutSessions.programId, planned.programId),
        eq(workoutSessions.isCompleted, false),
        eq(workoutSessions.source, "app"),
        eq(workoutSessions.date, today),
      ),
    )
    // The one that already holds logged sets first: a fresh sign-in on the
    // workout page can leave a newer, empty one beside it.
    .orderBy(desc(sql`EXISTS (SELECT 1 FROM workout_sets ws WHERE ws.session_id = ${workoutSessions.id})`), desc(workoutSessions.startTime))
    .limit(1);
  if (open) {
    await db.transaction(async (tx) => {
      await upsertSets(tx, open.id, sets);
      const end = input.finishedAt ?? new Date();
      await tx
        .update(workoutSessions)
        .set({
          plannedSessionId: planned.id,
          isCompleted: true,
          endTime: end > open.start ? end : new Date(open.start.getTime() + Math.max(60, activeSeconds) * 1000),
          ...(input.clientKey && { clientKey: input.clientKey }),
          ...(input.pausedSeconds !== undefined && { pausedSeconds: input.pausedSeconds }),
          ...(input.notes && { notes: input.notes }),
        })
        .where(eq(workoutSessions.id, open.id));
      // As completeWorkoutSession: a logged day replaces its auto row.
      await tx
        .delete(workoutSessions)
        .where(
          and(
            eq(workoutSessions.userId, userId),
            eq(workoutSessions.source, "auto"),
            or(eq(workoutSessions.plannedSessionId, planned.id), and(eq(workoutSessions.programId, planned.programId), eq(workoutSessions.date, open.date))),
          ),
        );
      for (const exerciseId of [...new Set(sets.map((x) => x.exerciseId))].sort((a, b) => a - b)) await rebuildPRsFrom(tx, userId, exerciseId, open.start);
    });
    return { workoutSessionId: open.id, resultId: open.id, created: "attached" };
  }

  if (!(activeSeconds > 0)) throw new PlanStateError("No time recorded for this session");
  const { timeZone } = await getUserSettings(userId);
  const start = input.startedAt ?? new Date();
  const date = source === "player" ? localDateStr(start, timeZone) : planned.date <= today ? planned.date : today;
  const session = await writeLoggedSession(userId, {
    date,
    start,
    programId: planned.programId,
    plannedSessionId: planned.id,
    durationMinutes: Math.max(1, Math.round((activeSeconds + (input.pausedSeconds ?? 0)) / 60)),
    notes: input.notes ?? null,
    source: source === "assistant" ? "assistant" : "app",
    pausedSeconds: input.pausedSeconds ?? null,
    clientKey: input.clientKey ?? null,
    sets,
  });
  return { workoutSessionId: session.id, resultId: session.id, created: "session" };
}

/**
 * The results of a program step session, by planned session. The planned side
 * of each row comes from the copy saved with the logged step, so a later edit
 * or retest never changes it. Null when no step is logged.
 */
export async function getProgramStepResults(userId: string, plannedSessionId: number): Promise<StepResultsView | null> {
  const found = await plannedProgramWorkouts(userId, plannedSessionId);
  if (!found) return null;
  const [session] = await db
    .select({ id: workoutSessions.id, date: workoutSessions.date, source: workoutSessions.source, clientKey: workoutSessions.clientKey })
    .from(workoutSessions)
    .where(and(eq(workoutSessions.userId, userId), eq(workoutSessions.plannedSessionId, plannedSessionId), inArray(workoutSessions.source, ["app", "assistant"])))
    .limit(1);
  if (!session) return null;
  const logged = await db
    .select({ set: workoutSets })
    .from(workoutSets)
    .where(and(eq(workoutSets.sessionId, session.id), isNotNull(workoutSets.plannedStep)))
    .orderBy(asc(workoutSets.setNumber), asc(workoutSets.id));
  if (!logged.length) return null;

  const { units } = await getUserSettings(userId);
  const firstSnap = logged[0].set.plannedStep as PlannedStepSnapshot;
  const anchors = (firstSnap.thresholds ?? {}) as ThresholdValues;
  const plays = programPlay(found.all, anchors, units);
  const rows = plays.flatMap(({ pw, play }) => {
    const mine = logged.filter((l) => l.set.programExerciseId === pw.programExerciseId);
    // Keys follow today's plan when it still has the same steps, so a later
    // edit of the results saves against it; else each row is keyed by place.
    const sameShape = play.length === mine.length;
    return mine.map(({ set }, i) => {
      const snap = set.plannedStep as PlannedStepSnapshot;
      const [planned] = plannedRows({ v: 1, sport: snap.sport, name: "step", steps: [snap.step] }, (snap.thresholds ?? {}) as ThresholdValues, units);
      const key = sameShape ? play[i].key : `x${set.id}`;
      const p: PlannedRow = { ...planned, key, round: sameShape ? play[i].round : null };
      const result: StepResult | null = set.stepStatus
        ? {
            key,
            status: set.stepStatus,
            ...(set.durationSeconds != null && { activeSeconds: set.durationSeconds }),
            ...(set.distanceMeters != null && { distanceMeters: set.distanceMeters }),
            ...(set.extendedSeconds != null && { extendedSeconds: set.extendedSeconds }),
            ...(set.measuredValue != null && { value: set.measuredValue }),
            ...(set.rpe != null && { rpe: set.rpe }),
            ...(set.notes && { notes: set.notes }),
          }
        : null;
      return { ...p, result, compare: compareStep(p, result ?? undefined) };
    });
  });
  const rpes = logged.map((l) => l.set.rpe).filter((r): r is number => r != null);
  const seconds = logged.reduce((a, l) => a + (l.set.durationSeconds ?? 0), 0);
  const meters = logged.reduce((a, l) => a + (l.set.distanceMeters ?? 0), 0);
  const first = found.all[0];
  const loads = (await appSessionLoads(userId, session.date, session.date)).filter((l) => l.id === session.id && found.all.some((p) => p.sport === l.sport));
  const loadSum = loads.reduce((a, l) => a + (l.load ?? 0), 0);
  const planned = found.all.map((p) => workoutPlannedLoad(p.workout, anchors));
  return {
    workoutSessionId: session.id,
    plannedSessionId,
    date: session.date,
    source: session.clientKey ? "player" : session.source === "assistant" ? "assistant" : "manual",
    workout: first.workout,
    anchors,
    rows,
    sessionRpe: rpes.length && rpes.every((r) => r === rpes[0]) ? rpes[0] : null,
    durationSeconds: seconds || null,
    distanceMeters: meters || null,
    load: loads.length ? { value: loads.some((l) => l.load != null) ? loadSum : null, method: loads[0].method, reason: loads[0].reason ?? null } : null,
    plannedLoad: { load: planned.reduce((a, p) => a + p.load, 0), partial: planned.some((p) => p.partial) },
  };
}
