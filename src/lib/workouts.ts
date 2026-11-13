/**
 * The workout library on the server (docs/plans/workouts-and-compliance.md,
 * 4.1 and 5): read, create, update, duplicate and delete reusable workouts.
 * Every write is a revision (object type `workout`). Editing or deleting a
 * library workout is a template change for every live active or scheduled
 * cycle whose slots use it: their untouched sessions from this week's Monday
 * on follow it, this week's past days included (T7; C2 decision 19). Done and
 * touched sessions, and sessions of earlier weeks, keep their copy.
 *
 * Plain server code: callers resolve the user and check the endurance switch.
 */

import { db } from "@/db";
import { trainingCycleSlots, trainingCycles, workouts, type SessionPriority } from "@/db/schema";
import { assertAthleteRoom, lockCycleRows, planWrite, PlanNotFoundError, type PlanWriteContext, type PlanWriteSession, type Tx } from "@/lib/plan-revisions";
import { withLimits, type LimitContext, type LimitOverride } from "@/lib/training-limits";
import type { LimitCheck, LimitRule } from "@/lib/utils/training-limits";
import { regenerateCycleSessions, WorkoutSchemaError } from "@/lib/planned-sessions";
import { getUserSettings } from "@/lib/user-settings";
import { describeWorkout, estimateWorkout, parseWorkout, type Workout, type WorkoutEstimate } from "@/lib/utils/workout-steps";
import { and, asc, eq, ilike, isNotNull, isNull, or } from "drizzle-orm";

export type LibraryWorkout = {
  id: number;
  name: string;
  sport: Workout["sport"];
  priority: SessionPriority | null;
  workout: Workout;
  summary: string;
  estimate: WorkoutEstimate;
  version: number;
  deletedAt: Date | null;
};

type WorkoutRow = typeof workouts.$inferSelect;

function view(row: WorkoutRow, units: Parameters<typeof describeWorkout>[1]): LibraryWorkout | null {
  const parsed = parseWorkout(row.workout);
  if (!parsed.ok) {
    console.error("[workouts] invalid_stored", { id: row.id });
    return null;
  }
  return {
    id: row.id,
    name: row.name,
    sport: row.sport,
    priority: row.priority,
    workout: parsed.workout,
    summary: describeWorkout(parsed.workout, units),
    estimate: estimateWorkout(parsed.workout),
    version: row.version,
    deletedAt: row.deletedAt,
  };
}

/** The user's live library, by name; `deleted` lists the recently deleted ones instead. */
export async function listWorkouts(userId: string, opts: { sport?: Workout["sport"]; q?: string; deleted?: boolean } = {}): Promise<LibraryWorkout[]> {
  const { units } = await getUserSettings(userId);
  const rows = await db
    .select()
    .from(workouts)
    .where(
      and(
        eq(workouts.userId, userId),
        // plan-read: includes deleted (Recently deleted lists them on purpose)
        opts.deleted ? isNotNull(workouts.deletedAt) : isNull(workouts.deletedAt),
        opts.sport ? eq(workouts.sport, opts.sport) : undefined,
        opts.q ? ilike(workouts.name, `%${opts.q.replace(/[%_\\]/g, "\\$&")}%`) : undefined,
      ),
    )
    .orderBy(asc(workouts.name), asc(workouts.id));
  return rows
    .filter((r) => (opts.deleted ? r.deletedAt != null : true))
    .map((r) => view(r, units))
    .filter((w): w is LibraryWorkout => w != null);
}

/** One live library workout of the user, or null. */
export async function getLibraryWorkout(userId: string, id: number): Promise<LibraryWorkout | null> {
  const { units } = await getUserSettings(userId);
  const [row] = await db.select().from(workouts).where(and(eq(workouts.id, id), eq(workouts.userId, userId), isNull(workouts.deletedAt)));
  return row ? view(row, units) : null;
}

function checked(input: unknown): Workout {
  const parsed = parseWorkout(input);
  if (!parsed.ok) throw new WorkoutSchemaError(parsed.errors);
  return parsed.workout;
}

/**
 * The live weekday cycles whose slots use this workout,
 * locked in A4's order (cycles first), then their untouched sessions follow
 * the library. Returns how many sessions changed.
 */
export async function regenerateUsers(tx: Tx, userId: string, workoutId: number): Promise<number> {
  const ids = await cyclesUsingWorkout(userId, workoutId, tx);
  if (!ids.length) return 0;
  await lockCycleRows(tx, ids);
  let changed = 0;
  for (const id of ids) {
    const r = await regenerateCycleSessions(tx, userId, id);
    changed += r.inserted + r.updated + r.removed;
  }
  return changed;
}

/**
 * Ids of the cycles whose dated sessions follow this library workout, in id
 * order: live weekday cycles that are active or scheduled to start. Completed,
 * unscheduled draft and rotation cycles have no sessions to follow it, so they
 * are neither locked nor limit-checked (review).
 */
