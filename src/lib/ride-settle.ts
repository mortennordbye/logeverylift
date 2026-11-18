/**
 * A ride as its timeline says it is now (docs/plans/bike-ride-logger.md,
 * 4.3), for the ride actions and for finishing a workout. Plain server code:
 * callers resolve the user and lock the ride when they write events.
 */

import { db } from "@/db";
import { exercises, programExercises, programSets, rideEvents, rides, workoutSessions, workoutSets } from "@/db/schema";
import { liveProgramExercises, liveProgramSets } from "@/lib/plan-live";
import { plannedStepSnapshot } from "@/lib/program-steps-db";
import { scheduleRidePushes } from "@/lib/push";
import { rideStepSnapshot } from "@/lib/ride-plan-db";
import { buildWorkout, type StepRow } from "@/lib/utils/program-steps";
import { buildRidePlan, rideTimeline, type RideEventInput, type RidePlan } from "@/lib/utils/ride-timeline";
import { parseWorkout } from "@/lib/utils/workout-steps";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";

type Ride = typeof rides.$inferSelect;
type Executor = Pick<typeof db, "select" | "update" | "insert" | "transaction">;

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

export const LIVE = ["running", "paused"] as const;
export const isLive = (status: Ride["status"]) => status === "running" || status === "paused";

/** The client id of the `end` a finished workout stores on its ride. */
const workoutEndId = (rideId: number) => `workout-finished-${rideId}`;

async function readEvents(ex: Executor, rideId: number) {
  const rows = await ex.select().from(rideEvents).where(eq(rideEvents.rideId, rideId)).orderBy(asc(rideEvents.seq));
  return rows.map((e) => ({ seq: e.seq, kind: e.kind, value: e.value, at: e.at.getTime(), clientId: e.clientId }));
}

/**
 * A live ride whose workout is finished (Finish workout, the stale sweep)
 * ends: an `end` at the server's time, after every stored event and
 * heartbeat, so the timeline ends it there and no later tap makes it live
 * again. Its done steps stay; the steps not ridden are not done. Returns the
 * ride with the new seq, or null when the workout is open or another write
 * moved the ride first.
 */
async function endForFinishedWorkout(ex: Executor, ride: Ride, events: { at: number }[], now: number): Promise<Ride | null> {
  const [session] = await ex
    .select({ isCompleted: workoutSessions.isCompleted })
    .from(workoutSessions)
    .where(and(eq(workoutSessions.id, ride.sessionId), eq(workoutSessions.userId, ride.userId)));
  if (!session?.isCompleted) return null;
  const at = Math.max(now, ride.heartbeatAt?.getTime() ?? 0, ...events.map((e) => e.at));
  return ex.transaction(async (sp) => {
    const [bumped] = await sp
      .update(rides)
      .set({ seq: ride.seq + 1 })
      .where(and(eq(rides.id, ride.id), eq(rides.seq, ride.seq)))
      .returning();
    if (!bumped) return null;
    await sp.insert(rideEvents).values({ rideId: ride.id, seq: bumped.seq, clientId: workoutEndId(ride.id), kind: "end", at: new Date(at) });
    return bumped;
  });
}

/**
 * The ride with its events, after storing what the timeline says now: a ride
 * whose last step ran out, that ended on its own, or whose workout is
 * finished is stored as ended.
 */
