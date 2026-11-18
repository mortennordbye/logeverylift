"use server";

/**
 * Ride mode on the server (docs/plans/bike-ride-logger.md, 4.3): start a
 * ride, record what the rider does, and read the ride back. The server keeps
 * the plan frozen at start and the events; `rideTimeline` works out the rest,
 * the same way on every device. Server time is the clock.
 */

import { db } from "@/db";
import { RIDE_MODES, exercises, programExercises, programSets, programs, rideEvents, rides, workoutSessions, workoutSets } from "@/db/schema";
import { isUniqueViolation } from "@/lib/custom-exercises";
import { enduranceEnabledFor } from "@/lib/endurance";
import { liveProgramExercises, liveProgramSets, livePrograms } from "@/lib/plan-live";
import { plannedStepSnapshot } from "@/lib/program-steps-db";
import { scheduleRidePushes } from "@/lib/push";
import { thresholdValues } from "@/lib/session-compliance";
import { buildWorkout, type StepRow } from "@/lib/utils/program-steps";
import {
  EXTEND_STEP_S,
  NUDGE_STEP_W,
  RIDE_CONFLICT,
  buildRidePlan,
  eventTime,
  rideTimeline,
  type RideEventInput,
  type RidePlan,
} from "@/lib/utils/ride-timeline";
import { requireSession } from "@/lib/utils/session";
import { parseWorkout } from "@/lib/utils/workout-steps";
import type { ActionResult } from "@/types/workout";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";

type Ride = typeof rides.$inferSelect;
type Executor = Pick<typeof db, "select" | "update" | "insert">;

/** A ride as the client reads it. Times are epoch ms; `serverNow` lets the client keep its clock offset. */
export type RideView = {
  ride: {
    id: number;
    sessionId: number;
    programExerciseId: number | null;
    mode: Ride["mode"];
    status: Ride["status"];
    seq: number;
    startedAt: number;
    endedAt: number | null;
    /** The last heartbeat of a visible app, for the timeline's auto end. */
    heartbeatAt: number | null;
  };
  plan: RidePlan;
  events: (RideEventInput & { clientId: string })[];
  serverNow: number;
};

const LIVE = ["running", "paused"] as const;
const isLive = (status: Ride["status"]) => status === "running" || status === "paused";

/**
 * The ride with its events, after storing what the timeline says now: a ride
 * whose last step ran out, or that ended on its own, is stored as ended.
 */
async function settle(ex: Executor, ride: Ride, now: number): Promise<RideView> {
  const rows = await ex.select().from(rideEvents).where(eq(rideEvents.rideId, ride.id)).orderBy(asc(rideEvents.seq));
  const events = rows.map((e) => ({ seq: e.seq, kind: e.kind, value: e.value, at: e.at.getTime(), clientId: e.clientId }));
  const plan = ride.plan as RidePlan;
  const t = rideTimeline(plan, events, now, { heartbeatAt: ride.heartbeatAt?.getTime() ?? null });
  let { status, endedAt } = ride;
  if (t.status !== ride.status || (t.endedAt ?? null) !== (ride.endedAt?.getTime() ?? null)) {
    status = t.status;
    endedAt = t.endedAt !== null ? new Date(t.endedAt) : null;
    // Only over the events read here: a newer event settles the ride itself.
    const [stored] = await ex
      .update(rides)
      .set({ status, endedAt })
      .where(and(eq(rides.id, ride.id), eq(rides.seq, ride.seq)))
      .returning({ id: rides.id });
    // The workout keeps whether its ride ended early (4.3): compliance does not
    // count an ended-early key session as done. An unskip that makes the ride
    // live again clears it.
    if (stored) {
      await ex
        .update(workoutSessions)
        .set({ endedEarly: status === "ended_early" })
        .where(and(eq(workoutSessions.id, ride.sessionId), eq(workoutSessions.userId, ride.userId)));
      if (status === "finished" || status === "ended_early") await logDroppedSteps(ex, ride, plan);
    }
  }
  return {
    ride: {
      id: ride.id,
      sessionId: ride.sessionId,
      programExerciseId: ride.programExerciseId,
      mode: ride.mode,
      status,
      seq: ride.seq,
      startedAt: ride.startedAt.getTime(),
      endedAt: endedAt?.getTime() ?? null,
      heartbeatAt: ride.heartbeatAt?.getTime() ?? null,
    },
    plan,
    events,
    serverNow: now,
  };
}

