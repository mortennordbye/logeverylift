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
import { liveRideOnProgram, liveRideOnSession, rideRunningText, sessionRides } from "@/lib/ride-plan-db";
import { programWorkouts, type ProgramWorkout } from "@/lib/program-workouts";
import { thresholdValues } from "@/lib/session-compliance";
import { StepResultsError, type SaveStepResultsInput, type SaveStepResultsResult, type StepResultsView } from "@/lib/step-results";
import { appSessionLoads } from "@/lib/training-load";
import { getUserSettings, userToday } from "@/lib/user-settings";
import { toDateStr } from "@/lib/utils/cycle-position";
import { stepOfRow, type PlannedStepSnapshot, type StepRow } from "@/lib/utils/program-steps";
import { planSport, type RidePlan } from "@/lib/utils/ride-timeline";
import { programPlay, type ProgramPlay } from "@/lib/utils/program-steps";
import {
  assistantStepWrite,
  compareStep,
  plannedRows,
  resultTotals,
  sentStep,
  stepResultsSchema,
  workoutPlannedLoad,
  type KeptField,
  type PlannedRow,
  type SentStep,
  type StepResult,
} from "@/lib/utils/step-results";
import { RESULT_FIELDS } from "@/lib/validators/workout";
import { localDateStr } from "@/lib/utils/user-date";
import type { ThresholdValues, WorkoutStep } from "@/lib/utils/workout-steps";
import { rebuildPRsFrom } from "@/lib/workout-records";
import { and, asc, desc, eq, inArray, isNotNull, ne, or, sql } from "drizzle-orm";

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

/** Belt and incline go only to the steps of a treadmill run from run mode (docs/plans/run-logger.md, 4.7). */
const TREADMILL_ONLY = "beltKmh and inclinePercent are only for the steps of a treadmill run from run mode";
const beltSent = (s: StepResult) => s.beltKmh !== undefined || s.inclinePercent !== undefined;

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
    if (beltSent(s)) errors.push({ path: `${i}.beltKmh`, message: `${TREADMILL_ONLY}: send the run's workoutSessionId (get_ride gives it)` });
    seen.add(s.key);
  });
  if (errors.length) throw new StepResultsError(errors);
  return r.data;
}

type StepSet = LoggedSet & { step: NonNullable<LoggedSet["step"]> };

/** One play step to write: its set, its key, and what an assistant sent for it (null when it named the step not). */
type StepEntry = { key: string; set: StepSet; sent: SentStep | null };

/**
 * The play steps of a program's structured exercises as logged sets, one per
 * step row, with the results given by key; a step with none is not done.
 * An assistant's sets carry source "assistant" on each result field it gives.
 */
async function stepEntries(
  all: ProgramWorkout[],
  anchors: ThresholdValues,
  input: Pick<SaveStepResultsInput, "steps" | "sessionRpe">,
  source: "player" | "manual" | "assistant",
): Promise<{ plays: ProgramPlay[]; results: Map<string, StepResult>; entries: StepEntry[] }> {
  const plays = programPlay(all, anchors);
  const results = new Map(checkKeys(plays, input.steps).map((r) => [r.key, r]));
  const rowsAll = await stepRows(all.map((p) => p.programExerciseId));
  const entries = plays.flatMap(({ pw, play }) => {
    const rows = rowsAll.filter((r) => r.programExerciseId === pw.programExerciseId);
    if (rows.length !== play.length) throw new PlanStateError("The program changed while saving; open the session again");
    return play.map((p, i): StepEntry => {
      const row = rows[i];
      const snapshot: PlannedStepSnapshot = { v: 2, sport: pw.sport, step: p.step as WorkoutStep, blockId: row.blockId, blockRound: row.blockRound, thresholds: anchors };
      return stepEntry(p.key, results.get(p.key), { ...row, programExerciseId: pw.programExerciseId }, snapshot, input.sessionRpe, source);
    });
  });
  return { plays, results, entries };
}