export async function cyclesUsingWorkout(userId: string, workoutId: number, ex: typeof db | Tx = db): Promise<number[]> {
  const rows = await ex
    .selectDistinct({ id: trainingCycles.id })
    .from(trainingCycles)
    .innerJoin(trainingCycleSlots, eq(trainingCycleSlots.trainingCycleId, trainingCycles.id))
    .where(
      and(
        eq(trainingCycles.userId, userId),
        isNull(trainingCycles.deletedAt),
        eq(trainingCycles.scheduleType, "day_of_week"),
        or(eq(trainingCycles.status, "active"), and(eq(trainingCycles.status, "draft"), isNotNull(trainingCycles.scheduledStartDate))),
        eq(trainingCycleSlots.workoutId, workoutId),
      ),
    );
  return rows.map((r) => r.id).sort((a, b) => a - b);
}

export async function createWorkout(
  ctx: PlanWriteContext,
  input: { workout: unknown; priority?: SessionPriority | null },
): Promise<{ id: number; version: number }> {
  const workout = checked(input.workout);
  const { result, versions } = await planWrite(ctx, async (w) => {
    await assertAthleteRoom(w.tx, ctx.userId, "workout");
    const [row] = await w.tx
      .insert(workouts)
      .values({ userId: ctx.userId, name: workout.name, sport: workout.sport, workout, priority: input.priority ?? null })
      .returning({ id: workouts.id });
    w.create({ type: "workout", id: row.id });
    return row.id;
  });
  return { id: result, version: versions.get(`workout:${result}`) ?? 1 };
}

export async function updateWorkout(
  ctx: PlanWriteContext,
  id: number,
  input: { workout?: unknown; priority?: SessionPriority | null; name?: string; expectedVersion?: number },
  /** An assistant's edit runs the training limits on the sessions it rewrites (D3, review 3); the app's never does (D4). */
  limits?: { lc: LimitContext; override: LimitOverride },
): Promise<{ id: number; version: number; sessionsRegenerated: number; limits: { check: LimitCheck; unusedOverrides: LimitRule[] } | null }> {
  const workout = input.workout !== undefined ? checked(input.workout) : null;
  const cycleIds = await cyclesUsingWorkout(ctx.userId, id);
  const { result, versions } = await planWrite(ctx, async (w) => {
    if (cycleIds.length) await lockCycleRows(w.tx, cycleIds);
    const write = () => applyUpdate(w, ctx, id, input, workout);
    if (!limits || !cycleIds.length) return { regenerated: await write(), limits: null };
    const { result: regenerated, check, unusedOverrides } = await withLimits(w, limits.lc, { programIds: [], cycleIds }, limits.override, write);
    return { regenerated, limits: { check, unusedOverrides } };
  });
  return { id, version: versions.get(`workout:${id}`) ?? 0, sessionsRegenerated: result.regenerated, limits: result.limits };
}

async function applyUpdate(
  w: PlanWriteSession,
  ctx: PlanWriteContext,
  id: number,
  input: { priority?: SessionPriority | null; name?: string; expectedVersion?: number },
  given: Workout | null,
): Promise<number> {
  await w.touch({ type: "workout", id }, { expectedVersion: input.expectedVersion });
  const [row] = await w.tx.select().from(workouts).where(and(eq(workouts.id, id), eq(workouts.userId, ctx.userId), isNull(workouts.deletedAt)));
  if (!row) throw new PlanNotFoundError({ type: "workout", id });
  const workout = input.name !== undefined ? checked({ ...(given ?? (row.workout as object)), name: input.name }) : given;
  await w.tx
    .update(workouts)
    .set({
      ...(workout && { workout, name: workout.name, sport: workout.sport }),
      ...(input.priority !== undefined && { priority: input.priority }),
      updatedAt: new Date(),
    })
    .where(eq(workouts.id, id));
  return regenerateUsers(w.tx, ctx.userId, id);
}

export async function duplicateWorkout(ctx: PlanWriteContext, id: number): Promise<{ id: number; version: number }> {
  const src = await getLibraryWorkout(ctx.userId, id);
  if (!src) throw new PlanNotFoundError({ type: "workout", id });
  const name = `${src.name} (copy)`.slice(0, 80);
  return createWorkout(ctx, { workout: { ...src.workout, name }, priority: src.priority });
}

export async function deleteWorkout(ctx: PlanWriteContext, id: number, expectedVersion?: number): Promise<{ sessionsRegenerated: number }> {
  const cycleIds = await cyclesUsingWorkout(ctx.userId, id);
  const { result } = await planWrite(ctx, async (w) => {
    if (cycleIds.length) await lockCycleRows(w.tx, cycleIds);
    await w.touch({ type: "workout", id }, { expectedVersion, action: "delete" });
    const [row] = await w.tx.select({ id: workouts.id }).from(workouts).where(and(eq(workouts.id, id), eq(workouts.userId, ctx.userId), isNull(workouts.deletedAt)));
    if (!row) throw new PlanNotFoundError({ type: "workout", id });
    await w.tx.update(workouts).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(workouts.id, id));
    return regenerateUsers(w.tx, ctx.userId, id);
  });
  return { sessionsRegenerated: result };
}