/**
 * The exercise's step sets the ride never runs (the recovery after a repeat's
 * last round, 4.4) are logged as not done when the ride ends, so the workout
 * reads the exercise as handled. A row already there stays.
 */
async function logDroppedSteps(ex: Executor, ride: Ride, plan: RidePlan) {
  if (ride.programExerciseId === null) return;
  const inPlan = new Set(plan.steps.map((s) => s.programSetId));
  const sets = await ex
    .select({ id: programSets.id, setNumber: programSets.setNumber, exerciseId: programExercises.exerciseId })
    // plan-read: includes deleted (the ride's exercise row, for its exercise id, and the live sets)
    .from(programSets)
    .innerJoin(programExercises, eq(programExercises.id, programSets.programExerciseId))
    .where(and(eq(programSets.programExerciseId, ride.programExerciseId), isNotNull(programSets.stepKind), liveProgramSets));
  for (const set of sets.filter((x) => !inPlan.has(x.id))) {
    const plannedStep = await plannedStepSnapshot(ex, set.id, ride.userId);
    await ex
      .insert(workoutSets)
      .values({
        sessionId: ride.sessionId,
        exerciseId: set.exerciseId,
        programExerciseId: ride.programExerciseId,
        programSetId: set.id,
        setNumber: set.setNumber,
        actualReps: 0,
        weightKg: "0",
        restTimeSeconds: 0,
        isCompleted: false,
        stepStatus: "not_done",
        plannedStep,
      })
      .onConflictDoNothing({ target: [workoutSets.sessionId, workoutSets.programSetId] });
  }
}

/**
 * Rewrite the ride's push alerts from its timeline (4.7). A failure is logged
 * and never fails the ride action: the alerts are a help, the ride is the data.
 */
async function schedulePushes(ex: Pick<typeof db, "transaction">, userId: string, view: RideView) {
  try {
    // A savepoint inside the event's transaction, so a failure rolls back only the alerts.
    await ex.transaction((sp) => scheduleRidePushes(sp, userId, view));
  } catch {
    console.error("[ridePush] schedule failed", { rideId: view.ride.id });
  }
}

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
});

/**
 * Start a ride of a bike exercise in an open workout session. The plan is
 * frozen now, with watts from the FTP of this moment (D9). One active ride
 * per user: a ride that has ended by its timeline is closed first.
 */
