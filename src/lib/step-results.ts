/**
 * Save and read per-step results (docs/plans/endurance-app.md, 5.2). The app
 * action and MCP log_step_results share this path, so a run, a hand entry and
 * an assistant entry write the same rows.
 *
 * Saving: when a completed app or assistant session already links to the
 * planned session, the results attach to it. Otherwise a new completed
 * session is written through src/lib/logged-sessions.ts (lock, duplicate
 * check, PR rebuild), linked to the planned session, with one set on the
 * sport's built-in exercise; the results row is inserted in the same
 * transaction. A repeated clientKey returns the first save.
 *
 * Plain server code: callers resolve the user and check the endurance switch.
 */

import { db } from "@/db";
import { plannedSessions, workoutSessions, workoutSets, workoutStepResults } from "@/db/schema";
import { DuplicateSession, writeLoggedSession } from "@/lib/logged-sessions";
import { PlanStateError } from "@/lib/plan-revisions";
import { sportExerciseId } from "@/lib/session-answers";
import { storedWorkout, thresholdValues } from "@/lib/session-compliance";
import { appSessionLoads, type SessionLoadRow } from "@/lib/training-load";
import { getUserSettings, userToday } from "@/lib/user-settings";
import { toDateStr } from "@/lib/utils/cycle-position";
import {
  checkResults,
  compareStep,
  plannedRows,
  resultTotals,
  workoutPlannedLoad,
  type PlannedRow,
  type StepCompare,
  type StepResult,
} from "@/lib/utils/step-results";
import { localDateStr } from "@/lib/utils/user-date";
import type { ThresholdValues, Workout } from "@/lib/utils/workout-steps";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";

/** The results do not fit the workout; carries every problem with its path. */
export class StepResultsError extends Error {
  constructor(readonly errors: { path: string; message: string }[]) {
    super(`Step results refused: ${errors.map((e) => `${e.path || "results"}: ${e.message}`).join("; ")}`);
  }
}

/**
 * The text the app shows for a refused save (review fix 14). DuplicateSession's own
 * message is written for the MCP assistant ("Read recent_workouts"), so the app
 * says it in the user's terms. Null for an unexpected error.
 */
export function appErrorMessage(e: unknown): string | null {
  if (e instanceof DuplicateSession) return "This session is already logged for that day. Open it in History to change it.";
  if (e instanceof StepResultsError || e instanceof PlanStateError) return e.message;
  return null;
}

export type SaveStepResultsInput = {
  plannedSessionId: number;
  steps: unknown;
  sessionRpe?: number | null;
  distanceMeters?: number | null;
  notes?: string | null;
  clientKey?: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  pausedSeconds?: number;
};

export type SaveStepResultsResult = { workoutSessionId: number; resultId: number; created: "session" | "attached" | "repeat" };

async function plannedWithWorkout(userId: string, id: number): Promise<{ id: number; date: string; workout: Workout }> {
  const [row] = await db
    .select({ id: plannedSessions.id, date: plannedSessions.date, workout: plannedSessions.workout })
    .from(plannedSessions)
    .where(and(eq(plannedSessions.id, id), eq(plannedSessions.userId, userId), isNull(plannedSessions.deletedAt)));
  if (!row?.date) throw new PlanStateError("Planned session not found");
  const workout = storedWorkout(row.workout, row.id);
  if (!workout) throw new PlanStateError("That session has no structured workout");
  return { id: row.id, date: row.date, workout };
}