/** One step to write: the result given for it (else not done) on its program set, with its plan copy. */
function stepEntry(
  key: string,
  given: StepResult | undefined,
  row: { id: number; exerciseId: number; setNumber: number; programExerciseId: number },
  snapshot: PlannedStepSnapshot,
  sessionRpe: number | null | undefined,
  source: "player" | "manual" | "assistant",
): StepEntry {
  const r: StepResult = given ?? { key, status: "not_done" };
  const done = r.status === "done" || r.status === "partial";
  const rpe = r.rpe ?? sessionRpe ?? null;
  const sent = sentStep(r, sessionRpe);
  const sources = Object.fromEntries(RESULT_FIELDS.filter((f) => sent[f] !== undefined).map((f) => [f, "assistant" as const]));
  // The ride numbers only when given: a save that does not send one leaves the stored value. A belt gives the speed.
  const rideNumbers = Object.fromEntries((["avgHr", "avgPower", "maxHr", "avgCadence", "avgSpeed", "climbM"] as const).filter((f) => sent[f] !== undefined).map((f) => [f, sent[f]]));
  return {
    key,
    sent: given ? sent : null,
    set: {
      exerciseId: row.exerciseId,
      setNumber: row.setNumber,
      ...(r.activeSeconds !== undefined && r.activeSeconds > 0 && { durationSeconds: r.activeSeconds }),
      ...(sent.distanceMeters !== undefined && { distanceMeters: sent.distanceMeters }),
      // The session RPE goes on each step without its own, so the
      // time-weighted RPE of the load stays the session's.
      ...(rpe != null && done && { rpe }),
      ...(r.notes && { notes: r.notes }),
      step: {
        programExerciseId: row.programExerciseId,
        programSetId: row.id,
        isCompleted: done,
        stepStatus: r.status,
        extendedSeconds: r.extendedSeconds ?? null,
        measuredValue: r.value ?? null,
        ...rideNumbers,
        ...(sent.inclinePercent !== undefined && { inclinePercent: sent.inclinePercent }),
        ...(source === "assistant" && Object.keys(sources).length > 0 && { sources }),
        plannedStep: snapshot,
      },
    },
  };
}

/**
 * The named steps of a session's ride, keyed and planned as its frozen plan
 * (D9): the keys get_ride lists, on the program sets the ride logged to,
 * whatever the program holds now.
 */