export async function startRide(data: unknown): Promise<ActionResult<RideView>> {
  const auth = await requireSession();
  const parsed = startRideSchema.safeParse(data);
  if (!parsed.success) return { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  const userId = auth.user.id;
  const { sessionId, programExerciseId, mode, clientId } = parsed.data;
  if (!(await enduranceEnabledFor(userId))) return { success: false, error: "Endurance features are not on for this account" };

  try {
    const replay = await startedWith(userId, clientId);
    if (replay) return { success: true, data: replay };

    const [session] = await db
      .select({ programId: workoutSessions.programId, isCompleted: workoutSessions.isCompleted })
      .from(workoutSessions)
      .where(and(eq(workoutSessions.id, sessionId), eq(workoutSessions.userId, userId)));
    if (!session) return { success: false, error: "Not found" };
    if (session.isCompleted) return { success: false, error: "This workout is finished" };

    const [slot] = await db
      .select({ programId: programExercises.programId, discipline: exercises.discipline, name: programs.name })
      .from(programExercises)
      .innerJoin(programs, eq(programs.id, programExercises.programId))
      .innerJoin(exercises, eq(exercises.id, programExercises.exerciseId))
      .where(and(eq(programExercises.id, programExerciseId), eq(programs.userId, userId), liveProgramExercises, livePrograms));
    if (!slot || slot.programId !== session.programId) return { success: false, error: "Not found" };
    if (slot.discipline !== "bike") return { success: false, error: "Only a bike exercise has ride mode" };

    const rows = await db
      .select()
      .from(programSets)
      .where(and(eq(programSets.programExerciseId, programExerciseId), isNotNull(programSets.stepKind), liveProgramSets))
      .orderBy(asc(programSets.setNumber), asc(programSets.id));
    const built = rows.length ? buildWorkout(rows as StepRow[], { sport: "bike", name: slot.name }) : null;
    const tree = built && "workout" in built ? parseWorkout(built.workout) : null;
    if (!tree?.ok) return { success: false, error: "This exercise has no steps to ride" };
    const plan = buildRidePlan(tree.workout, rows.map((r) => r.id), await thresholdValues(userId), mode);

    const now = Date.now();
    const [active] = await db.select().from(rides).where(and(eq(rides.userId, userId), inArray(rides.status, LIVE)));
    if (active && isLive((await settle(db, active, now)).ride.status)) {
      return { success: false, error: "A ride is already running" };
    }

    const ride = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(rides)
        .values({ userId, sessionId, programExerciseId, mode, status: "running", plan, seq: 1, startedAt: new Date(now) })
        .returning();
      await tx.insert(rideEvents).values({ rideId: row.id, seq: 1, clientId, kind: "start", at: new Date(now) });
      await tx.update(workoutSessions).set({ rideMode: mode }).where(and(eq(workoutSessions.id, sessionId), eq(workoutSessions.userId, userId)));
      return row;
    });
    const view = await settle(db, ride, now);
    await schedulePushes(db, userId, view);
    return { success: true, data: view };
  } catch (e) {
    // Two starts at once: the active-ride index lets one through. A retry of
    // the same start gets that ride.
    if (isUniqueViolation(e)) {
      const same = await startedWith(userId, clientId);
      return same ? { success: true, data: same } : { success: false, error: "A ride is already running" };
    }
    console.error("[startRide] failed", { sessionId, programExerciseId });
    return { success: false, error: "Failed to start the ride" };
  }
}

const sendRideEventSchema = z
  .object({
    rideId: z.number().int().positive(),
    clientId: clientIdSchema,
    kind: z.enum(["pause", "resume", "skip", "unskip", "extend", "nudge", "lap", "end", "heartbeat"]),
    value: z.number().int().optional(),
    // When it happened on the phone (epoch ms), sent for an event replayed after being offline.
    clientAt: z.number().int().positive().optional(),
    // The seq of the last event this client knows. Another device's event in between is a conflict.
    expectedSeq: z.number().int().min(0),
  })
  .refine((d) => (d.kind === "nudge" ? Math.abs(d.value ?? 0) === NUDGE_STEP_W : d.kind === "extend" ? Math.abs(d.value ?? 0) === EXTEND_STEP_S : d.value === undefined), {
    message: `a nudge is ±${NUDGE_STEP_W} W, an extend ±${EXTEND_STEP_S} s, other events take no value`,
    path: ["value"],
  });

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
  const { rideId, clientId, kind, value, clientAt, expectedSeq } = parsed.data;

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

      const view = await settle(tx, ride, now);
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
        const withIt = rideTimeline(view.plan, [...view.events, { seq, kind, value: value ?? null, at }], now, { heartbeatAt });
        if (!isLive(withIt.status)) return { success: false, error: "The ride has ended" };
      }
      await tx.insert(rideEvents).values({
        rideId,
        seq,
        clientId,
        kind,
        value: value ?? null,
        at: new Date(at),
        clientAt: clientAt != null ? new Date(clientAt) : null,
      });
      const [next] = await tx.update(rides).set({ seq }).where(eq(rides.id, rideId)).returning();
      const after = await settle(tx, next, now);
      await schedulePushes(tx, userId, after);
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