export async function saveStepResults(userId: string, input: SaveStepResultsInput, source: "player" | "manual" | "assistant"): Promise<SaveStepResultsResult> {
  if (input.clientKey) {
    const [repeat] = await db
      .select({ id: workoutStepResults.id, sessionId: workoutStepResults.workoutSessionId })
      .from(workoutStepResults)
      .where(and(eq(workoutStepResults.userId, userId), eq(workoutStepResults.clientKey, input.clientKey)));
    if (repeat) return { workoutSessionId: repeat.sessionId, resultId: repeat.id, created: "repeat" };
  }
  const planned = await plannedWithWorkout(userId, input.plannedSessionId);
  const checked = checkResults(planned.workout, input.steps);
  if (!checked.ok) throw new StepResultsError(checked.errors);
  const anchors = await thresholdValues(userId);
  const rows = plannedRows(planned.workout, anchors);
  const totals = resultTotals(rows, checked.steps);

  const values = {
    userId,
    plannedSessionId: planned.id,
    source,
    clientKey: input.clientKey ?? null,
    workout: planned.workout,
    anchors,
    steps: checked.steps,
    startedAt: input.startedAt ?? null,
    finishedAt: input.finishedAt ?? null,
    pausedSeconds: input.pausedSeconds ?? 0,
  };

  const [linked] = await db
    .select({ id: workoutSessions.id })
    .from(workoutSessions)
    .where(
      and(
        eq(workoutSessions.userId, userId),
        eq(workoutSessions.plannedSessionId, planned.id),
        eq(workoutSessions.isCompleted, true),
        inArray(workoutSessions.source, ["app", "assistant"]),
      ),
    )
    .limit(1);
  if (linked) {
    const resultId = await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(workoutStepResults).where(eq(workoutStepResults.workoutSessionId, linked.id)).for("update");
      let id: number;
      if (existing) {
        // A later save changes the results; the run's own details stay unless it brings new ones (review fix 11).
        await tx
          .update(workoutStepResults)
          .set({
            workout: planned.workout,
            anchors,
            steps: checked.steps,
            clientKey: input.clientKey ?? existing.clientKey,
            startedAt: input.startedAt ?? existing.startedAt,
            finishedAt: input.finishedAt ?? existing.finishedAt,
            pausedSeconds: input.pausedSeconds ?? existing.pausedSeconds,
            updatedAt: new Date(),
          })
          .where(eq(workoutStepResults.id, existing.id));
        id = existing.id;
      } else {
        [{ id }] = await tx.insert(workoutStepResults).values({ ...values, workoutSessionId: linked.id }).returning({ id: workoutStepResults.id });
      }
      const sets = await tx.select({ id: workoutSets.id, distanceMeters: workoutSets.distanceMeters }).from(workoutSets).where(eq(workoutSets.sessionId, linked.id)).orderBy(asc(workoutSets.setNumber));
      if (existing?.wroteSession) {
        // The session this path wrote has one set: the results screen may change its RPE and distance.
        const patch = { ...(input.sessionRpe != null && { rpe: input.sessionRpe }), ...(input.distanceMeters != null && { distanceMeters: Math.round(input.distanceMeters) }) };
        if (Object.keys(patch).length) await tx.update(workoutSets).set(patch).where(eq(workoutSets.sessionId, linked.id));
      } else {
        // A session the user or the assistant logged: the RPE fills sets that have none, the
        // distance goes on the first set when no set has one (review fix 6). Never an overwrite.
        if (input.sessionRpe != null) await tx.update(workoutSets).set({ rpe: input.sessionRpe }).where(and(eq(workoutSets.sessionId, linked.id), isNull(workoutSets.rpe)));
        if (input.distanceMeters != null && input.distanceMeters > 0 && sets.length && !sets.some((x) => (x.distanceMeters ?? 0) > 0)) {
          await tx.update(workoutSets).set({ distanceMeters: Math.round(input.distanceMeters) }).where(eq(workoutSets.id, sets[0].id));
        }
      }
      return id;
    });
    return { workoutSessionId: linked.id, resultId, created: "attached" };
  }

  if (!(totals.activeSeconds > 0)) throw new PlanStateError("No time recorded for this session");
  const exerciseId = await sportExerciseId(planned.workout.sport);
  if (exerciseId == null) throw new PlanStateError("No built-in exercise for this sport");
  const { timeZone } = await getUserSettings(userId);
  const today = toDateStr(await userToday(userId));
  // A run is dated on the day it started; a hand entry on the planned day (never in the future).
  const start = input.startedAt ?? new Date();
  const date = source === "player" ? localDateStr(start, timeZone) : planned.date <= today ? planned.date : today;
  const distance = input.distanceMeters ?? totals.distanceMeters;
  let resultId = 0;
  const session = await writeLoggedSession(
    userId,
    {
      date,
      start,
      programId: null,
      plannedSessionId: planned.id,
      durationMinutes: Math.max(1, Math.round(totals.activeSeconds / 60)),
      notes: input.notes ?? null,
      source: source === "assistant" ? "assistant" : "app",
      sets: [
        {
          exerciseId,
          setNumber: 1,
          durationSeconds: totals.activeSeconds,
          ...(distance != null && distance > 0 && { distanceMeters: Math.round(distance) }),
          ...(input.sessionRpe != null && { rpe: input.sessionRpe }),
        },
      ],
    },
    async (tx, sessionId) => {
      const [row] = await tx.insert(workoutStepResults).values({ ...values, workoutSessionId: sessionId, wroteSession: true }).returning({ id: workoutStepResults.id });
      resultId = row.id;
    },
  );
  return { workoutSessionId: session.id, resultId, created: "session" };
}