export async function settle(ex: Executor, ride: Ride, now: number): Promise<RideView> {
  let events = await readEvents(ex, ride.id);
  const plan = ride.plan as RidePlan;
  const timeline = () => rideTimeline(plan, events, now, { heartbeatAt: ride.heartbeatAt?.getTime() ?? null });
  let t = timeline();
  let ended = false;
  if (isLive(t.status)) {
    const bumped = await endForFinishedWorkout(ex, ride, events, now);
    if (bumped) {
      ride = bumped;
      events = await readEvents(ex, ride.id);
      t = timeline();
      ended = true;
    }
  }
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
  const view: RideView = {
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
  // The ended ride's alerts go.
  if (ended) await schedulePushes(ex, ride.userId, view);
  return view;
}

/**
 * The exercise's step sets the ride never runs (the recovery after a repeat's
 * last round, 4.4) are logged as not done when the ride ends, so the workout
 * reads the exercise as handled. A row already there stays.
 */
async function logDroppedSteps(ex: Executor, ride: Ride, plan: RidePlan) {
  if (ride.programExerciseId === null) return;
  const inPlan = new Set(plan.steps.map((s) => s.programSetId));
  // A plan frozen with its dropped steps logs only those, as planned at the
  // start: a set the program gained during the ride is not this ride's (D9).
  const dropped = plan.dropped ? new Set(plan.dropped.map((s) => s.programSetId)) : null;
  const sets = await ex
    .select({ id: programSets.id, setNumber: programSets.setNumber, exerciseId: programExercises.exerciseId })
    // plan-read: includes deleted (the ride's exercise row for its exercise id, and its sets as frozen or the live ones)
    .from(programSets)
    .innerJoin(programExercises, eq(programExercises.id, programSets.programExerciseId))
    .where(
      dropped
        ? and(eq(programSets.programExerciseId, ride.programExerciseId), inArray(programSets.id, [...dropped, -1]))
        : and(eq(programSets.programExerciseId, ride.programExerciseId), isNotNull(programSets.stepKind), liveProgramSets),
    );
  await logNotDone(ex, ride.userId, ride.sessionId, ride.programExerciseId, sets.filter((x) => !inPlan.has(x.id)));
}

/** Log these step sets as not done on the session; a row already there stays. */
async function logNotDone(
  ex: Executor,
  userId: string,
  sessionId: number,
  programExerciseId: number,
  sets: { id: number; setNumber: number; exerciseId: number }[],
) {
  for (const set of sets) {
    const plannedStep = (await rideStepSnapshot(ex, userId, sessionId, set.id)) ?? (await plannedStepSnapshot(ex, set.id, userId));
    await ex
      .insert(workoutSets)
      .values({
        sessionId,
        exerciseId: set.exerciseId,
        programExerciseId,
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
 * A bike exercise logged by hand (no ride on the session): once every step
 * the ride would run has a row, the steps a repeat drops after its last round
 * (4.4) are logged as not done, as `logDroppedSteps` does when a ride ends, so
 * the workout reads the exercise as done. Clients never send not done.
 */
export async function logDroppedStepsByHand(userId: string, sessionId: number, programExerciseId: number): Promise<void> {
  const [ride] = await db
    .select({ id: rides.id })
    .from(rides)
    .where(and(eq(rides.userId, userId), eq(rides.sessionId, sessionId), eq(rides.programExerciseId, programExerciseId)))
    .limit(1);
  if (ride) return;
  const rows = await db
    .select({ set: programSets, exerciseId: programExercises.exerciseId, discipline: exercises.discipline })
    .from(programSets)
    .innerJoin(programExercises, eq(programExercises.id, programSets.programExerciseId))
    .innerJoin(exercises, eq(exercises.id, programExercises.exerciseId))
    .where(and(eq(programSets.programExerciseId, programExerciseId), isNotNull(programSets.stepKind), liveProgramSets, liveProgramExercises))
    .orderBy(asc(programSets.setNumber), asc(programSets.id));
  if (!rows.length || rows[0].discipline !== "bike") return;
  const built = buildWorkout(rows.map((r) => r.set) as StepRow[], { sport: "bike", name: "" });
  const tree = "workout" in built ? parseWorkout(built.workout) : null;
  if (!tree?.ok) return;
  const plan = buildRidePlan(tree.workout, rows.map((r) => r.set.id), {}, "indoor");
  if (!plan.dropped?.length) return;
  const logged = await db
    .select({ id: workoutSets.programSetId })
    .from(workoutSets)
    .where(and(eq(workoutSets.sessionId, sessionId), inArray(workoutSets.programSetId, plan.steps.map((s) => s.programSetId)), isNotNull(workoutSets.stepStatus)));
  if (new Set(logged.map((l) => l.id)).size < plan.steps.length) return;
  const dropped = new Set(plan.dropped.map((d) => d.programSetId));
  const sets = rows.filter((r) => dropped.has(r.set.id)).map((r) => ({ id: r.set.id, setNumber: r.set.setNumber, exerciseId: r.exerciseId }));
  await logNotDone(db, userId, sessionId, programExerciseId, sets);
}

/**
 * Rewrite the ride's push alerts from its timeline (4.7). A failure is logged
 * and never fails the ride action: the alerts are a help, the ride is the data.
 */
export async function schedulePushes(ex: Pick<typeof db, "transaction">, userId: string, view: RideView) {
  try {
    // A savepoint inside the event's transaction, so a failure rolls back only the alerts.
    await ex.transaction((sp) => scheduleRidePushes(sp, userId, view));
  } catch {
    console.error("[ridePush] schedule failed", { rideId: view.ride.id });
  }
}

/** End the live rides of a workout that was just finished, each under its row lock. */
export async function endRidesOfFinishedSession(userId: string, sessionId: number): Promise<void> {
  const live = await db
    .select({ id: rides.id })
    .from(rides)
    .where(and(eq(rides.userId, userId), eq(rides.sessionId, sessionId), inArray(rides.status, LIVE)));
  for (const { id } of live) {
    await db.transaction(async (tx) => {
      const [ride] = await tx.select().from(rides).where(eq(rides.id, id)).for("update");
      if (ride) await settle(tx, ride, Date.now());
    });
  }
}
