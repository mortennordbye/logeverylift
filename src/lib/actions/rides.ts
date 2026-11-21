"use server";

/**
 * Ride mode on the server (docs/plans/bike-ride-logger.md, 4.3): start a
 * ride, record what the rider does, and read the ride back. The server keeps
 * the plan frozen at start and the events; `rideTimeline` works out the rest,
 * the same way on every device. Server time is the clock.
 */

import { db } from "@/db";
import { END_REASONS, RIDE_MODES, RUN_SURFACES, exercises, programExercises, programSets, programs, rideEvents, rides, workoutSessions } from "@/db/schema";
import { isUniqueViolation } from "@/lib/custom-exercises";
import { enduranceEnabledFor } from "@/lib/endurance";
import { liveProgramExercises, liveProgramSets, livePrograms } from "@/lib/plan-live";
import { sessionRide } from "@/lib/ride-plan-db";
import { brickRideOf } from "@/lib/run-brick";
import { rewriteBeltResults } from "@/lib/run-belt-results";
import { LIVE, isLive, schedulePushes, settle, type RideView } from "@/lib/ride-settle";
import { thresholdValues } from "@/lib/session-compliance";
import { buildWorkout, type StepRow } from "@/lib/utils/program-steps";
import {
  BELT_RANGE,
  EXTEND_STEP_S,
  INCLINE_RANGE,
  NUDGE_STEP_W,
  RIDE_CONFLICT,
  buildRidePlan,
  eventTime,
  rideTimeline,
} from "@/lib/utils/ride-timeline";
import { buildRunPlan } from "@/lib/utils/run-plan";
import { runPlanHistory } from "@/lib/run-history";
import { listIllness } from "@/lib/illness";
import { userToday } from "@/lib/user-settings";
import { toDateStr } from "@/lib/utils/cycle-position";
import { SICK_TEXT, sickBlocksTest } from "@/lib/utils/run-test";
import { requireSession } from "@/lib/utils/session";
import { parseWorkout } from "@/lib/utils/workout-steps";
import type { ActionResult } from "@/types/workout";
import { and, asc, eq, gt, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { z } from "zod";

export type { RideView } from "@/lib/ride-settle";

const clientIdSchema = z.string().min(1).max(64);

/** The user's ride whose start event has this client id, if any. */
async function startedWith(userId: string, clientId: string): Promise<RideView | null> {
  const [row] = await db
    .select({ ride: rides })
    .from(rides)
    .innerJoin(rideEvents, and(eq(rideEvents.rideId, rides.id), eq(rideEvents.clientId, clientId), eq(rideEvents.kind, "start")))
    .where(eq(rides.userId, userId));
  return row ? settle(db, row.ride, Date.now()) : null;
}

const startRideSchema = z.object({
  sessionId: z.number().int().positive(),
  programExerciseId: z.number().int().positive(),
  mode: z.enum(RIDE_MODES),
  // The start event's id: a retried start returns the same ride.
  clientId: clientIdSchema,
  // "Ride again" on the summary of a ride that ended early: a new ride of the
  // same exercise on the same workout, which opens again if it was finished.
  again: z.boolean().optional(),
  // An outdoor run's surface (docs/plans/run-logger.md, R14). Road when not given.
  surface: z.enum(RUN_SURFACES).optional(),
  // "End ride and start run" (4.3): end the user's active ride or run and start this one in one transaction.
  endActive: z.boolean().optional(),
  // A treadmill run's 5 s "Step on" count (4.3): the clock starts 5 s after the tap.
  countIn: z.boolean().optional(),
});

/** The count before a treadmill run's clock runs (docs/plans/run-logger.md, 4.3). */
const COUNT_IN_MS = 5_000;

/**
 * Start a ride of a bike exercise, or a run of a run exercise
 * (docs/plans/run-logger.md, 4.3), in an open workout session. The plan is
 * frozen now, with watts or belts from the thresholds of this moment (D9).
 * One active ride or run per user: one that has ended by its timeline is
 * closed first; with `endActive`, one that still runs ends in the same
 * transaction as the start.
 */
export async function startRide(data: unknown): Promise<ActionResult<RideView>> {
  const auth = await requireSession();
  const parsed = startRideSchema.safeParse(data);
  if (!parsed.success) return { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  const userId = auth.user.id;
  const { sessionId, programExerciseId, mode, clientId, again, surface, endActive, countIn } = parsed.data;
  if (!(await enduranceEnabledFor(userId))) return { success: false, error: "Endurance features are not on for this account" };

  // Errors name the session by its sport: the run screen says run (docs/plans/run-logger.md, step 2).
  let sport: "bike" | "run" = "bike";
  try {
    const replay = await startedWith(userId, clientId);
    if (replay) return { success: true, data: replay };

    const [session] = await db
      .select({ programId: workoutSessions.programId, isCompleted: workoutSessions.isCompleted })
      .from(workoutSessions)
      .where(and(eq(workoutSessions.id, sessionId), eq(workoutSessions.userId, userId)));
    if (!session) return { success: false, error: "Not found" };
    // Only a ride again after this exercise's ride ended early opens a finished workout.
    let reopen = false;
    if (session.isCompleted) {
      const last = again ? await sessionRide(db, userId, sessionId, programExerciseId) : null;
      if (last?.status !== "ended_early" || last.programExerciseId !== programExerciseId) return { success: false, error: "This workout is finished" };
      reopen = true;
    }

    const [slot] = await db
      .select({ programId: programExercises.programId, discipline: exercises.discipline, name: programs.name, rideTest: programExercises.rideTest })
      .from(programExercises)
      .innerJoin(programs, eq(programs.id, programExercises.programId))
      .innerJoin(exercises, eq(exercises.id, programExercises.exerciseId))
      .where(and(eq(programExercises.id, programExerciseId), eq(programs.userId, userId), liveProgramExercises, livePrograms));
    if (!slot || slot.programId !== session.programId) return { success: false, error: "Not found" };
    if (slot.discipline !== "bike" && slot.discipline !== "run") return { success: false, error: "Only a bike or run exercise has ride mode" };
    sport = slot.discipline;

    const rows = await db
      .select()
      .from(programSets)
      .where(and(eq(programSets.programExerciseId, programExerciseId), isNotNull(programSets.stepKind), liveProgramSets))
      .orderBy(asc(programSets.setNumber), asc(programSets.id));
    const built = rows.length ? buildWorkout(rows as StepRow[], { sport, name: slot.name, test: slot.rideTest }) : null;
    const tree = built && "workout" in built ? parseWorkout(built.workout) : null;
    if (!tree?.ok) return { success: false, error: sport === "run" ? "This exercise has no steps to run" : "This exercise has no steps to ride" };
    // The run threshold test does not start within 7 days of being sick (docs/plans/run-logger.md, 4.10).
    if (sport === "run" && tree.workout.test === "30min" && sickBlocksTest(await listIllness(userId), toDateStr(await userToday(userId)))) {
      return { success: false, error: SICK_TEXT };
    }
    const ids = rows.map((r) => r.id);
    const thresholds = await thresholdValues(userId);
    // A run reads the belts and easy pace of the runner's own runs (docs/plans/run-logger.md, 4.2 and 4.3).
    const plan =
      sport === "run"
        ? buildRunPlan(tree.workout, ids, thresholds, mode, { surface, ...(await runPlanHistory(userId, thresholds.lthr_run)) })
        : buildRidePlan(tree.workout, ids, thresholds, mode);

    const now = Date.now();
    // The run of a brick links to its ride from the planned pair (4.7).
    const brick = sport === "run" && session.programId !== null ? await brickRideOf(userId, session.programId) : null;
    // On a treadmill the clock runs after the 5 s count (4.3).
    const startAt = sport === "run" && mode === "indoor" && countIn ? now + COUNT_IN_MS : now;
    const [active] = await db.select().from(rides).where(and(eq(rides.userId, userId), inArray(rides.status, LIVE)));
    if (active && !endActive && isLive((await settle(db, active, now)).ride.status)) {
      // The same start sent twice at once: the other one stored it after the read above.
      const same = await startedWith(userId, clientId);
      return same ? { success: true, data: same } : { success: false, error: active.sport === "run" ? "A run is already running" : "A ride is already running" };
    }

    let ended = null as RideView | null;
    const ride = await db.transaction(async (tx) => {
      // End ride and start run: the active one ends at the server's time, after
      // everything it has, so no later tap makes it live again.
      if (active && endActive) {
        const [locked] = await tx.select().from(rides).where(eq(rides.id, active.id)).for("update");
        const before = locked ? await settle(tx, locked, now) : null;
        if (locked && before && isLive(before.ride.status)) {
          const at = Math.max(now, locked.heartbeatAt?.getTime() ?? 0, ...before.events.map((e) => e.at));
          const seq = before.ride.seq + 1;
          await tx.insert(rideEvents).values({ rideId: locked.id, seq, clientId: `${clientId}:end-active`, kind: "end", at: new Date(at) });
          const [bumped] = await tx.update(rides).set({ seq }).where(eq(rides.id, locked.id)).returning();
          ended = await settle(tx, bumped, now);
        }
      }
      const [row] = await tx
        .insert(rides)
        .values({
          userId,
          sessionId,
          programExerciseId,
          sport,
          mode,
          surface: sport === "run" && mode === "outdoor" ? (surface ?? "road") : null,
          brickRideId: brick?.id ?? null,
          status: "running",
          plan,
          seq: 1,
          startedAt: new Date(startAt),
        })
        .returning();
      await tx.insert(rideEvents).values({ rideId: row.id, seq: 1, clientId, kind: "start", at: new Date(startAt) });
      // The session's ride mode is the bike's (the bike screen's default); a run keeps its mode on its ride.
      const reopened = reopen ? { isCompleted: false, endTime: null } : {};
      if (sport === "bike" || reopen) {
        await tx
          .update(workoutSessions)
          .set(sport === "bike" ? { rideMode: mode, ...reopened } : reopened)
          .where(and(eq(workoutSessions.id, sessionId), eq(workoutSessions.userId, userId)));
      }
      return row;
    });
    // The ended one's alerts go.
    if (ended) await schedulePushes(db, userId, ended);
    const view = await settle(db, ride, now);
    await schedulePushes(db, userId, view);
    return { success: true, data: view };
  } catch (e) {
    // Two starts at once: the active-ride index lets one through. A retry of
    // the same start gets that ride.
    if (isUniqueViolation(e)) {
      const same = await startedWith(userId, clientId);
      return same ? { success: true, data: same } : { success: false, error: sport === "run" ? "A run is already running" : "A ride is already running" };
    }
    console.error("[startRide] failed", { sessionId, programExerciseId });
    return { success: false, error: sport === "run" ? "Failed to start the run" : "Failed to start the ride" };
  }
}

const sendRideEventSchema = z
  .object({
    rideId: z.number().int().positive(),
    clientId: clientIdSchema,
    kind: z.enum(["pause", "resume", "skip", "unskip", "extend", "nudge", "lap", "end", "belt", "incline", "heartbeat"]),
    value: z.number().int().optional(),
    // The step key the client saw (run events, docs/plans/run-logger.md, 4.4).
    stepKey: z.string().min(1).max(40).optional(),
    // Why the runner ended early (R15), with an end only.
    reason: z.enum(END_REASONS).optional(),
    // When it happened on the phone (epoch ms), sent for an event replayed after being offline.
    clientAt: z.number().int().positive().optional(),
    // The seq of the last event this client knows. Another device's event in between is a conflict.
    expectedSeq: z.number().int().min(0),
  })
  .refine(
    (d) => {
      const v = d.value;
      if (d.kind === "nudge") return Math.abs(v ?? 0) === NUDGE_STEP_W;
      if (d.kind === "extend") return Math.abs(v ?? 0) === EXTEND_STEP_S;
      if (d.kind === "belt") return v !== undefined && v >= BELT_RANGE.min && v <= BELT_RANGE.max;
      if (d.kind === "incline") return v !== undefined && v >= INCLINE_RANGE.min && v <= INCLINE_RANGE.max;
      // A block skip (4.5) takes 1.
      if (d.kind === "skip") return v === undefined || v === 1;
      return v === undefined;
    },
    {
      message: `a nudge is ±${NUDGE_STEP_W} W, an extend ±${EXTEND_STEP_S} s, a belt ${BELT_RANGE.min} to ${BELT_RANGE.max} tenths of km/h, an incline ${INCLINE_RANGE.min} to ${INCLINE_RANGE.max} tenths of %, a block skip 1, other events take no value`,
      path: ["value"],
    },
  )
  .refine((d) => d.reason === undefined || d.kind === "end", { message: "only an end takes a reason", path: ["reason"] });

/**
 * Record one event of the user's ride. A client id already stored is a replay
 * and changes nothing. A heartbeat only marks the visible app as alive (it is
 * not an event, so it never conflicts). Answers with the ride, or with
 * RIDE_CONFLICT when the client's seq is behind.
 */
export async function sendRideEvent(data: unknown): Promise<ActionResult<RideView>> {
  const auth = await requireSession();
  const parsed = sendRideEventSchema.safeParse(data);
  if (!parsed.success) return { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  const userId = auth.user.id;
  const { rideId, clientId, kind, value, clientAt, expectedSeq, stepKey, reason } = parsed.data;

  try {
    return await db.transaction(async (tx): Promise<ActionResult<RideView>> => {
      const [ride] = await tx
        .select()
        .from(rides)
        .where(and(eq(rides.id, rideId), eq(rides.userId, userId)))
        .for("update");
      if (!ride) return { success: false, error: "Not found" };
      const now = Date.now();

      const [replay] = await tx
        .select({ id: rideEvents.id })
        .from(rideEvents)
        .where(and(eq(rideEvents.rideId, rideId), eq(rideEvents.clientId, clientId)));
      if (replay) return { success: true, data: await settle(tx, ride, now) };
      // Belt, incline and the block skip are a run's; the nudge is a ride's (4.4).
      const runOnly = kind === "belt" || kind === "incline" || (kind === "skip" && value === 1);
      if ((ride.sport === "run" && kind === "nudge") || (ride.sport !== "run" && runOnly)) return { success: false, error: "Invalid input" };

      const view = await settle(tx, ride, now);
      // Its workout was finished: settle stored the end, and nothing makes it live again.
      if (view.ride.seq !== ride.seq) return { success: false, error: "The ride has ended" };
      if (kind === "heartbeat") {
        if (!isLive(view.ride.status)) return { success: false, error: "The ride has ended" };
        await tx.update(rides).set({ heartbeatAt: new Date(now) }).where(eq(rides.id, rideId));
        return { success: true, data: { ...view, ride: { ...view.ride, heartbeatAt: now } } };
      }
      if (expectedSeq !== ride.seq) return { success: false, error: RIDE_CONFLICT };

      // Never before what the server already has: the last event or heartbeat.
      const heartbeatAt = ride.heartbeatAt?.getTime() ?? null;
      const knownUntil = Math.max(ride.startedAt.getTime(), heartbeatAt ?? 0, ...view.events.map((e) => e.at));
      const at = eventTime(clientAt, ride.startedAt.getTime(), now, knownUntil);
      const seq = ride.seq + 1;
      // An ended ride takes an event that makes it live again: an unskip of
      // the last step, or an offline extend or pause from before its end.
      if (!isLive(view.ride.status)) {
        const withIt = rideTimeline(view.plan, [...view.events, { seq, kind, value: value ?? null, at, stepKey: stepKey ?? null }], now, { heartbeatAt });
        // A late offline belt or incline from inside the run is kept: the steps' meters recompute from it (4.7).
        const lateBelt = view.ride.sport === "run" && (kind === "belt" || kind === "incline") && view.ride.endedAt !== null && at < view.ride.endedAt;
        if (!isLive(withIt.status) && !lateBelt) return { success: false, error: "The ride has ended" };
        // A late belt of a run that a later run of its exercise (Run again) follows would move that run's rows.
        if (lateBelt) {
          const [again] = await tx
            .select({ id: rides.id })
            .from(rides)
            .where(and(eq(rides.userId, userId), eq(rides.sessionId, ride.sessionId), ne(rides.id, rideId), gt(rides.startedAt, ride.startedAt), ride.programExerciseId === null ? isNull(rides.programExerciseId) : eq(rides.programExerciseId, ride.programExerciseId)))
            .limit(1);
          if (again) return { success: false, error: "The ride has ended" };
        }
        if (isLive(withIt.status)) {
          // Never once a later session has started (docs/plans/run-logger.md, 4.3): the queue drops it.
          const [later] = await tx
            .select({ id: rides.id })
            .from(rides)
            .where(and(eq(rides.userId, userId), ne(rides.id, rideId), gt(rides.startedAt, ride.startedAt)))
            .limit(1);
          if (later) return { success: false, error: "The ride has ended" };
        }
      }
      await tx.insert(rideEvents).values({
        rideId,
        seq,
        clientId,
        kind,
        value: value ?? null,
        stepKey: stepKey ?? null,
        at: new Date(at),
        clientAt: clientAt != null ? new Date(clientAt) : null,
      });
      const [next] = await tx
        .update(rides)
        .set(reason ? { seq, endReason: reason } : { seq })
        .where(eq(rides.id, rideId))
        .returning();
      const after = await settle(tx, next, now);
      await schedulePushes(tx, userId, after);
      // A late belt or incline (an offline replay) moves the meters of steps already saved (4.7).
      if (kind === "belt" || kind === "incline") await rewriteBeltResults(tx, userId, after, view);
      return { success: true, data: after };
    });
  } catch (e) {
    // A ride made live again while another one runs.
    if (isUniqueViolation(e)) return { success: false, error: "A ride is already running" };
    console.error("[sendRideEvent] failed", { rideId, kind });
    return { success: false, error: "Failed to save the ride" };
  }
}

const getRideSchema = z.object({ rideId: z.number().int().positive().optional() });

/** One of the user's rides by id, or without an id the user's active ride (null when none runs). */
export async function getRide(data: unknown): Promise<ActionResult<RideView | null>> {
  const auth = await requireSession();
  const parsed = getRideSchema.safeParse(data ?? {});
  if (!parsed.success) return { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  const userId = auth.user.id;

  try {
    const [ride] = await db
      .select()
      .from(rides)
      .where(and(eq(rides.userId, userId), parsed.data.rideId ? eq(rides.id, parsed.data.rideId) : inArray(rides.status, LIVE)));
    if (!ride) return parsed.data.rideId ? { success: false, error: "Not found" } : { success: true, data: null };
    const view = await settle(db, ride, Date.now());
    if (!parsed.data.rideId && !isLive(view.ride.status)) return { success: true, data: null };
    return { success: true, data: view };
  } catch {
    console.error("[getRide] failed", { rideId: parsed.data.rideId ?? null });
    return { success: false, error: "Failed to read the ride" };
  }
}

const setRideEndReasonSchema = z.object({ rideId: z.number().int().positive(), reason: z.enum(END_REASONS).nullable() });

/**
 * Why a run ended early (docs/plans/run-logger.md, R15), chosen on its
 * ended-early screen: Tired, Pain, Time or Other, or none. Only on a run or
 * ride that ended early.
 */
export async function setRideEndReason(data: unknown): Promise<ActionResult<{ reason: (typeof END_REASONS)[number] | null }>> {
  const auth = await requireSession();
  const parsed = setRideEndReasonSchema.safeParse(data);
  if (!parsed.success) return { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  const { rideId, reason } = parsed.data;
  try {
    const [row] = await db
      .update(rides)
      .set({ endReason: reason })
      .where(and(eq(rides.id, rideId), eq(rides.userId, auth.user.id), eq(rides.status, "ended_early")))
      .returning({ id: rides.id });
    if (!row) return { success: false, error: "Not found" };
    return { success: true, data: { reason } };
  } catch {
    console.error("[setRideEndReason] failed", { rideId });
    return { success: false, error: "Failed to save the reason" };
  }
}