export type StepResultsView = {
  workoutSessionId: number;
  plannedSessionId: number | null;
  date: string;
  source: "player" | "manual" | "assistant";
  workout: Workout;
  anchors: ThresholdValues;
  rows: (PlannedRow & { result: StepResult | null; compare: StepCompare })[];
  sessionRpe: number | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
  load: { value: number | null; method: SessionLoadRow["method"]; reason: SessionLoadRow["reason"] | null } | null;
  plannedLoad: { load: number; partial: boolean };
};

/** The results of one logged session, by planned or logged session id; null when there are none. */
export async function getStepResults(userId: string, by: { plannedSessionId?: number; workoutSessionId?: number }): Promise<StepResultsView | null> {
  const where = by.workoutSessionId != null ? eq(workoutStepResults.workoutSessionId, by.workoutSessionId) : eq(workoutStepResults.plannedSessionId, by.plannedSessionId ?? -1);
  const [row] = await db
    .select({ r: workoutStepResults, date: workoutSessions.date })
    .from(workoutStepResults)
    .innerJoin(workoutSessions, eq(workoutSessions.id, workoutStepResults.workoutSessionId))
    .where(and(eq(workoutStepResults.userId, userId), where))
    .limit(1);
  if (!row) return null;
  const workout = storedWorkout(row.r.workout, row.r.id);
  if (!workout) return null;
  const anchors = (row.r.anchors ?? {}) as ThresholdValues;
  const { units } = await getUserSettings(userId);
  const results = new Map((row.r.steps as StepResult[]).map((s) => [s.key, s]));
  const rows = plannedRows(workout, anchors, units).map((p) => {
    const result = results.get(p.key) ?? null;
    return { ...p, result, compare: compareStep(p, result ?? undefined) };
  });
  const [set] = await db
    .select({ rpe: workoutSets.rpe, durationSeconds: workoutSets.durationSeconds, distanceMeters: workoutSets.distanceMeters })
    .from(workoutSets)
    .where(eq(workoutSets.sessionId, row.r.workoutSessionId))
    .limit(1);
  const loads = (await appSessionLoads(userId, row.date, row.date)).filter((l) => l.id === row.r.workoutSessionId && l.sport === workout.sport);
  return {
    workoutSessionId: row.r.workoutSessionId,
    plannedSessionId: row.r.plannedSessionId,
    date: row.date,
    source: row.r.source,
    workout,
    anchors,
    rows,
    sessionRpe: set?.rpe ?? null,
    durationSeconds: set?.durationSeconds ?? null,
    distanceMeters: set?.distanceMeters ?? null,
    load: loads[0] ? { value: loads[0].load, method: loads[0].method, reason: loads[0].reason ?? null } : null,
    plannedLoad: workoutPlannedLoad(workout, anchors),
  };
}