async function rideEntries(plan: RidePlan, programExerciseId: number, input: Pick<SaveStepResultsInput, "steps" | "sessionRpe">): Promise<StepEntry[]> {
  const parsed = stepResultsSchema.safeParse(input.steps);
  if (!parsed.success) throw new StepResultsError(parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  const steps = [...plan.steps, ...(plan.dropped ?? [])];
  const byKey = new Map(steps.map((s) => [s.key, s]));
  const treadmill = planSport(plan) === "run" && plan.mode === "indoor";
  const seen = new Set<string>();
  const errors: { path: string; message: string }[] = [];
  parsed.data.forEach((s, i) => {
    if (!byKey.has(s.key)) errors.push({ path: `${i}.key`, message: `no step "${s.key}" in this ride (get_ride lists its keys)` });
    else if (seen.has(s.key)) errors.push({ path: `${i}.key`, message: `step "${s.key}" is given twice` });
    if (beltSent(s) && !treadmill) errors.push({ path: `${i}.beltKmh`, message: `${TREADMILL_ONLY}; this is ${planSport(plan) === "run" ? "an outdoor run" : "a ride"}` });
    seen.add(s.key);
  });
  if (errors.length) throw new StepResultsError(errors);
  // plan-read: includes deleted (the program sets the ride froze, as they are now)
  const rows = await db
    .select({ id: programSets.id, setNumber: programSets.setNumber, blockId: programSets.blockId, exerciseId: programExercises.exerciseId })
    .from(programSets)
    .innerJoin(programExercises, eq(programExercises.id, programSets.programExerciseId))
    .where(inArray(programSets.id, [...steps.map((s) => s.programSetId), -1]));
  const rowOf = new Map(rows.map((r) => [r.id, r]));
  return parsed.data.map((r) => {
    const s = byKey.get(r.key)!;
    const row = rowOf.get(s.programSetId);
    if (!row) throw new PlanStateError("A step of this ride is no longer in the program");
    const snapshot: PlannedStepSnapshot = { v: 2, sport: planSport(plan), step: s.step, blockId: s.round ? row.blockId : null, blockRound: s.round?.index ?? null, thresholds: plan.thresholds };
    return stepEntry(r.key, r, { ...row, programExerciseId }, snapshot, input.sessionRpe, "assistant");
  });
}

/**
 * The named steps of a session with one ride or more (docs/plans/run-logger.md,
 * 4.3): with one, the keys are its plan's. With a ride and a run, a key starts
 * with its exercise's place (e1:s1), as get_step_results lists them; a key
 * without one is taken only when one ride alone has it.
 */
async function ridesEntries(
  list: { plan: unknown; programExerciseId: number | null }[],
  all: ProgramWorkout[],
  input: Pick<SaveStepResultsInput, "steps" | "sessionRpe">,
): Promise<StepEntry[]> {
  const steps = Array.isArray(input.steps) ? (input.steps as { key?: unknown }[]) : [];
  const placed = (k: unknown) => (typeof k === "string" ? /^e(\d+):(.+)$/.exec(k) : null);
  if (list.length === 1 && !steps.some((s) => placed(s.key))) return rideEntries(list[0].plan as RidePlan, list[0].programExerciseId!, input);
  const keysOf = (r: (typeof list)[number]) => new Set([...(r.plan as RidePlan).steps, ...((r.plan as RidePlan).dropped ?? [])].map((s) => s.key));
  const groups = new Map<(typeof list)[number], { at: number; step: { key?: unknown } }[]>();
  const errors: { path: string; message: string }[] = [];
  steps.forEach((s, i) => {
    const m = placed(s.key);
    let ride: (typeof list)[number] | undefined;
    let key = s.key;
    if (m) {
      const pe = all[Number(m[1]) - 1]?.programExerciseId;
      ride = list.find((r) => r.programExerciseId === pe);
      key = m[2];
      if (!ride) errors.push({ path: `${i}.key`, message: `exercise ${m[1]} of this session has no ride` });
    } else {
      const has = list.filter((r) => keysOf(r).has(String(s.key)));
      if (has.length === 1) ride = has[0];
      else {
        const places = has.map((r) => all.findIndex((p) => p.programExerciseId === r.programExerciseId) + 1);
        errors.push({
          path: `${i}.key`,
          message: has.length ? `step "${String(s.key)}" is in more than one ride of this session: start it with its exercise's place (${places.map((p) => `e${p}:${String(s.key)}`).join(" or ")})` : `no step "${String(s.key)}" in this session's rides`,
        });
      }
    }
    if (ride) groups.set(ride, [...(groups.get(ride) ?? []), { at: i, step: { ...s, key } }]);
  });
  if (errors.length) throw new StepResultsError(errors);
  const out: StepEntry[] = [];
  for (const [ride, group] of groups) {
    const entries = await rideEntries(ride.plan as RidePlan, ride.programExerciseId!, { steps: group.map((g) => g.step) as SaveStepResultsInput["steps"], sessionRpe: input.sessionRpe });
    entries.forEach((e, k) => out.push({ ...e, key: String(steps[group[k].at].key) }));
  }
  return out;
}

/**
 * An assistant's results into a session that exists (docs/plans/bike-ride-logger.md,
 * step 5). A named step with no row gets one. A step the assistant named is
 * written field by field (`assistantStepWrite`): typed and Garmin values stay,
 * and the step keeps the plan it was logged with. A step it did not name stays
 * as it is. Returns the fields kept per step.
 */
async function upsertAssistantSets(tx: Tx, sessionId: number, entries: StepEntry[]): Promise<{ key: string; fields: KeptField[] }[]> {
  const ids = entries.map((e) => e.set.step.programSetId).filter((id): id is number => id != null);
  const stored = ids.length
    ? await tx.select().from(workoutSets).where(and(eq(workoutSets.sessionId, sessionId), inArray(workoutSets.programSetId, ids))).for("update")
    : [];
  const byProgramSet = new Map(stored.map((r) => [r.programSetId, r]));
  const kept: { key: string; fields: KeptField[] }[] = [];
  for (const { key, set: s, sent } of entries) {
    const row = byProgramSet.get(s.step.programSetId ?? null);
    // Only the steps named change: an unnamed one stays as it is, with or without a row.
    if (!sent) continue;
    if (!row) {
      await upsertSets(tx, sessionId, [s], { insertOnly: true });
      continue;
    }
    const write = assistantStepWrite(
      {
        durationSeconds: row.durationSeconds,
        distanceMeters: row.distanceMeters,
        avgPower: row.avgPower,
        avgHr: row.avgHr,
        maxHr: row.maxHr,
        avgCadence: row.avgCadence,
        avgSpeed: row.avgSpeed,
        climbM: row.climbM,
        measuredValue: row.measuredValue,
        inclinePercent: row.inclinePercent,
        rpe: row.rpe,
        notes: row.notes,
        stepStatus: row.stepStatus,
        isCompleted: row.isCompleted,
        sources: row.sources ?? null,
      },
      sent,
    );
    if (write.kept.length) kept.push({ key, fields: write.kept });
    // A row with no plan copy (logged before steps) takes this one.
    await tx
      .update(workoutSets)
      .set({ ...write.set, ...(row.plannedStep == null && { plannedStep: s.step.plannedStep }), ...(row.programExerciseId == null && { programExerciseId: s.step.programExerciseId }) })
      .where(eq(workoutSets.id, row.id));
  }
  return kept;
}

/** The steps into a session that exists, one row per program set (the log's own key). */
async function upsertSets(tx: Tx, sessionId: number, sets: StepSet[], opts: { insertOnly?: boolean } = {}) {
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
    const { sessionId: _session, ...rest } = values;
    void _session;
    // A field this save writes loses the source another writer gave it (the
    // value is no longer theirs); the ride numbers it does not send stay.
    const written = RESULT_FIELDS.filter((f) => (values as Record<string, unknown>)[f] !== undefined);
    const update = { ...rest, ...(!s.step.sources && { sources: sql`${workoutSets.sources} - array(select jsonb_array_elements_text(${JSON.stringify(written)}::jsonb))` }) };
    if (opts.insertOnly) {
      await tx.insert(workoutSets).values(values).onConflictDoNothing({ target: [workoutSets.sessionId, workoutSets.programSetId] });
      continue;
    }
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
  const { plays, results, entries } = await stepEntries(all, anchors, input, source);
  const sets = entries.map((e) => e.set);
  // The session distance the results form or the assistant gives, when no
  // step has its own, goes on the first step done, so the session keeps it.
  if (input.distanceMeters != null && input.distanceMeters > 0 && !sets.some((x) => x.distanceMeters)) {
    const first = sets.find((x) => x.step.isCompleted);
    if (first) first.distanceMeters = Math.round(input.distanceMeters);
  }
  const totals = resultTotals(plays.flatMap((p) => p.rows), [...results.values()]);

  // An app session already linked to this planned day takes the results;
  // else a new completed one is written (lock, duplicate check, PR rebuild).
  const [linked] = await db
    .select({ id: workoutSessions.id, start: workoutSessions.startTime })
    .from(workoutSessions)
    .where(and(eq(workoutSessions.userId, userId), eq(workoutSessions.plannedSessionId, planned.id), inArray(workoutSessions.source, ["app", "assistant"])))
    .limit(1);
  let kept: { key: string; fields: KeptField[] }[] = [];
  const write = async (tx: Tx, sessionId: number) => {
    if (source === "assistant") kept = await upsertAssistantSets(tx, sessionId, entries);
    else await upsertSets(tx, sessionId, sets);
  };
  // D9: no results write reaches a session whose ride still runs (a ride
  // started from the program has no planned session; the open workout below holds it).
  const live = (linked ? await liveRideOnSession(db, userId, linked.id) : null) ?? (await liveRideOnProgram(db, userId, planned.programId));
  if (live) throw new PlanStateError(rideRunningText(live));
  if (linked) {
    await db.transaction(async (tx) => {
      await write(tx, linked.id);
      // A later save (a hand edit of the results) may bring neither: the run's own details stay.
      const details = { ...(input.clientKey && { clientKey: input.clientKey }), ...(input.pausedSeconds !== undefined && { pausedSeconds: input.pausedSeconds }) };
      if (Object.keys(details).length) await tx.update(workoutSessions).set(details).where(eq(workoutSessions.id, linked.id));
      for (const exerciseId of [...new Set(sets.map((s) => s.exerciseId))].sort((a, b) => a - b)) await rebuildPRsFrom(tx, userId, exerciseId, linked.start);
    });
    return { workoutSessionId: linked.id, resultId: linked.id, created: "attached", kept };
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
      await write(tx, open.id);
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
      // Other empty workouts of this program left open today (a fresh sign-in
      // on the workout page can open a second one) go, so the day holds one session.
      await tx
        .delete(workoutSessions)
        .where(
          and(
            eq(workoutSessions.userId, userId),
            eq(workoutSessions.programId, planned.programId),
            eq(workoutSessions.isCompleted, false),
            eq(workoutSessions.date, open.date),
            ne(workoutSessions.id, open.id),
            sql`NOT EXISTS (SELECT 1 FROM workout_sets ws WHERE ws.session_id = ${workoutSessions.id})`,
          ),
        );
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
    return { workoutSessionId: open.id, resultId: open.id, created: "attached", kept };
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
  return stepResultsOf(userId, found.all, session, plannedSessionId);
}

/** A logged app or assistant session of the user, with its program's structured exercises; null when it has none. */
async function sessionProgramWorkouts(userId: string, workoutSessionId: number) {
  const [session] = await db
    .select({ id: workoutSessions.id, date: workoutSessions.date, source: workoutSessions.source, clientKey: workoutSessions.clientKey, programId: workoutSessions.programId, start: workoutSessions.startTime })
    .from(workoutSessions)
    .where(and(eq(workoutSessions.id, workoutSessionId), eq(workoutSessions.userId, userId), inArray(workoutSessions.source, ["app", "assistant"])));
  if (!session) return null;
  const all = session.programId == null ? [] : ((await programWorkouts(db, [session.programId])).get(session.programId) ?? []);
  return { session, all };
}

/**
 * The results of a logged session with no planned session, such as a ride
 * started from the program (docs/plans/bike-ride-logger.md, 4.5). Null when
 * it runs no structured exercise or logged no step.
 */
export async function getSessionStepResults(userId: string, workoutSessionId: number): Promise<StepResultsView | null> {
  const found = await sessionProgramWorkouts(userId, workoutSessionId);
  if (!found?.all.length) return null;
  return stepResultsOf(userId, found.all, found.session, null);
}

/**
 * An assistant's step results into a logged session, by its id (step 5 of
 * docs/plans/bike-ride-logger.md): the way to add results to a ride that has
 * no planned session. Attaches only; the session stays as it is otherwise.
 */
export async function saveSessionStepResults(
  userId: string,
  workoutSessionId: number,
  input: Pick<SaveStepResultsInput, "steps" | "sessionRpe">,
): Promise<SaveStepResultsResult> {
  const found = await sessionProgramWorkouts(userId, workoutSessionId);
  if (!found) throw new PlanStateError("Workout session not found");
  const live = await liveRideOnSession(db, userId, found.session.id);
  if (live) throw new PlanStateError(rideRunningText(live));
  // A ride's steps are its frozen plan's; any other session's are the program's, while it still has the steps logged.
  const sessionRideList = (await sessionRides(db, userId, found.session.id)).filter((r) => r.programExerciseId != null);
  let entries: StepEntry[];
  if (sessionRideList.length) entries = await ridesEntries(sessionRideList, found.all, input);
  else {
    if (!found.all.length) throw new PlanStateError("That session has no structured steps");
    await assertSameShape(found.session.id, found.all);
    entries = (await stepEntries(found.all, await thresholdValues(userId), input, "assistant")).entries;
  }
  const kept = await db.transaction(async (tx) => {
    const k = await upsertAssistantSets(tx, found.session.id, entries);
    for (const exerciseId of [...new Set(entries.map((e) => e.set.exerciseId))].sort((a, b) => a - b)) await rebuildPRsFrom(tx, userId, exerciseId, found.session.start);
    return k;
  });
  return { workoutSessionId: found.session.id, resultId: found.session.id, created: "attached", kept };
}

/**
 * Refuses when a step logged in the session no longer matches the program's
 * step on its program set: the keys of today's program would then write to
 * other steps than the ones logged.
 */
async function assertSameShape(sessionId: number, all: ProgramWorkout[]) {
  const logged = await db
    .select({ programSetId: workoutSets.programSetId, plannedStep: workoutSets.plannedStep })
    .from(workoutSets)
    .where(and(eq(workoutSets.sessionId, sessionId), isNotNull(workoutSets.plannedStep), isNotNull(workoutSets.programSetId)));
  if (!logged.length) return;
  const rows = await db
    .select()
    .from(programSets)
    .where(and(inArray(programSets.programExerciseId, all.map((p) => p.programExerciseId)), liveProgramSets, isNotNull(programSets.stepKind)));
  // The step without its tree id, keys sorted: a row and a parsed tree list the same step in another order.
  const same = (s: WorkoutStep | null) => {
    if (!s) return "";
    const { id: _id, ...rest } = s;
    void _id;
    const sorted = (v: unknown): unknown =>
      Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sorted(x)])) : v;
    return JSON.stringify(sorted(rest));
  };
  const sportOf = new Map(all.map((p) => [p.programExerciseId, p.sport]));
  const now = new Map(rows.map((r) => [r.id, same(stepOfRow(r as StepRow, sportOf.get(r.programExerciseId) ?? null))]));
  const changed = logged.some((l) => now.get(l.programSetId!) !== same((l.plannedStep as PlannedStepSnapshot).step));
  if (changed) throw new PlanStateError("The program changed since this session was logged, so its step keys no longer fit. Log results in the app, or ask the user.");
}

