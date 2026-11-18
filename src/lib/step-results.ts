/**
 * Save and read per-step results (docs/plans/endurance-app.md, 5.2). The app
 * action and MCP log_step_results share this path, so a run, a hand entry and
 * an assistant entry write the same rows.
 *
 * A planned session runs a program with steps; its results are logged sets
 * (src/lib/program-step-results.ts, docs/plans/one-program-model.md, 1.2).
 *
 * Plain server code: callers resolve the user and check the endurance switch.
 */

import { db } from "@/db";
import type { ResultSource } from "@/db/schema/workout-sets";
import { plannedSessions, workoutSessions } from "@/db/schema";
import { DuplicateSession } from "@/lib/logged-sessions";
import { PlanStateError } from "@/lib/plan-revisions";
import type { SessionLoadRow } from "@/lib/training-load";
import type { KeptField, PlannedRow, StepCompare, StepResult } from "@/lib/utils/step-results";
import type { ThresholdValues, Workout } from "@/lib/utils/workout-steps";
import { and, eq, isNull } from "drizzle-orm";

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
  /**
   * The run's total active time, for a run whose steps no longer match the
   * workout (all `not_done`): the session is logged with it (re-review 2).
   * Used only when the steps hold no time.
   */
  durationSeconds?: number | null;
};

export type SaveStepResultsResult = {
  workoutSessionId: number;
  resultId: number;
  created: "session" | "attached" | "repeat";
  /** An assistant write: per step, the fields it left as the rider typed them or Garmin filled them. */
  kept?: { key: string; fields: KeptField[] }[];
};

export async function saveStepResults(userId: string, input: SaveStepResultsInput, source: "player" | "manual" | "assistant"): Promise<SaveStepResultsResult> {
  const program = await import("@/lib/program-step-results");
  if (await program.isProgramStepSession(userId, input.plannedSessionId)) return program.saveProgramStepResults(userId, input, source);
  const [row] = await db
    .select({ id: plannedSessions.id })
    .from(plannedSessions)
    .where(and(eq(plannedSessions.id, input.plannedSessionId), eq(plannedSessions.userId, userId), isNull(plannedSessions.deletedAt)));
  throw new PlanStateError(row ? "That session has no structured steps" : "Planned session not found");
}

export type StepResultsView = {
  workoutSessionId: number;
  plannedSessionId: number | null;
  date: string;
  source: "player" | "manual" | "assistant";
  workout: Workout;
  anchors: ThresholdValues;
  /** `sources`: who wrote each result field (typed, clock, garmin, assistant); null on steps logged without. */
  rows: (PlannedRow & { result: StepResult | null; sources: Partial<Record<string, ResultSource>> | null; compare: StepCompare })[];
  sessionRpe: number | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
  load: { value: number | null; method: SessionLoadRow["method"]; reason: SessionLoadRow["reason"] | null } | null;
  plannedLoad: { load: number; partial: boolean };
};

/** The results of one logged session, by planned or logged session id; null when there are none. */
export async function getStepResults(userId: string, by: { plannedSessionId?: number; workoutSessionId?: number }): Promise<StepResultsView | null> {
  const program = await import("@/lib/program-step-results");
  let plannedId = by.plannedSessionId;
  if (plannedId == null && by.workoutSessionId != null) {
    const [ws] = await db.select({ plannedSessionId: workoutSessions.plannedSessionId }).from(workoutSessions).where(and(eq(workoutSessions.id, by.workoutSessionId), eq(workoutSessions.userId, userId)));
    plannedId = ws?.plannedSessionId ?? undefined;
  }
  // A session with no planned session (a ride started from the program) reads by itself.
  if (plannedId == null) return by.workoutSessionId != null ? program.getSessionStepResults(userId, by.workoutSessionId) : null;
  if (!(await program.isProgramStepSession(userId, plannedId))) return null;
  return program.getProgramStepResults(userId, plannedId);
}