async function stepResultsOf(
  userId: string,
  all: ProgramWorkout[],
  session: { id: number; date: string; source: string; clientKey: string | null },
  plannedSessionId: number | null,
): Promise<StepResultsView | null> {
  const found = { all };
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
  // A ride's steps are keyed and ordered by its frozen plan, the keys get_ride
  // lists and log_step_results takes, whatever the program holds now (D9).
  // Each exercise's own ride (a ride and a run can share a session, docs/plans/run-logger.md 4.3);
  // with more than one, a ride's key starts with its exercise's place, as log_step_results takes it.
  const rideList = await sessionRides(db, userId, session.id);
  const rows = plays.flatMap(({ pw, play }, e) => {
    const ride = rideList.find((r) => r.programExerciseId === pw.programExerciseId);
    const ridePlan = ride ? (ride.plan as RidePlan) : null;
    const planSteps = ridePlan ? [...ridePlan.steps, ...(ridePlan.dropped ?? [])] : [];
    const planIndex = new Map(planSteps.map((st, i) => [st.programSetId, i]));
    const rideKey = (k: string) => (rideList.length > 1 ? `e${e + 1}:${k}` : k);
    const rideRows = ride !== undefined;
    // A treadmill run's belt (docs/plans/run-logger.md, step 5): its speed in km/h, planned and done.
    const treadmill = ride?.sport === "run" && ridePlan?.mode === "indoor";
    const mine = logged.filter((l) => l.set.programExerciseId === pw.programExerciseId);
    if (rideRows) mine.sort((a, b) => (planIndex.get(a.set.programSetId ?? -1) ?? 1e9) - (planIndex.get(b.set.programSetId ?? -1) ?? 1e9));
    // Keys follow today's plan when it still has the same steps, so a later
    // edit of the results saves against it; else each row is keyed by place.
    const sameShape = play.length === mine.length;
    return mine.map(({ set }, i) => {
      const snap = set.plannedStep as PlannedStepSnapshot;
      const [planned] = plannedRows({ v: 2, sport: snap.sport, name: "step", steps: [snap.step] }, (snap.thresholds ?? {}) as ThresholdValues, units);
      const inPlan = rideRows ? planSteps[planIndex.get(set.programSetId ?? -1) ?? -1] : undefined;
      const key = rideRows ? (inPlan ? rideKey(inPlan.key) : `x${set.id}`) : sameShape ? play[i].key : `x${set.id}`;
      const p: PlannedRow = { ...planned, key, round: rideRows ? (inPlan?.round ?? null) : sameShape ? play[i].round : null };
      const result: StepResult | null = set.stepStatus
        ? {
            key,
            status: set.stepStatus,
            ...(set.durationSeconds != null && { activeSeconds: set.durationSeconds }),
            ...(set.distanceMeters != null && { distanceMeters: set.distanceMeters }),
            ...(set.extendedSeconds != null && { extendedSeconds: set.extendedSeconds }),
            ...(set.measuredValue != null && { value: set.measuredValue }),
            ...(set.avgPower != null && { avgPower: set.avgPower }),
            ...(set.avgHr != null && { avgHr: set.avgHr }),
            ...(set.maxHr != null && { maxHr: set.maxHr }),
            ...(set.avgCadence != null && { avgCadence: set.avgCadence }),
            ...(set.avgSpeed != null && { avgSpeed: set.avgSpeed }),
            ...(set.climbM != null && { climbM: set.climbM }),
            ...(treadmill && set.avgSpeed != null && { beltKmh: Math.round(set.avgSpeed * 36) / 10 }),
            ...(set.inclinePercent != null && { inclinePercent: set.inclinePercent }),
            ...(set.rpe != null && { rpe: set.rpe }),
            ...(set.notes && { notes: set.notes }),
          }
        : null;
      const run = treadmill && inPlan ? (inPlan as RidePlan["steps"][number]).run : undefined;
      return {
        ...p,
        ...(run && { plannedBelt: { kmh: run.belt === null ? null : run.belt / 10, inclinePercent: run.incline === null ? null : run.incline / 10 } }),
        result,
        sources: set.sources ?? null,
        compare: compareStep(p, result ?? undefined),
      };
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
