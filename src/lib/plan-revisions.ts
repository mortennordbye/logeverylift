/**
 * The revision layer (docs/plans/revisions.md, section 2; decisions D2, T2,
 * T3, T6, T9). Every write to programs, program_exercises, program_sets,
 * training_cycles and training_cycle_slots goes through `planWrite`, which
 * locks the objects it touches, checks versions, writes the change, and stores
 * a revision with the whole object. Restores, the history and the AI changes
 * feed read those revisions.
 *
 * Plain server code that takes a resolved userId, like periodization-sync.ts:
 * Server Actions call it after requireSession, MCP tools after their own auth.
 * The pure rules live in src/lib/utils/plan-revisions.ts.
 */

import { db } from "@/db";
import {
  athleteInjuries,
  athleteProfiles,
  athleteThresholds,
  coachMemory,
  exercises,
  illnessPeriods,
  planRevisions,
  plannedSessions,
  programExercises,
  programSets,
  programs,
  seasonRaces,
  seasons,
  trainingCycleSlots,
  trainingCycles,
  workoutSessions,
  workouts,
  type PlanObjectType,
  type PlanRevisionAction,
  type PlanWriter,
} from "@/db/schema";
import {
  CYCLE_KEPT,
  DELETED_PLAN_RETENTION_DAYS,
  EXERCISE_KEPT,
  PROGRAM_KEPT,
  REVISION_RETENTION_DAYS,
  canonical,
  changeSetFor,
  diffSnapshots,
  isMemorySnapshot,
  isCycleSnapshot,
  isProgramSnapshot,
  isSeasonSnapshot,
  isPlannedSessionSnapshot,
  PLANNED_SESSION_KEPT,
  type PlannedSessionSnapshot,
  MEMORY_KEPT,
  ROW_KEPT,
  SEASON_KEPT,
  queuedWriteConflicts,
  OTHER_WRITERS,
  restoredSetValues,
  sameSnapshot,
  sameValue,
  setChangesSince,
  snapshotName,
  type CycleSnapshot,
  type MemorySnapshot,
  type PlanSnapshot,
  isAthleteSnapshot,
  isInjurySnapshot,
  isIllnessSnapshot,
  isThresholdSnapshot,
  isWorkoutSnapshot,
  type ProgramSnapshot,
  type Row,
  type SeasonSnapshot,
} from "@/lib/utils/plan-revisions";
import { enduranceEnabledFor } from "@/lib/endurance";
import { nextPhase, replanReason, seasonTimeline, type PhaseLike, type RaceLike } from "@/lib/utils/seasons";
import { judgingRuleChanged } from "@/lib/utils/progression";
import { THRESHOLDS_PER_KIND_MAX } from "@/lib/utils/thresholds";
import { limitOverrideLine } from "@/lib/utils/training-limits";
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

export type PlanWriteContext = {
  userId: string;
  writer: PlanWriter;
  reason?: string | null;
  changeSetId?: string | null;
  clientId?: string | null;
  /**
   * What the training limits found on an assistant write, stored on each of
   * its revisions (docs/plans/ai-coach.md, 2.4). Set before or during the
   * write; read when the revisions are stored.
   */
  limitCheck?: unknown;
};

export type PlanTarget = { type: PlanObjectType; id: number };

/** A write was based on an older version of the object (T9). Nothing was applied. */
export class PlanConflictError extends Error {
  constructor(
    readonly target: PlanTarget,
    readonly currentVersion: number,
    readonly expectedVersion: number,
  ) {
    super(
      `Conflict: ${target.type} ${target.id} is at version ${currentVersion}, and the change was based on version ${expectedVersion}.`,
    );
  }
}

const NOT_FOUND: Record<PlanObjectType, string> = {
  program: "Program not found",
  cycle: "Training cycle not found",
  memory: "Memory entry not found",
  athlete: "Athlete profile not found",
  threshold: "Threshold not found",
  injury: "Injury not found",
  season: "Season not found",
  planned_session: "Planned session not found",
  workout: "Workout not found",
  illness: "Sick period not found",
};

/** The object is missing, deleted, or not the caller's. */
export class PlanNotFoundError extends Error {
  constructor(readonly target: PlanTarget) {
    super(NOT_FOUND[target.type]);
  }
}

/** A write the object's current state does not allow; the message says why. */
export class PlanStateError extends Error {}

/** A plan change that would disturb a workout in progress. */
export class OpenWorkoutError extends Error {
  constructor() {
    super("Finish or discard the workout in progress first");
  }
}

/** Whether a writer's revisions bump the version (2.2). */
const bumps = (writer: PlanWriter, action: PlanRevisionAction) =>
  writer === "user" || writer === "assistant" || action === "restore";

const key = (t: PlanTarget) => `${t.type}:${t.id}`;

/** The one-row object types: the whole object is one row (docs/plans/athlete-profile.md, 2.2). */
const ROW_TABLES = {
  memory: coachMemory,
  athlete: athleteProfiles,
  threshold: athleteThresholds,
  injury: athleteInjuries,
  workout: workouts,
  illness: illnessPeriods,
} as const;
type RowType = keyof typeof ROW_TABLES;
const isRowType = (type: PlanObjectType): type is RowType => type in ROW_TABLES;

/** The table that holds an object's row, with its owner, version and soft delete. */
const tableOf = (type: PlanObjectType) =>
  type === "program"
    ? programs
    : type === "cycle"
      ? trainingCycles
      : type === "season"
        ? seasons
        : type === "planned_session"
          ? plannedSessions
          : ROW_TABLES[type as RowType];

function stripRow<T extends Record<string, unknown>>(row: T, omit: string[]): Row {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) if (!omit.includes(k)) out[k] = v instanceof Date ? v.toISOString() : v;
  return out as Row;
}

// ── Snapshots ────────────────────────────────────────────────────────────────

export async function snapshotProgram(ex: Executor, programId: number): Promise<ProgramSnapshot> {
  const [program] = await ex.select().from(programs).where(eq(programs.id, programId));
  const slots = await ex
    .select({ pe: programExercises, exerciseName: exercises.name })
    .from(programExercises)
    .leftJoin(exercises, eq(exercises.id, programExercises.exerciseId))
    .where(and(eq(programExercises.programId, programId), isNull(programExercises.deletedAt)))
    .orderBy(asc(programExercises.orderIndex), asc(programExercises.id));
  const sets = slots.length
    ? await ex
        .select()
        .from(programSets)
        .where(
          and(
            inArray(
              programSets.programExerciseId,
              slots.map((s) => s.pe.id),
            ),
            isNull(programSets.deletedAt),
          ),
        )
        .orderBy(asc(programSets.setNumber), asc(programSets.id))
    : [];
  return {
    v: 1,
    program: stripRow(program, ["version", "deletedAt"]),
    exercises: slots.map(({ pe, exerciseName }) => ({
      ...stripRow(pe, ["deletedAt"]),
      exerciseName,
      sets: sets.filter((s) => s.programExerciseId === pe.id).map((s) => stripRow(s, ["deletedAt"])),
    })) as ProgramSnapshot["exercises"],
  };
}

export async function snapshotCycle(ex: Executor, cycleId: number): Promise<CycleSnapshot> {
  const [cycle] = await ex.select().from(trainingCycles).where(eq(trainingCycles.id, cycleId));
  const slots = await ex
    .select({ slot: trainingCycleSlots, programName: programs.name })
    .from(trainingCycleSlots)
    .leftJoin(programs, eq(programs.id, trainingCycleSlots.programId))
    .where(eq(trainingCycleSlots.trainingCycleId, cycleId))
    .orderBy(asc(trainingCycleSlots.dayOfWeek), asc(trainingCycleSlots.orderIndex), asc(trainingCycleSlots.id));
  return {
    v: 1,
    // sessionsGeneratedAt belongs to the session layer, not to the template.
    cycle: stripRow(cycle, ["version", "deletedAt", "sessionsGeneratedAt"]),
    slots: slots.map(({ slot, programName }) => ({ ...stripRow(slot, []), programName })) as CycleSnapshot["slots"],
  };
}

export async function snapshotMemory(ex: Executor, memoryId: number): Promise<MemorySnapshot> {
  const [row] = await ex.select().from(coachMemory).where(eq(coachMemory.id, memoryId));
  return { v: 1, memory: stripRow(row, ["version", "updatedAt"]) };
}

/** A one-row object other than memory: `{ v: 1, athlete | threshold | injury | workout | illness: row }`. */
async function snapshotRow(ex: Executor, type: Exclude<RowType, "memory">, id: number): Promise<PlanSnapshot> {
  const table = ROW_TABLES[type];
  const [row] = await ex.select().from(table).where(eq(table.id, id));
  return { v: 1, [type]: stripRow(row, ["version", "updatedAt"]) } as PlanSnapshot;
}

export async function snapshotSeason(ex: Executor, seasonId: number): Promise<SeasonSnapshot> {
  const [row] = await ex.select().from(seasons).where(eq(seasons.id, seasonId));
  const races = await ex
    .select()
    .from(seasonRaces)
    .where(eq(seasonRaces.seasonId, seasonId))
    .orderBy(asc(seasonRaces.raceDate), asc(seasonRaces.id));
  const phases = await ex
    .select({ cycleId: trainingCycles.id, name: trainingCycles.name, phaseOrder: trainingCycles.phaseOrder, phaseType: trainingCycles.phaseType })
    .from(trainingCycles)
    .where(and(eq(trainingCycles.seasonId, seasonId), isNull(trainingCycles.deletedAt)))
    .orderBy(asc(trainingCycles.phaseOrder), asc(trainingCycles.id));
  return {
    v: 1,
    season: stripRow(row, ["version", "deletedAt", "updatedAt"]),
    races: races.map((r) => stripRow(r, [])),
    phases,
  };
}

/** One planned session (docs/plans/sessions.md, 7), with its program's name for the history. */
export async function snapshotPlannedSession(ex: Executor, id: number): Promise<PlannedSessionSnapshot> {
  const [row] = await ex
    .select({ row: plannedSessions, programName: programs.name })
    .from(plannedSessions)
    // plan-read: includes deleted (the history names a deleted program too)
    .leftJoin(programs, eq(programs.id, plannedSessions.programId))
    .where(eq(plannedSessions.id, id));
  return { v: 1, session: stripRow(row.row, ["version", "updatedAt"]), programName: row.programName ?? null };
}

const snapshotOf = (ex: Executor, t: PlanTarget): Promise<PlanSnapshot> =>
  t.type === "planned_session"
    ? snapshotPlannedSession(ex, t.id)
    : t.type === "program"
    ? snapshotProgram(ex, t.id)
    : t.type === "cycle"
      ? snapshotCycle(ex, t.id)
      : t.type === "season"
        ? snapshotSeason(ex, t.id)
        : t.type === "memory"
          ? snapshotMemory(ex, t.id)
          : snapshotRow(ex, t.type as Exclude<RowType, "memory">, t.id);

// ── The write session ────────────────────────────────────────────────────────

type Touched = {
  target: PlanTarget;
  version: number;
  before: PlanSnapshot;
  action: PlanRevisionAction;
  restoredFromId: number | null;
  force: boolean;
};

export type TouchOptions = {
  /** Refuse the write when the object is at another version (T9). */
  expectedVersion?: number;
  /** For a restore: the object may be soft deleted. */
  allowDeleted?: boolean;
  action?: "update" | "delete" | "restore";
  restoredFromId?: number;
  /** Store a revision (and bump the version) even when the snapshot does not change. */
  force?: boolean;
};

export class PlanWriteSession {
  private touched = new Map<string, Touched>();
  private created: PlanTarget[] = [];
  private changeSet: string | null = null;
  private regenerated = new Map<number, string>();
  /** Dated sessions each cycle's regeneration made, changed or removed in this write. */
  readonly regenerationCounts = new Map<number, number>();
  /** Template days each cycle's regeneration left out for the cap of three. */
  readonly regenerationCapped = new Map<number, string[]>();
  /** Seasons whose phases a restore moved: settled before the write ends (settleSeason). */
  readonly seasonsToSettle = new Set<number>();

  constructor(
    readonly tx: Tx,
    readonly ctx: PlanWriteContext,
  ) {}

  /** The change-set id for this write (2.8). */
  async changeSetId(): Promise<string> {
    if (this.changeSet) return this.changeSet;
    if (this.ctx.changeSetId) return (this.changeSet = this.ctx.changeSetId);
    if (this.ctx.writer === "assistant") {
      const [last] = await this.tx
        .select({ changeSetId: planRevisions.changeSetId, createdAt: planRevisions.createdAt })
        .from(planRevisions)
        .where(
          and(
            eq(planRevisions.userId, this.ctx.userId),
            eq(planRevisions.writer, "assistant"),
            this.ctx.clientId ? eq(planRevisions.clientId, this.ctx.clientId) : isNull(planRevisions.clientId),
          ),
        )
        .orderBy(desc(planRevisions.id))
        .limit(1);
      this.changeSet = changeSetFor(last ?? null, new Date(), () => `mcp:${randomUUID()}`);
    } else {
      this.changeSet = `${this.ctx.writer}:${randomUUID()}`;
    }
    return this.changeSet;
  }

  /**
   * Lock an object the write is about to change, check it is the caller's and
   * live, check its version, and record how it looked. Returns its version.
   * Lock cycles before programs when a write touches both.
   */
  async touch(target: PlanTarget, opts: TouchOptions = {}): Promise<number> {
    const k = key(target);
    const seen = this.touched.get(k);
    if (seen) {
      if (opts.action && opts.action !== "update") seen.action = opts.action;
      if (opts.restoredFromId) seen.restoredFromId = opts.restoredFromId;
      if (opts.force) seen.force = true;
      return seen.version;
    }
    const table = tableOf(target.type);
    const [row] = await this.tx
      .select({ userId: table.userId, version: table.version, deletedAt: table.deletedAt })
      .from(table)
      .where(eq(table.id, target.id))
      // Not FOR UPDATE: that also blocks the KEY SHARE lock a new
      // workout_sessions row takes on its program, so starting a workout
      // would wait for any plan write.
      .for("no key update");
    if (!row || row.userId !== this.ctx.userId || (row.deletedAt && !opts.allowDeleted)) {
      throw new PlanNotFoundError(target);
    }
    if (opts.expectedVersion !== undefined && opts.expectedVersion !== row.version) {
      throw new PlanConflictError(target, row.version, opts.expectedVersion);
    }
    const before = await snapshotOf(this.tx, target);
    const [hasRevision] = await this.tx
      .select({ id: planRevisions.id })
      .from(planRevisions)
      .where(
        and(
          eq(planRevisions.userId, this.ctx.userId),
          eq(planRevisions.objectType, target.type),
          eq(planRevisions.objectId, target.id),
        ),
      )
      .limit(1);
    if (!hasRevision) {
      // The object predates the revision layer (or is seed data): keep how it
      // looked before this first change, so it can be restored.
      await this.tx.insert(planRevisions).values({
        userId: this.ctx.userId,
        objectType: target.type,
        objectId: target.id,
        version: row.version,
        action: "baseline",
        writer: "user",
        snapshot: before,
      });
    }
    this.touched.set(k, {
      target,
      version: row.version,
      before,
      action: opts.action ?? "update",
      restoredFromId: opts.restoredFromId ?? null,
      force: opts.force ?? false,
    });
    return row.version;
  }

  /** Record a new object, written in this transaction. */
  create(target: PlanTarget) {
    this.created.push(target);
  }

  /**
   * Store a write that was not applied (a queued change that met a newer
   * plan), so the user can see it in the history. Returns the revision id.
   */
  async conflict(target: PlanTarget, rejected: Record<string, unknown>): Promise<number> {
    const t = this.touched.get(key(target));
    const version = t?.version ?? 1;
    const [rev] = await this.tx
      .insert(planRevisions)
      .values({
        userId: this.ctx.userId,
        objectType: target.type,
        objectId: target.id,
        version,
        action: "conflict",
        writer: this.ctx.writer,
        reason: this.ctx.reason ?? null,
        changeSetId: await this.changeSetId(),
        clientId: this.ctx.clientId ?? null,
        snapshot: t?.before ?? (await snapshotOf(this.tx, target)),
        rejected,
      })
      .returning({ id: planRevisions.id });
    return rev.id;
  }

  /**
   * Keep each cycle's dated sessions in line with its template: every cycle
   * this write created, or whose template it changed, is regenerated in the
   * same transaction (docs/plans/sessions.md, 3.4), so no writer can forget.
   */
  async regenerateSessions(): Promise<Map<number, number>> {
    const { regenerateCycleSessions, cycleTemplateKey } = await import("@/lib/planned-sessions");
    for (const t of this.touched.values()) {
      if (t.target.type !== "cycle" || t.action === "delete") continue;
      const before = t.before as CycleSnapshot;
      const after = await snapshotCycle(this.tx, t.target.id);
      const key = cycleTemplateKey(after);
      // Once per template state: the limits run it inside the write, and
      // finish runs it again only if the write changed the template since.
      if ((this.regenerated.get(t.target.id) ?? cycleTemplateKey(before)) === key) continue;
      const moved =
        (before.cycle.startDate !== after.cycle.startDate || before.cycle.scheduledStartDate !== after.cycle.scheduledStartDate) &&
        !this.regenerated.has(t.target.id);
      this.regenerated.set(t.target.id, key);
      const r = await regenerateCycleSessions(this.tx, this.ctx.userId, t.target.id, { includePast: moved });
      this.regenerationCounts.set(t.target.id, (this.regenerationCounts.get(t.target.id) ?? 0) + r.inserted + r.updated + r.removed);
      this.regenerationCapped.set(t.target.id, [...(this.regenerationCapped.get(t.target.id) ?? []), ...r.keptOutByCap]);
    }
    for (const target of this.created) {
      if (target.type !== "cycle" || this.regenerated.has(target.id)) continue;
      this.regenerated.set(target.id, cycleTemplateKey(await snapshotCycle(this.tx, target.id)));
      const r = await regenerateCycleSessions(this.tx, this.ctx.userId, target.id);
      this.regenerationCounts.set(target.id, r.inserted);
    }
    return this.regenerationCounts;
  }

  /** Store a revision for every object that changed, and bump versions. */
  async finish(): Promise<Map<string, number>> {
    await this.regenerateSessions();
    const versions = new Map<string, number>();
    for (const t of this.touched.values()) {
      const after = t.action === "delete" ? t.before : await snapshotOf(this.tx, t.target);
      if (t.action === "update" && !t.force && sameSnapshot(after, t.before)) {
        versions.set(key(t.target), t.version);
        continue;
      }
      const version = bumps(this.ctx.writer, t.action) ? t.version + 1 : t.version;
      if (version !== t.version) {
        const table = tableOf(t.target.type);
        await this.tx.update(table).set({ version }).where(eq(table.id, t.target.id));
      }
      await this.insertRevision(t.target, version, t.action, after, t.restoredFromId);
      versions.set(key(t.target), version);
    }
    for (const target of this.created) {
      if (this.touched.has(key(target))) continue;
      const after = await snapshotOf(this.tx, target);
      await this.insertRevision(target, 1, "create", after, null);
      versions.set(key(target), 1);
    }
    return versions;
  }

  private async insertRevision(
    target: PlanTarget,
    version: number,
    action: PlanRevisionAction,
    snapshot: PlanSnapshot,
    restoredFromId: number | null,
  ) {
    await this.tx.insert(planRevisions).values({
      userId: this.ctx.userId,
      objectType: target.type,
      objectId: target.id,
      version,
      action,
      writer: this.ctx.writer,
      reason: this.ctx.reason ?? null,
      changeSetId: await this.changeSetId(),
      clientId: this.ctx.clientId ?? null,
      restoredFromId,
      snapshot,
      limitCheck: this.ctx.limitCheck ?? null,
    });
  }
}

/**
 * Run a plan write in one transaction and store its revisions. Throws
 * PlanConflictError or PlanNotFoundError from `touch`, with nothing applied.
 */
export async function planWrite<T>(
  ctx: PlanWriteContext,
  fn: (w: PlanWriteSession) => Promise<T>,
): Promise<{ result: T; versions: Map<string, number> }> {
  return db.transaction(async (tx) => {
    const w = new PlanWriteSession(tx, ctx);
    const result = await fn(w);
    const versions = await w.finish();
    return { result, versions };
  });
}

export const versionKey = key;

// ── Lookups that writers share ───────────────────────────────────────────────

/** The live, owned program a live slot belongs to, or null. */
export async function slotProgram(ex: Executor, programExerciseId: number, userId: string) {
  const [row] = await ex
    .select({ programId: programs.id, userId: programs.userId })
    .from(programExercises)
    .innerJoin(programs, eq(programs.id, programExercises.programId))
    .where(
      and(eq(programExercises.id, programExerciseId), isNull(programExercises.deletedAt), isNull(programs.deletedAt)),
    )
    .limit(1);
  return row && row.userId === userId ? row.programId : null;
}

/** The live, owned program and slot a live set belongs to, or null. */
export async function setProgram(ex: Executor, programSetId: number, userId: string) {
  const [row] = await ex
    .select({ programId: programs.id, programExerciseId: programExercises.id, userId: programs.userId })
    .from(programSets)
    .innerJoin(programExercises, eq(programExercises.id, programSets.programExerciseId))
    .innerJoin(programs, eq(programs.id, programExercises.programId))
    .where(
      and(
        eq(programSets.id, programSetId),
        isNull(programSets.deletedAt),
        isNull(programExercises.deletedAt),
        isNull(programs.deletedAt),
      ),
    )
    .limit(1);
  return row && row.userId === userId ? { programId: row.programId, programExerciseId: row.programExerciseId } : null;
}

/** Whether the user has a workout in progress on any of these programs. */
export async function openWorkoutOn(ex: Executor, userId: string, programIds: number[]): Promise<boolean> {
  if (programIds.length === 0) return false;
  const [row] = await ex
    .select({ id: workoutSessions.id })
    .from(workoutSessions)
    .where(
      and(
        eq(workoutSessions.userId, userId),
        eq(workoutSessions.isCompleted, false),
        inArray(workoutSessions.programId, programIds),
      ),
    )
    .limit(1);
  return !!row;
}

// ── Soft delete (2.3) ────────────────────────────────────────────────────────

/** Soft delete a program with its slots and sets. The caller has touched it with action "delete". */
export async function softDeleteProgram(tx: Tx, programId: number, at = new Date()) {
  const slots = await tx
    .select({ id: programExercises.id })
    .from(programExercises)
    .where(and(eq(programExercises.programId, programId), isNull(programExercises.deletedAt)));
  if (slots.length) {
    await tx
      .update(programSets)
      .set({ deletedAt: at })
      .where(
        and(
          inArray(
            programSets.programExerciseId,
            slots.map((s) => s.id),
          ),
          isNull(programSets.deletedAt),
        ),
      );
    await tx.update(programExercises).set({ deletedAt: at }).where(inArray(programExercises.id, slots.map((s) => s.id)));
  }
  await tx.update(programs).set({ deletedAt: at }).where(eq(programs.id, programId));
}

/** Soft delete one slot and its sets. */
export async function softDeleteSlot(tx: Tx, programExerciseId: number, at = new Date()) {
  await tx
    .update(programSets)
    .set({ deletedAt: at })
    .where(and(eq(programSets.programExerciseId, programExerciseId), isNull(programSets.deletedAt)));
  await tx.update(programExercises).set({ deletedAt: at }).where(eq(programExercises.id, programExerciseId));
}

/**
 * Delete programs for the user, refusing when a workout in progress uses one.
 * Each is its own revision in one change set.
 */
export async function deletePrograms(ctx: PlanWriteContext, programIds: number[], expectedVersion?: number) {
  return planWrite(ctx, async (w) => {
    if (await openWorkoutOn(w.tx, ctx.userId, programIds)) throw new OpenWorkoutError();
    const at = new Date();
    for (const id of [...programIds].sort((a, b) => a - b)) {
      await w.touch({ type: "program", id }, { action: "delete", expectedVersion });
      await softDeleteProgram(w.tx, id, at);
    }
  });
}

/**
 * Delete cycles for the user, with the programs each one generated, in one
 * change set, so one restore brings them back together.
 */
export async function deleteCycles(ctx: PlanWriteContext, cycleIds: number[], expectedVersion?: number) {
  return planWrite(ctx, async (w) => {
    const at = new Date();
    const generated: number[] = [];
    for (const id of [...cycleIds].sort((a, b) => a - b)) {
      await w.touch({ type: "cycle", id }, { action: "delete", expectedVersion });
      const owned = await w.tx
        .select({ id: programs.id })
        .from(programs)
        .where(and(eq(programs.createdByCycleId, id), isNull(programs.deletedAt)));
      generated.push(...owned.map((p) => p.id));
    }
    if (await openWorkoutOn(w.tx, ctx.userId, generated)) throw new OpenWorkoutError();
    for (const id of generated.sort((a, b) => a - b)) {
      await w.touch({ type: "program", id }, { action: "delete" });
      await softDeleteProgram(w.tx, id, at);
    }
    for (const id of cycleIds) await w.tx.update(trainingCycles).set({ deletedAt: at }).where(eq(trainingCycles.id, id));
  });
}

/**
 * Make one cycle the active one: every other active cycle of the user is
 * completed first, in the same transaction, each with its own revision.
 */
export async function activateCycle(
  ctx: PlanWriteContext,
  cycleId: number,
  expectedVersion?: number,
  /** The block's first day; today when omitted. */
  startDate?: string,
) {
  return (await activateCycleIf(ctx, cycleId, expectedVersion, startDate))!;
}

/** activateCycle, or nothing (null) when `onlyIfScheduledFor` no longer holds under the lock. */
async function activateCycleIf(
  ctx: PlanWriteContext,
  cycleId: number,
  expectedVersion?: number,
  startDate?: string,
  /** A scheduled start: go ahead only if the cycle is still a draft scheduled for this day. */
  onlyIfScheduledFor?: string,
) {
  const { toDateStr } = await import("@/lib/utils/cycle-position");
  const { userToday } = await import("@/lib/user-settings");
  const today = startDate ?? toDateStr(await userToday(ctx.userId));
  const { result } = await planWrite(ctx, (w) => activateInSession(w, cycleId, today, expectedVersion, onlyIfScheduledFor));
  return result;
}

/** The body of activateCycle, inside a write that is already open. */
export async function activateInSession(
  w: PlanWriteSession,
  cycleId: number,
  today: string,
  expectedVersion?: number,
  onlyIfScheduledFor?: string,
) {
  const ctx = w.ctx;
  {
    // Every other active cycle completes, and any other scheduled start is
    // dropped: once the user picks a block, no older plan starts by itself.
    const active = await w.tx
      .select({ id: trainingCycles.id, status: trainingCycles.status })
      .from(trainingCycles)
      .where(
        and(
          eq(trainingCycles.userId, ctx.userId),
          or(eq(trainingCycles.status, "active"), isNotNull(trainingCycles.scheduledStartDate)),
          isNull(trainingCycles.deletedAt),
        ),
      );
    const ids = [...new Set([...active.map((c) => c.id), cycleId])].sort((a, b) => a - b);
    // A phase of a season: the chain touches other phases after this, so lock
    // every phase with the rest in id order first (lockSeasonsThenCycles).
    const [target] = await w.tx.select({ seasonId: trainingCycles.seasonId }).from(trainingCycles).where(eq(trainingCycles.id, cycleId));
    const phaseIds = target?.seasonId != null ? (await seasonPhases(w.tx, target.seasonId)).map((p) => p.id) : [];
    await lockCycleRows(w.tx, [...ids, ...phaseIds]);
    for (const id of ids) await w.touch({ type: "cycle", id }, id === cycleId ? { expectedVersion } : {});
    if (onlyIfScheduledFor) {
      // Re-read under the lock: a racing read may have started it already.
      const [row] = await w.tx
        .select({ status: trainingCycles.status, day: trainingCycles.scheduledStartDate })
        .from(trainingCycles)
        .where(eq(trainingCycles.id, cycleId));
      if (row?.status !== "draft" || row.day !== onlyIfScheduledFor) return null;
    }
    const others = active.filter((c) => c.id !== cycleId && c.status === "active").map((c) => c.id);
    if (others.length) {
      await w.tx.update(trainingCycles).set({ status: "completed" }).where(inArray(trainingCycles.id, others));
    }
    const scheduled = active.filter((c) => c.id !== cycleId).map((c) => c.id);
    if (scheduled.length) {
      await w.tx.update(trainingCycles).set({ scheduledStartDate: null }).where(inArray(trainingCycles.id, scheduled));
    }
    const [cycle] = await w.tx
      .update(trainingCycles)
      .set({ status: "active", startDate: today, scheduledStartDate: null })
      .where(eq(trainingCycles.id, cycleId))
      .returning();
    // A phase of a season: the next phase is scheduled for the day after this
    // one ends (docs/plans/seasons.md, 2.4; owner decision 1).
    if (cycle.seasonId) await chainSeason(w, cycle.seasonId);
    return cycle;
  }
}

/**
 * Schedule a draft cycle to start on a later day (docs/plans/ai-coach.md,
 * owner decision 7). It stays a draft until then; only one cycle is
 * scheduled at a time, so scheduling one clears any other.
 */
export async function scheduleCycle(ctx: PlanWriteContext, cycleId: number, day: string | null, expectedVersion?: number) {
  return planWrite(ctx, async (w) => {
    const others = day
      ? await w.tx
          .select({ id: trainingCycles.id })
          .from(trainingCycles)
          .where(
            and(
              eq(trainingCycles.userId, ctx.userId),
              isNotNull(trainingCycles.scheduledStartDate),
              isNull(trainingCycles.deletedAt),
              ne(trainingCycles.id, cycleId),
            ),
          )
      : [];
    const ids = [...new Set([...others.map((c) => c.id), cycleId])].sort((a, b) => a - b);
    for (const id of ids) await w.touch({ type: "cycle", id }, id === cycleId ? { expectedVersion } : {});
    if (others.length) {
      await w.tx
        .update(trainingCycles)
        .set({ scheduledStartDate: null })
        .where(inArray(trainingCycles.id, others.map((c) => c.id)));
    }
    const [row] = await w.tx
      .select({ status: trainingCycles.status })
      .from(trainingCycles)
      .where(eq(trainingCycles.id, cycleId));
    if (day && row.status !== "draft") {
      throw new PlanStateError(
        row.status === "active" ? "This cycle is already active." : "Only a draft cycle can be scheduled to start. Create a new cycle for another block.",
      );
    }
    await w.tx.update(trainingCycles).set({ scheduledStartDate: day }).where(eq(trainingCycles.id, cycleId));
  });
}

/** A season's live phases, as the timeline reads them. */
export async function seasonPhases(ex: Executor, seasonId: number): Promise<(PhaseLike & { version: number })[]> {
  return ex
    .select({
      id: trainingCycles.id,
      name: trainingCycles.name,
      phaseOrder: trainingCycles.phaseOrder,
      phaseType: trainingCycles.phaseType,
      durationWeeks: trainingCycles.durationWeeks,
      durationDays: trainingCycles.durationDays,
      status: trainingCycles.status,
      startDate: trainingCycles.startDate,
      scheduledStartDate: trainingCycles.scheduledStartDate,
      version: trainingCycles.version,
    })
    .from(trainingCycles)
    .where(and(eq(trainingCycles.seasonId, seasonId), isNull(trainingCycles.deletedAt)))
    .orderBy(asc(trainingCycles.phaseOrder), asc(trainingCycles.id));
}

/**
 * Keep a season's next phase scheduled (docs/plans/seasons.md, 2.4; owner
 * decision 1). With a phase of the season active, the next one is scheduled
 * for the day after it ends; with none started and the season still ahead,
 * the first is scheduled for the season start. Leaves the chain paused (does
 * nothing) when a cycle outside the season is active or scheduled: the user
 * chose that block, and "Resume" on the season picks the chain up again.
 * Writer: the caller's; the chained start itself runs as `sync`.
 */
export async function chainSeason(w: PlanWriteSession, seasonId: number) {
  const { userToday } = await import("@/lib/user-settings");
  const { toDateStr } = await import("@/lib/utils/cycle-position");
  const { addDaysStr } = await import("@/lib/utils/seasons");
  const today = toDateStr(await userToday(w.ctx.userId));
  const [season] = await w.tx
    .select({ startDate: seasons.startDate, deletedAt: seasons.deletedAt })
    .from(seasons)
    .where(eq(seasons.id, seasonId));
  if (!season || season.deletedAt) return;
  const phases = await seasonPhases(w.tx, seasonId);
  const timeline = seasonTimeline(season.startDate, phases);
  const next = nextPhase(timeline);
  if (!next) return;
  const outside = await w.tx
    .select({ id: trainingCycles.id })
    .from(trainingCycles)
    .where(
      and(
        eq(trainingCycles.userId, w.ctx.userId),
        isNull(trainingCycles.deletedAt),
        or(eq(trainingCycles.status, "active"), isNotNull(trainingCycles.scheduledStartDate)),
        or(isNull(trainingCycles.seasonId), ne(trainingCycles.seasonId, seasonId)),
      ),
    )
    .limit(1);
  if (outside.length) return;
  const active = timeline.find((p) => p.state === "active");
  const anyStarted = timeline.some((p) => p.state !== "planned");
  const day = active ? addDaysStr(active.end, 1) : !anyStarted && season.startDate > today ? season.startDate : null;
  if (!day) return;
  const others = phases.filter((p) => p.id !== next.id && p.scheduledStartDate != null);
  for (const p of others) {
    await w.touch({ type: "cycle", id: p.id });
    await w.tx.update(trainingCycles).set({ scheduledStartDate: null }).where(eq(trainingCycles.id, p.id));
  }
  if (next.scheduledStartDate === day) return;
  await w.touch({ type: "cycle", id: next.id });
  await w.tx.update(trainingCycles).set({ scheduledStartDate: day }).where(eq(trainingCycles.id, next.id));
}

/** The season id when that season exists and is not deleted, else null: a phase of a deleted season acts as a cycle with no season. */
export async function liveSeasonId(ex: Executor, seasonId: number | null | undefined): Promise<number | null> {
  if (seasonId == null) return null;
  const [row] = await ex
    .select({ id: seasons.id })
    .from(seasons)
    .where(and(eq(seasons.id, seasonId), isNull(seasons.deletedAt)));
  return row?.id ?? null;
}

/**
 * The lock order for writes that touch seasons and cycles: seasons first, in
 * id order, then every cycle row (the ones named and each phase of those
 * seasons) in id order. Later touches only take locks already held, so a
 * restore and a season write on the same season cannot wait on each other.
 */
export async function lockSeasonsThenCycles(w: PlanWriteSession, seasonIds: (number | null | undefined)[], cycleIds: number[] = []) {
  const named = [...new Set(seasonIds.filter((s): s is number => s != null))];
  // Seasons that still exist (a purged one has no row to lock), deleted ones
  // too: a restore of a deleted season locks it here, before its phases.
  const ids = named.length
    ? (await w.tx.select({ id: seasons.id }).from(seasons).where(inArray(seasons.id, named))).map((s) => s.id).sort((a, b) => a - b)
    : [];
  for (const s of ids) await w.touch({ type: "season", id: s }, { allowDeleted: true });
  const phases = ids.length
    ? await w.tx
        .select({ id: trainingCycles.id })
        .from(trainingCycles)
        .where(and(inArray(trainingCycles.seasonId, ids), isNull(trainingCycles.deletedAt)))
    : [];
  await lockCycleRows(w.tx, [...cycleIds, ...phases.map((p) => p.id)]);
}

/** Lock cycle rows in id order (the same lock `touch` takes). */
export async function lockCycleRows(tx: Tx, cycleIds: number[]) {
  const all = [...new Set(cycleIds)].sort((a, b) => a - b);
  if (all.length === 0) return;
  await tx
    .select({ id: trainingCycles.id })
    .from(trainingCycles)
    .where(inArray(trainingCycles.id, all))
    .orderBy(asc(trainingCycles.id))
    .for("no key update");
}

/**
 * A season is being deleted (docs/plans/seasons.md, owner decision 3): its
 * cycles act as cycles with no season, so each phase gets the season's A race
 * back as its own race (D8: the cycle is now its home), and the start the
 * chain scheduled for the next phase is dropped. The season id stays on the
 * cycles, so a restore of the season takes them back (claimSeasonPhases).
 */
export async function releaseSeasonPhases(w: PlanWriteSession, seasonId: number) {
  const { userToday } = await import("@/lib/user-settings");
  const { toDateStr } = await import("@/lib/utils/cycle-position");
  const { seasonARace } = await import("@/lib/utils/seasons");
  const races = await w.tx.select().from(seasonRaces).where(eq(seasonRaces.seasonId, seasonId));
  const a = seasonARace(races, toDateStr(await userToday(w.ctx.userId)));
  const raceDistance = a?.discipline === "triathlon" && (a.distance === "full" || a.distance === "half") ? a.distance : null;
  const released = await seasonPhases(w.tx, seasonId);
  await lockCycleRows(w.tx, released.map((p) => p.id));
  for (const p of released) {
    await w.touch({ type: "cycle", id: p.id });
    await w.tx
      .update(trainingCycles)
      .set({
        raceDate: a?.raceDate ?? null,
        raceDistance: a ? raceDistance : null,
        ...(p.status === "draft" ? { scheduledStartDate: null } : {}),
      })
      .where(eq(trainingCycles.id, p.id));
  }
}

/** A deleted season comes back: its phases store no race of their own again (D8). */
export async function claimSeasonPhases(w: PlanWriteSession, seasonId: number) {
  const { userToday } = await import("@/lib/user-settings");
  const { toDateStr } = await import("@/lib/utils/cycle-position");
  const { seasonARace } = await import("@/lib/utils/seasons");
  const today = toDateStr(await userToday(w.ctx.userId));
  const reasons: string[] = [];
  const claimed = await seasonPhases(w.tx, seasonId);
  await lockCycleRows(w.tx, claimed.map((p) => p.id));
  for (const p of claimed) {
    await w.touch({ type: "cycle", id: p.id });
    const [own] = await w.tx
      .select({ raceDate: trainingCycles.raceDate, raceDistance: trainingCycles.raceDistance })
      .from(trainingCycles)
      .where(eq(trainingCycles.id, p.id));
    // A race the user set or moved on the cycle while the season was deleted
    // goes back to the season, which holds the race again (D8), and the
    // season is flagged for a re-plan (D17), never dropped.
    if (own?.raceDate) {
      const races = await w.tx.select().from(seasonRaces).where(eq(seasonRaces.seasonId, seasonId));
      const a = seasonARace(races, today);
      const sameDistance = (a?.discipline === "triathlon" ? a.distance : null) === own.raceDistance || own.raceDistance == null;
      if (!a) {
        await w.tx.insert(seasonRaces).values({
          seasonId,
          userId: w.ctx.userId,
          name: "Race",
          raceDate: own.raceDate,
          discipline: "triathlon",
          distance: own.raceDistance,
          priority: "A",
        });
        reasons.push(`A race on ${own.raceDate} added from "${p.name}"`);
      } else if (a.raceDate !== own.raceDate || !sameDistance) {
        await w.tx
          .update(seasonRaces)
          .set({ raceDate: own.raceDate, ...(own.raceDistance ? { discipline: "triathlon" as const, distance: own.raceDistance, distanceMeters: null } : {}) })
          .where(eq(seasonRaces.id, a.id));
        reasons.push(`A race "${a.name}" moved from ${a.raceDate} to ${own.raceDate} on "${p.name}" while the season was deleted`);
      }
    }
    await w.tx.update(trainingCycles).set({ raceDate: null, raceDistance: null }).where(eq(trainingCycles.id, p.id));
  }
  if (reasons.length) {
    await w.tx
      .update(seasons)
      .set({ replanFlaggedAt: new Date(), replanReason: reasons.join("; ") })
      .where(eq(seasons.id, seasonId));
  }
}

/**
 * After a restore moved phases in or out of a season, or changed their
 * length: the season gets a revision for its phase list, positions are made
 * dense again, the phase cap is checked, and the chain is scheduled again.
 */
export async function settleSeason(w: PlanWriteSession, seasonId: number) {
  if ((await liveSeasonId(w.tx, seasonId)) == null) return;
  const { SEASON_MAX_PHASES } = await import("@/lib/utils/seasons");
  await w.touch({ type: "season", id: seasonId });
  const phases = await seasonPhases(w.tx, seasonId);
  await lockCycleRows(w.tx, phases.map((p) => p.id));
  // A data cap, not a training limit: it holds for every writer.
  if (phases.length > SEASON_MAX_PHASES) {
    throw new PlanStateError(
      `This restore would put ${phases.length} phases in the season, and a season holds at most ${SEASON_MAX_PHASES}. Remove a phase from the season first, then restore again.`,
    );
  }
  for (const [i, p] of phases.entries()) {
    if (p.phaseOrder === i + 1) continue;
    await w.touch({ type: "cycle", id: p.id });
    await w.tx.update(trainingCycles).set({ phaseOrder: i + 1 }).where(eq(trainingCycles.id, p.id));
  }
  await chainSeason(w, seasonId);
}

/**
 * Start the user's scheduled cycle once its day has come: it becomes active
 * with that day as its start, and any other active cycle completes. Called
 * where the app reads the active cycle. One indexed read when nothing is due.
 */
async function startOneDueCycle(userId: string): Promise<boolean> {
  const { toDateStr } = await import("@/lib/utils/cycle-position");
  const { userToday } = await import("@/lib/user-settings");
  const today = toDateStr(await userToday(userId));
  const [due] = await db
    .select({ id: trainingCycles.id, day: trainingCycles.scheduledStartDate })
    .from(trainingCycles)
    .where(
      and(
        eq(trainingCycles.userId, userId),
        eq(trainingCycles.status, "draft"),
        isNull(trainingCycles.deletedAt),
        isNotNull(trainingCycles.scheduledStartDate),
        lte(trainingCycles.scheduledStartDate, today),
      ),
    )
    .orderBy(desc(trainingCycles.scheduledStartDate))
    .limit(1);
  if (!due?.day) return false;
  const started = await activateCycleIf({ userId, writer: "sync", reason: "Scheduled start" }, due.id, undefined, due.day, due.day);
  return started != null;
}

/** Most chained phases a read starts at once after a long absence. */
const CATCH_UP_MAX = 60;

/**
 * Start every scheduled cycle that is due, in order: after a long absence a
 * chained season may have several phases due, and starting only the first
 * would leave the home screen with an active block that is already over.
 */
export async function startDueScheduledCycle(userId: string): Promise<boolean> {
  let any = false;
  for (let i = 0; i < CATCH_UP_MAX && (await startOneDueCycle(userId)); i++) any = true;
  return any;
}

// ── Queued and flushed set writes (2.7) ──────────────────────────────────────

export type FlushedSetWrite = { programSetId: number; fields: Record<string, unknown> };
export type FlushResult = { applied: number[]; skipped: number[]; conflicts: number; revisionId: number | null };

/**
 * Write the workout's set overrides back to the plan in one go, against the
 * program version the workout started on (docs/plans/revisions.md, 2.7).
 *
 * Per set: applied when nobody but the lifter (and the engine) changed it
 * since; skipped when the lifter removed it; refused, as one conflict
 * revision for the whole flush, when an assistant changed one of its fields
 * since or removed it. A set of another program is ignored.
 */
export async function flushSetWrites(
  w: PlanWriteSession,
  programId: number,
  baseVersion: number,
  writes: FlushedSetWrite[],
): Promise<FlushResult> {
  const version = await w.touch({ type: "program", id: programId });
  const result: FlushResult = { applied: [], skipped: [], conflicts: 0, revisionId: null };
  if (writes.length === 0) return result;
  const rows = await w.tx
    // plan-read: includes deleted (a write to a removed set is skipped or refused, not lost)
    .select({ set: programSets })
    .from(programSets)
    .innerJoin(programExercises, eq(programExercises.id, programSets.programExerciseId))
    .where(
      and(
        eq(programExercises.programId, programId),
        inArray(
          programSets.id,
          writes.map((x) => x.programSetId),
        ),
      ),
    );
  const byId = new Map(rows.map((r) => [r.set.id, r.set]));

  let base: ProgramSnapshot | undefined;
  let history: { writer: PlanWriter; snapshot: ProgramSnapshot }[] = [];
  if (version !== baseVersion || rows.some((r) => r.set.deletedAt)) {
    const [baseRev] = await w.tx
      .select({ id: planRevisions.id, snapshot: planRevisions.snapshot })
      .from(planRevisions)
      .where(
        and(
          eq(planRevisions.userId, w.ctx.userId),
          eq(planRevisions.objectType, "program"),
          eq(planRevisions.objectId, programId),
          eq(planRevisions.version, baseVersion),
          ne(planRevisions.action, "conflict"),
        ),
      )
      .orderBy(desc(planRevisions.id))
      .limit(1);
    if (baseRev) {
      base = baseRev.snapshot as ProgramSnapshot;
      history = (await revisionsAfter(w.tx, w.ctx.userId, { type: "program", id: programId }, baseRev.id)).map((h) => ({
        writer: h.writer,
        snapshot: h.snapshot as ProgramSnapshot,
      }));
    }
  }

  const rejected: { programSetId: number; fields: Record<string, unknown>; conflicting: string[]; setDeleted: boolean }[] = [];
  for (const write of writes) {
    const current = byId.get(write.programSetId);
    if (!current) continue;
    const fields = Object.keys(write.fields).filter((f) => write.fields[f] !== undefined);
    const removed = current.deletedAt != null;
    if (!removed && version === baseVersion) {
      result.applied.push(current.id);
      continue;
    }
    if (!base) {
      // No record of the base (data written outside the layer): every field
      // not already at the new value counts as changed.
      const conflicting = removed ? fields : queuedWriteConflicts(undefined, current as unknown as Row, write.fields);
      if (conflicting.length === 0) result.applied.push(current.id);
      else rejected.push({ programSetId: current.id, fields: write.fields, conflicting, setDeleted: removed });
      continue;
    }
    const { lastWriter, removedBy } = setChangesSince(base, history, current.id, fields);
    if (removed) {
      if (removedBy !== null && !OTHER_WRITERS.has(removedBy)) result.skipped.push(current.id);
      else rejected.push({ programSetId: current.id, fields: write.fields, conflicting: fields, setDeleted: true });
      continue;
    }
    const currentRow = current as unknown as Row;
    const conflicting = fields.filter(
      (f) => lastWriter[f] !== undefined && OTHER_WRITERS.has(lastWriter[f]) && !sameValue(currentRow[f], write.fields[f]),
    );
    if (conflicting.length === 0) result.applied.push(current.id);
    else rejected.push({ programSetId: current.id, fields: write.fields, conflicting, setDeleted: false });
  }

  for (const id of result.applied) {
    const fields = writes.find((x) => x.programSetId === id)!.fields;
    const values: Record<string, unknown> = {};
    for (const [f, v] of Object.entries(fields)) {
      if (v === undefined) continue;
      values[f] = f === "weightKg" && v != null ? Number(v).toFixed(2) : v;
    }
    if (Object.keys(values).length) await w.tx.update(programSets).set(values).where(eq(programSets.id, id));
  }

  if (rejected.length > 0) {
    result.conflicts = rejected.length;
    // The queue may send the same flush twice (a reply lost to a navigation,
    // a retry after it). The second is the same conflict, not a new one.
    const keyOf = (sets: { programSetId: number; fields: unknown }[], bv: unknown) =>
      canonical({ baseVersion: bv, sets: sets.map((y) => ({ programSetId: y.programSetId, fields: y.fields })) });
    const key = keyOf(rejected, baseVersion);
    const earlier = await w.tx
      .select({ id: planRevisions.id, rejected: planRevisions.rejected })
      .from(planRevisions)
      .where(
        and(
          eq(planRevisions.userId, w.ctx.userId),
          eq(planRevisions.objectType, "program"),
          eq(planRevisions.objectId, programId),
          eq(planRevisions.action, "conflict"),
          // Not by version: a resend whose other sets applied the first time
          // bumped the version since. The key is the base and the writes.
        ),
      )
      .orderBy(desc(planRevisions.id))
      .limit(20);
    const same = earlier.find((r) => {
      const x = r.rejected as { baseVersion?: number; sets?: { programSetId: number; fields: unknown }[] } | null;
      return x?.sets && keyOf(x.sets, x.baseVersion) === key;
    });
    result.revisionId = same
      ? same.id
      : await w.conflict({ type: "program", id: programId }, { baseVersion, sets: rejected });
    console.info("[plan-conflict] flushed set writes not applied", { programId, baseVersion, version, sets: rejected.length });
  }
  return result;
}

// ── Restore (2.6) ────────────────────────────────────────────────────────────

type RestoreOutcome = { objectType: PlanObjectType; objectId: number; skipped: string[] };

async function revisionsAfter(tx: Tx, userId: string, target: PlanTarget, afterId: number) {
  return tx
    .select({ writer: planRevisions.writer, snapshot: planRevisions.snapshot, action: planRevisions.action })
    .from(planRevisions)
    .where(
      and(
        eq(planRevisions.userId, userId),
        eq(planRevisions.objectType, target.type),
        eq(planRevisions.objectId, target.id),
        gt(planRevisions.id, afterId),
        ne(planRevisions.action, "conflict"),
      ),
    )
    .orderBy(asc(planRevisions.id));
}

async function restoreProgramTo(
  w: PlanWriteSession,
  programId: number,
  targetSnap: ProgramSnapshot,
  targetRevisionId: number,
): Promise<string[]> {
  if (await openWorkoutOn(w.tx, w.ctx.userId, [programId])) throw new OpenWorkoutError();
  await w.touch({ type: "program", id: programId }, { allowDeleted: true, action: "restore", restoredFromId: targetRevisionId });
  const tx = w.tx;
  const skipped: string[] = [];
  const now = new Date();
  const history = (await revisionsAfter(tx, w.ctx.userId, { type: "program", id: programId }, targetRevisionId))
    .filter((h) => h.action !== "delete")
    .map((h) => ({ writer: h.writer, snapshot: h.snapshot as ProgramSnapshot }));

  const programValues: Record<string, unknown> = { ...targetSnap.program };
  for (const k of PROGRAM_KEPT) delete programValues[k];
  await tx
    .update(programs)
    .set({ ...(programValues as Partial<typeof programs.$inferInsert>), deletedAt: null })
    .where(eq(programs.id, programId));

  const currentSlots = await tx.select().from(programExercises).where(eq(programExercises.programId, programId));
  const slotById = new Map(currentSlots.map((s) => [s.id, s]));
  const currentSets = currentSlots.length
    ? await tx
        .select()
        .from(programSets)
        .where(
          inArray(
            programSets.programExerciseId,
            currentSlots.map((s) => s.id),
          ),
        )
    : [];
  const setById = new Map(currentSets.map((s) => [s.id, s]));
  const keptSlotIds = new Set<number>();
  const keptSetIds = new Set<number>();
  const existingExercises = new Set(
    (
      await tx
        .select({ id: exercises.id })
        .from(exercises)
        .where(
          and(
            inArray(exercises.id, targetSnap.exercises.map((e) => Number(e.exerciseId)).concat(-1)),
            // A slot may only point at a built-in exercise or one of the
            // user's own, the rule the MCP add path enforces.
            or(isNull(exercises.userId), eq(exercises.userId, w.ctx.userId)),
          ),
        )
    ).map((e) => e.id),
  );

  for (const e of targetSnap.exercises) {
    if (!existingExercises.has(Number(e.exerciseId))) {
      skipped.push(`${e.exerciseName ?? "An exercise"} is no longer available`);
      continue;
    }
    const { sets, exerciseName: _name, ...slotRow } = e;
    void _name;
    const values: Record<string, unknown> = { ...slotRow };
    for (const k of EXERCISE_KEPT) delete values[k];
    const current = slotById.get(e.id);
    if (current) {
      if (judgingRuleChanged(current, values as Parameters<typeof judgingRuleChanged>[1])) {
        values.progressionConfigAt = now;
      }
      await tx
        .update(programExercises)
        .set({ ...(values as Partial<typeof programExercises.$inferInsert>), deletedAt: null })
        .where(eq(programExercises.id, e.id));
    } else {
      await tx.insert(programExercises).values({
        ...(values as typeof programExercises.$inferInsert),
        id: e.id,
        programId,
        progressionConfigAt: (slotRow.progressionConfigAt as string | null) ? new Date(slotRow.progressionConfigAt as string) : null,
      });
    }
    keptSlotIds.add(e.id);
    for (const s of sets) {
      const currentSet = setById.get(s.id);
      const restored = restoredSetValues(s, currentSet as unknown as Row | undefined, targetSnap, history);
      delete restored.programExerciseId;
      if (currentSet) {
        await tx
          .update(programSets)
          .set({ ...(restored as Partial<typeof programSets.$inferInsert>), programExerciseId: e.id, deletedAt: null })
          .where(eq(programSets.id, s.id));
      } else {
        await tx
          .insert(programSets)
          .values({ ...(restored as typeof programSets.$inferInsert), id: s.id, programExerciseId: e.id });
      }
      keptSetIds.add(s.id);
    }
  }
  // Anything live now that the target did not have goes (softly).
  for (const s of currentSets) {
    if (!keptSetIds.has(s.id) && s.deletedAt == null) {
      await tx.update(programSets).set({ deletedAt: now }).where(eq(programSets.id, s.id));
    }
  }
  for (const s of currentSlots) {
    if (!keptSlotIds.has(s.id) && s.deletedAt == null) await softDeleteSlot(tx, s.id, now);
  }
  return skipped;
}

async function restoreCycleTo(
  w: PlanWriteSession,
  cycleId: number,
  targetSnap: CycleSnapshot,
  targetRevisionId: number,
): Promise<string[]> {
  const tx = w.tx;
  const [current] = await tx.select().from(trainingCycles).where(eq(trainingCycles.id, cycleId));
  const wasDeleted = current?.deletedAt != null;
  await w.touch({ type: "cycle", id: cycleId }, { allowDeleted: true, action: "restore", restoredFromId: targetRevisionId });
  const skipped: string[] = [];
  const values: Record<string, unknown> = { ...targetSnap.cycle };
  for (const k of CYCLE_KEPT) delete values[k];
  if (wasDeleted && current.status === "active") {
    const [otherActive] = await tx
      .select({ id: trainingCycles.id })
      .from(trainingCycles)
      .where(
        and(
          eq(trainingCycles.userId, w.ctx.userId),
          eq(trainingCycles.status, "active"),
          isNull(trainingCycles.deletedAt),
          ne(trainingCycles.id, cycleId),
        ),
      )
      .limit(1);
    if (otherActive) {
      values.status = "draft";
      skipped.push("Another cycle is active, so this one comes back as a draft");
    }
  }
  // A season the revision names may have been purged since: the cycle then
  // comes back with no season.
  if (typeof values.seasonId === "number") {
    const [exists] = await tx.select({ id: seasons.id }).from(seasons).where(eq(seasons.id, values.seasonId));
    if (!exists) {
      values.seasonId = null;
      values.phaseOrder = null;
      values.phaseType = null;
      skipped.push("Its season was deleted for good, so the cycle comes back with no season");
    }
  }
  const [restored] = await tx
    .update(trainingCycles)
    .set({ ...(values as Partial<typeof trainingCycles.$inferInsert>), deletedAt: null })
    .where(eq(trainingCycles.id, cycleId))
    .returning({ seasonId: trainingCycles.seasonId, raceDate: trainingCycles.raceDate, raceDistance: trainingCycles.raceDistance });
  // The seasons on both sides get their phase list, positions and chain
  // settled before the write ends (settleSeason).
  if (current?.seasonId != null) w.seasonsToSettle.add(current.seasonId);
  if (restored.seasonId != null) w.seasonsToSettle.add(restored.seasonId);
  // A cycle in a live season stores no race (D8). A revision from before the
  // cycle joined its season (or from before seasons existed) still holds one.
  if ((await liveSeasonId(tx, restored.seasonId)) != null && (restored.raceDate != null || restored.raceDistance != null)) {
    await tx.update(trainingCycles).set({ raceDate: null, raceDistance: null }).where(eq(trainingCycles.id, cycleId));
    skipped.push("Race kept on the season");
  }

  // Programs this cycle generated and lost in the same delete come back with it.
  if (wasDeleted) {
    const [deleteRev] = await tx
      .select({ changeSetId: planRevisions.changeSetId })
      .from(planRevisions)
      .where(
        and(
          eq(planRevisions.userId, w.ctx.userId),
          eq(planRevisions.objectType, "cycle"),
          eq(planRevisions.objectId, cycleId),
          eq(planRevisions.action, "delete"),
        ),
      )
      .orderBy(desc(planRevisions.id))
      .limit(1);
    if (deleteRev?.changeSetId) {
      const programDeletes = await tx
        .select({ id: planRevisions.id, objectId: planRevisions.objectId, snapshot: planRevisions.snapshot })
        .from(planRevisions)
        .innerJoin(programs, eq(programs.id, planRevisions.objectId))
        .where(
          and(
            eq(planRevisions.userId, w.ctx.userId),
            eq(planRevisions.changeSetId, deleteRev.changeSetId),
            eq(planRevisions.objectType, "program"),
            eq(planRevisions.action, "delete"),
            isNotNull(programs.deletedAt),
          ),
        );
      for (const p of programDeletes) {
        skipped.push(...(await restoreProgramTo(w, p.objectId, p.snapshot as ProgramSnapshot, p.id)));
      }
    }
  }

  const slotProgramIds = targetSnap.slots.map((s) => s.programId).filter((id): id is number => typeof id === "number");
  const existing = new Set(
    slotProgramIds.length
      ? (await tx.select({ id: programs.id }).from(programs).where(inArray(programs.id, slotProgramIds))).map((p) => p.id)
      : [],
  );
  // A slot's library workout may be gone for good (purged): the slot then has none (review 8).
  const slotWorkoutIds = targetSnap.slots.map((s) => s.workoutId).filter((id): id is number => typeof id === "number");
  const existingWorkouts = new Set(
    slotWorkoutIds.length
      ? // plan-read: includes deleted (a soft-deleted workout still exists; the slot reads it as rest)
        (await tx.select({ id: workouts.id }).from(workouts).where(inArray(workouts.id, slotWorkoutIds))).map((x) => x.id)
      : [],
  );
  await tx.delete(trainingCycleSlots).where(eq(trainingCycleSlots.trainingCycleId, cycleId));
  if (targetSnap.slots.length) {
    await tx.insert(trainingCycleSlots).values(
      targetSnap.slots.map(({ programName: _n, ...s }) => {
        void _n;
        const programId = typeof s.programId === "number" && existing.has(s.programId) ? s.programId : null;
        const workoutId = typeof s.workoutId === "number" && existingWorkouts.has(s.workoutId) ? s.workoutId : null;
        return { ...(s as unknown as typeof trainingCycleSlots.$inferInsert), trainingCycleId: cycleId, programId, workoutId };
      }),
    );
  }
  return skipped;
}

/** Live coach memory entries a user may keep (docs/plans/ai-coach.md, 2.1). */
export const COACH_MEMORY_MAX = 200;

/**
 * Refuse a new live memory entry past the cap. Takes a per-user lock for the
 * rest of the transaction, so two adds (or an add and a restore) that race
 * cannot both pass the count.
 */
export async function assertMemoryRoom(tx: Tx, userId: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`coach_memory:${userId}`}))`);
  const [{ n }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(coachMemory)
    .where(and(eq(coachMemory.userId, userId), isNull(coachMemory.deletedAt)));
  if (n >= COACH_MEMORY_MAX) {
    throw new PlanStateError(`Coach memory is full (${COACH_MEMORY_MAX} entries). Delete or merge old entries first.`);
  }
}

/** Restore a coach memory entry: its fields come back, and a deleted one is live again. */
async function restoreMemoryTo(
  w: PlanWriteSession,
  memoryId: number,
  targetSnap: MemorySnapshot,
  targetRevisionId: number,
): Promise<string[]> {
  await w.touch({ type: "memory", id: memoryId }, { allowDeleted: true, action: "restore", restoredFromId: targetRevisionId });
  const [row] = await w.tx.select({ deletedAt: coachMemory.deletedAt }).from(coachMemory).where(eq(coachMemory.id, memoryId));
  // Bringing a deleted entry back adds one live entry: the cap applies.
  if (row?.deletedAt) await assertMemoryRoom(w.tx, w.ctx.userId);
  const values: Record<string, unknown> = { ...targetSnap.memory };
  for (const k of MEMORY_KEPT) delete values[k];
  await w.tx
    .update(coachMemory)
    .set({ ...(values as Partial<typeof coachMemory.$inferInsert>), deletedAt: null, updatedAt: new Date() })
    .where(eq(coachMemory.id, memoryId));
  return [];
}

/** Live thresholds per kind (one definition, in the pure module), and live injuries, a user may keep. */
export { THRESHOLDS_PER_KIND_MAX };
export const INJURIES_MAX = 50;
/** Live library workouts and sick periods a user may keep (docs/plans/workouts-and-compliance.md, 4.1, 4.4). */
export const WORKOUTS_MAX = 300;
export const ILLNESS_MAX = 200;
/**
 * Refuse a sick period that overlaps another live one of the user (an open
 * period runs on from its first day). `excludeId` is the period being written.
 */
export async function assertNoIllnessOverlap(tx: Tx, userId: string, startedOn: string, endedOn: string | null, excludeId?: number) {
  const rows = await tx
    .select({ id: illnessPeriods.id, startedOn: illnessPeriods.startedOn, endedOn: illnessPeriods.endedOn })
    .from(illnessPeriods)
    .where(and(eq(illnessPeriods.userId, userId), isNull(illnessPeriods.deletedAt)));
  const end = endedOn ?? "9999-12-31";
  const clash = rows.find((r) => r.id !== excludeId && r.startedOn <= end && (r.endedOn ?? "9999-12-31") >= startedOn);
  if (clash) throw new PlanStateError(`This overlaps the sick period from ${clash.startedOn}${clash.endedOn ? ` to ${clash.endedOn}` : ""}. Change that one instead.`);
}

export const ENDURANCE_OFF = "Endurance features are not on for this account";

/**
 * Refuse a new live threshold of a kind, or injury, past the cap. Takes a
 * per-user lock for the rest of the transaction, so two adds cannot both pass.
 */
export async function assertAthleteRoom(tx: Tx, userId: string, type: "threshold" | "injury" | "workout" | "illness", kind?: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`athlete_${type}:${userId}`}))`);
  if (type === "workout" || type === "illness") {
    const table = type === "workout" ? workouts : illnessPeriods;
    const max = type === "workout" ? WORKOUTS_MAX : ILLNESS_MAX;
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(table)
      .where(and(eq(table.userId, userId), isNull(table.deletedAt)));
    if (n >= max) throw new PlanStateError(type === "workout" ? `At most ${max} workouts. Delete old ones first.` : `At most ${max} sick periods. Delete old ones first.`);
    return;
  }
  if (type === "threshold") {
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(athleteThresholds)
      .where(
        and(
          eq(athleteThresholds.userId, userId),
          isNull(athleteThresholds.deletedAt),
          eq(athleteThresholds.kind, kind as (typeof athleteThresholds.$inferSelect)["kind"]),
        ),
      );
    if (n >= THRESHOLDS_PER_KIND_MAX) {
      throw new PlanStateError(`At most ${THRESHOLDS_PER_KIND_MAX} values per threshold. Delete old ones first.`);
    }
    return;
  }
  const [{ n }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(athleteInjuries)
    .where(and(eq(athleteInjuries.userId, userId), isNull(athleteInjuries.deletedAt)));
  if (n >= INJURIES_MAX) throw new PlanStateError(`At most ${INJURIES_MAX} injuries. Delete old ones first.`);
}

/** Restore one athlete profile, threshold or injury row: its fields come back, and a deleted one is live again. */
async function restoreRowTo(
  w: PlanWriteSession,
  type: Exclude<RowType, "memory">,
  id: number,
  values: Row,
  targetRevisionId: number,
): Promise<string[]> {
  // The athlete profile and injuries belong to the endurance add-on (D18); thresholds are for everyone.
  if (type !== "threshold" && !(await enduranceEnabledFor(w.ctx.userId))) throw new PlanStateError(ENDURANCE_OFF);
  // A library workout's sessions follow it (review 7): the cycles using it are locked first, in A4's order.
  const { cyclesUsingWorkout, regenerateUsers } = type === "workout" ? await import("@/lib/workouts") : { cyclesUsingWorkout: null, regenerateUsers: null };
  if (cyclesUsingWorkout) {
    const ids = await cyclesUsingWorkout(w.ctx.userId, id, w.tx);
    if (ids.length) await lockCycleRows(w.tx, ids);
  }
  await w.touch({ type, id }, { allowDeleted: true, action: "restore", restoredFromId: targetRevisionId });
  const table = ROW_TABLES[type];
  const [row] = await w.tx.select({ deletedAt: table.deletedAt }).from(table).where(eq(table.id, id));
  const set: Record<string, unknown> = { ...values };
  for (const k of ROW_KEPT) delete set[k];
  // Bringing a deleted row back adds one live row: the cap applies.
  if (row?.deletedAt && type !== "athlete") await assertAthleteRoom(w.tx, w.ctx.userId, type, String(set.kind ?? ""));
  // Sick periods never overlap (docs/plans/workouts-and-compliance.md, 4.4).
  if (type === "illness") await assertNoIllnessOverlap(w.tx, w.ctx.userId, String(set.startedOn), (set.endedOn as string | null) ?? null, id);
  // jsonb gives timestamps back as strings.
  if (typeof set.interviewCompletedAt === "string") set.interviewCompletedAt = new Date(set.interviewCompletedAt);
  await w.tx
    .update(table)
    .set({ ...(set as Record<string, never>), deletedAt: null, updatedAt: new Date() })
    .where(eq(table.id, id));
  if (regenerateUsers) await regenerateUsers(w.tx, w.ctx.userId, id);
  return [];
}

/**
 * Restore a season: its fields and its races, with their ids. Phases are not
 * moved (a phase change is undone on the cycle). A restore that changes a race
 * date flags the season like any race write (D17).
 */
async function restoreSeasonTo(
  w: PlanWriteSession,
  seasonId: number,
  targetSnap: SeasonSnapshot,
  targetRevisionId: number,
): Promise<string[]> {
  await w.touch({ type: "season", id: seasonId }, { allowDeleted: true, action: "restore", restoredFromId: targetRevisionId });
  const tx = w.tx;
  const [row] = await tx
    .select({ deletedAt: seasons.deletedAt, replanFlaggedAt: seasons.replanFlaggedAt, replanReason: seasons.replanReason })
    .from(seasons)
    .where(eq(seasons.id, seasonId));
  const current = (await tx.select().from(seasonRaces).where(eq(seasonRaces.seasonId, seasonId))) as RaceLike[];
  const target = targetSnap.races.map((r) => ({
    ...(r as unknown as typeof seasonRaces.$inferInsert),
    seasonId,
    userId: w.ctx.userId,
    createdAt: r.createdAt ? new Date(String(r.createdAt)) : new Date(),
  }));
  const values: Record<string, unknown> = { ...targetSnap.season };
  for (const k of SEASON_KEPT) delete values[k];
  // The flag: a race change in the restore sets it; otherwise a revision that
  // was flagged brings its flag back (undoing "Mark as re-planned"), and one
  // that was not leaves the current flag as it is.
  const reason = replanReason(current, target as unknown as RaceLike[]);
  const flag = reason
    ? { replanFlaggedAt: new Date(), replanReason: reason }
    : targetSnap.season.replanFlaggedAt && !row.replanFlaggedAt
      ? { replanFlaggedAt: new Date(String(targetSnap.season.replanFlaggedAt)), replanReason: (targetSnap.season.replanReason as string | null) ?? null }
      : {};
  await tx
    .update(seasons)
    .set({
      ...(values as Partial<typeof seasons.$inferInsert>),
      deletedAt: null,
      updatedAt: new Date(),
      ...flag,
    })
    .where(eq(seasons.id, seasonId));
  await tx.delete(seasonRaces).where(eq(seasonRaces.seasonId, seasonId));
  if (target.length) await tx.insert(seasonRaces).values(target);
  // Back from the trash: its phases hold no race of their own again.
  if (row.deletedAt) await claimSeasonPhases(w, seasonId);
  w.seasonsToSettle.add(seasonId);
  return [];
}

/**
 * Restore one planned session: its date, order, program, notes and status
 * come back (docs/plans/sessions.md, 7). A session a workout was logged for
 * does not change: past sessions never change (T7).
 */
async function restorePlannedSessionTo(
  w: PlanWriteSession,
  id: number,
  targetSnap: PlannedSessionSnapshot,
  targetRevisionId: number,
): Promise<string[]> {
  await w.touch({ type: "planned_session", id }, { allowDeleted: true, action: "restore", restoredFromId: targetRevisionId });
  const [row] = await w.tx.select().from(plannedSessions).where(eq(plannedSessions.id, id));
  const values: Record<string, unknown> = { ...targetSnap.session };
  for (const k of PLANNED_SESSION_KEPT) delete values[k];
  // The same rules as a change in the app: no logged or past session, no
  // past day, inside the block, three a day at most (review 10, 11, 16).
  const { checkSessionRestore } = await import("@/lib/planned-sessions");
  await checkSessionRestore(w.tx, w.ctx.userId, row, values);
  if (typeof values.touchedAt === "string") values.touchedAt = new Date(values.touchedAt);
  await w.tx
    .update(plannedSessions)
    .set({ ...(values as Partial<typeof plannedSessions.$inferInsert>), deletedAt: null, updatedAt: new Date() })
    .where(eq(plannedSessions.id, id));
  return [];
}

/**
 * Take a restore's season and cycle locks in the order every season write
 * uses (lockSeasonsThenCycles): each season the restored cycles are in now or
 * were in at the revisions, and each restored season, then the cycles.
 */
async function lockForRestore(w: PlanWriteSession, revs: (typeof planRevisions.$inferSelect)[]) {
  const seasonIds: (number | null)[] = [];
  const cycleIds: number[] = [];
  for (const r of revs) {
    if (r.objectType === "season") seasonIds.push(r.objectId);
    if (r.objectType !== "cycle") continue;
    cycleIds.push(r.objectId);
    const snap = r.snapshot as PlanSnapshot;
    if (isCycleSnapshot(snap)) {
      seasonIds.push(typeof snap.cycle.seasonId === "number" ? snap.cycle.seasonId : null);
    }
    // The revision a change-set undo goes back to can name another season.
    const [prior] = await w.tx
      .select({ snapshot: planRevisions.snapshot })
      .from(planRevisions)
      .where(and(eq(planRevisions.objectType, "cycle"), eq(planRevisions.objectId, r.objectId), lt(planRevisions.id, r.id)))
      .orderBy(desc(planRevisions.id))
      .limit(1);
    const priorSeason = (prior?.snapshot as { cycle?: { seasonId?: unknown } } | undefined)?.cycle?.seasonId;
    if (typeof priorSeason === "number") seasonIds.push(priorSeason);
  }
  if (cycleIds.length) {
    const rows = await w.tx
      .select({ seasonId: trainingCycles.seasonId })
      .from(trainingCycles)
      .where(inArray(trainingCycles.id, cycleIds));
    seasonIds.push(...rows.map((c) => c.seasonId));
  }
  await lockSeasonsThenCycles(w, seasonIds, cycleIds);
}

/** Restore one object to a revision (the restore is itself a revision). */
async function restoreInSession(w: PlanWriteSession, rev: typeof planRevisions.$inferSelect): Promise<string[]> {
  const snap = rev.snapshot as PlanSnapshot;
  if (isMemorySnapshot(snap)) return restoreMemoryTo(w, rev.objectId, snap, rev.id);
  if (isAthleteSnapshot(snap)) return restoreRowTo(w, "athlete", rev.objectId, snap.athlete, rev.id);
  if (isThresholdSnapshot(snap)) return restoreRowTo(w, "threshold", rev.objectId, snap.threshold, rev.id);
  if (isInjurySnapshot(snap)) return restoreRowTo(w, "injury", rev.objectId, snap.injury, rev.id);
  if (isWorkoutSnapshot(snap)) return restoreRowTo(w, "workout", rev.objectId, snap.workout, rev.id);
  if (isIllnessSnapshot(snap)) return restoreRowTo(w, "illness", rev.objectId, snap.illness, rev.id);
  if (isSeasonSnapshot(snap)) return restoreSeasonTo(w, rev.objectId, snap, rev.id);
  if (isPlannedSessionSnapshot(snap)) return restorePlannedSessionTo(w, rev.objectId, snap, rev.id);
  return isProgramSnapshot(snap)
    ? restoreProgramTo(w, rev.objectId, snap, rev.id)
    : restoreCycleTo(w, rev.objectId, snap, rev.id);
}

/** After a restore commits: run the weekly sync again for the cycles it touched (T2). */
async function resyncAfterRestore(userId: string, targets: PlanTarget[]) {
  const programIds = targets.filter((t) => t.type === "program").map((t) => t.id);
  const cycleIds = targets.filter((t) => t.type === "cycle").map((t) => t.id);
  const active = await db.query.trainingCycles.findFirst({
    where: and(eq(trainingCycles.userId, userId), eq(trainingCycles.status, "active"), isNull(trainingCycles.deletedAt)),
    with: { slots: { with: { program: true } } },
  });
  if (!active?.startDate) return;
  const touches =
    cycleIds.includes(active.id) || active.slots.some((s) => s.programId != null && programIds.includes(s.programId));
  if (!touches) return;
  const { cycleWeek, parseDateStr } = await import("@/lib/utils/cycle-position");
  const { userToday } = await import("@/lib/user-settings");
  const { syncPeriodizedTargets } = await import("@/lib/periodization-sync");
  const { currentWeek, isOver } = cycleWeek(parseDateStr(active.startDate), active.durationWeeks, await userToday(userId), active.durationDays);
  if (isOver) return;
  const slots = active.slots.map((s) => (s.program?.deletedAt ? { ...s, programId: null } : s));
  // The current nudge, not a fresh one: an applied wearable suggestion stays.
  await syncPeriodizedTargets(active.id, userId, slots, currentWeek, active.durationWeeks, active.goal, active.athleteLevel, {
    pct: active.adaptationPct,
    note: active.adaptationNote ?? "",
  });
}

async function ownedRevision(userId: string, revisionId: number) {
  const [rev] = await db
    .select()
    .from(planRevisions)
    .where(and(eq(planRevisions.id, revisionId), eq(planRevisions.userId, userId)));
  return rev ?? null;
}

/** Restore a program or cycle to one of its revisions. Null when the revision is not the caller's. */
export async function restoreRevision(ctx: PlanWriteContext, revisionId: number): Promise<RestoreOutcome | null> {
  const rev = await ownedRevision(ctx.userId, revisionId);
  if (!rev) return null;
  const { result } = await planWrite(ctx, async (w) => {
    const capLock =
      rev.objectType === "memory"
        ? `coach_memory:${ctx.userId}`
        : rev.objectType === "threshold" || rev.objectType === "injury" || rev.objectType === "workout" || rev.objectType === "illness"
          ? `athlete_${rev.objectType}:${ctx.userId}`
          : null;
    if (capLock) await w.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${capLock}))`);
    await lockForRestore(w, [rev]);
    const skipped = await restoreInSession(w, rev);
    for (const s of w.seasonsToSettle) await settleSeason(w, s);
    return skipped;
  });
  await resyncAfterRestore(ctx.userId, [{ type: rev.objectType, id: rev.objectId }]);
  return { objectType: rev.objectType, objectId: rev.objectId, skipped: result };
}

/** Whether an object an undo would delete is still live (the set may have deleted it itself). */
async function liveForUndo(w: PlanWriteSession, target: PlanTarget): Promise<boolean> {
  const table = tableOf(target.type);
  const [row] = await w.tx.select({ deletedAt: table.deletedAt }).from(table).where(eq(table.id, target.id));
  return row != null && row.deletedAt == null;
}

/**
 * Undo a whole change set: every object it touched goes back to how it was
 * before the set's first change to it; an object the set created is deleted.
 */
export async function restoreChangeSet(ctx: PlanWriteContext, changeSetId: string) {
  const revs = await db
    .select()
    .from(planRevisions)
    .where(and(eq(planRevisions.userId, ctx.userId), eq(planRevisions.changeSetId, changeSetId)))
    .orderBy(asc(planRevisions.id));
  if (revs.length === 0) return null;
  const firstByObject = new Map<string, typeof planRevisions.$inferSelect>();
  for (const r of revs) {
    if (r.action === "conflict") continue;
    const k = `${r.objectType}:${r.objectId}`;
    if (!firstByObject.has(k)) firstByObject.set(k, r);
  }
  // Cycles first, then programs: the lock order every write uses. Memory
  // entries last; nothing else locks them.
  const order: Record<PlanObjectType, number> = { season: -1, cycle: 0, program: 1, memory: 2, athlete: 3, threshold: 4, injury: 5, illness: 6, workout: 7, planned_session: 8 };
  const firsts = [...firstByObject.values()].sort((a, b) =>
    a.objectType === b.objectType ? a.objectId - b.objectId : order[a.objectType] - order[b.objectType],
  );
  const targets = firsts.map((r) => ({ type: r.objectType, id: r.objectId }));
  const { result } = await planWrite(ctx, async (w) => {
    // A memory restore may take the per-user cap lock after its row lock;
    // take it first here, so two undos cannot wait on each other.
    if (firsts.some((f) => f.objectType === "memory")) {
      await w.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`coach_memory:${ctx.userId}`}))`);
    }
    // The same for the athlete caps (assertAthleteRoom).
    for (const type of ["threshold", "injury", "workout", "illness"] as const) {
      if (firsts.some((f) => f.objectType === type)) {
        await w.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`athlete_${type}:${ctx.userId}`}))`);
      }
    }
    await lockForRestore(w, firsts);
    const skipped: string[] = [];
    // The athlete profile and injuries belong to the endurance add-on (D18).
    // With it off, they stay as they are and the rest of the set undoes.
    let todo = firsts;
    const gated = firsts.filter((f) => f.objectType === "athlete" || f.objectType === "injury" || f.objectType === "workout" || f.objectType === "illness");
    if (gated.length && !(await enduranceEnabledFor(ctx.userId))) {
      todo = firsts.filter((f) => !gated.includes(f));
      skipped.push("Your athlete profile and injuries were not changed: endurance features are off for this account");
    }
    for (const first of todo) {
      const target = { type: first.objectType, id: first.objectId };
      const [prior] =
        first.action === "create"
          ? []
          : await w.tx
              .select()
              .from(planRevisions)
              .where(
                and(
                  eq(planRevisions.objectType, target.type),
                  eq(planRevisions.objectId, target.id),
                  lt(planRevisions.id, first.id),
                  ne(planRevisions.action, "conflict"),
                ),
              )
              .orderBy(desc(planRevisions.id))
              .limit(1);
      // The object did not exist, or was deleted, before the set's first
      // change: undoing the set deletes it (again), never restores the state
      // before that delete.
      if (first.action === "create" || prior?.action === "delete") {
        if (target.type === "program") {
          if (!(await liveForUndo(w, target))) continue;
          if (await openWorkoutOn(w.tx, ctx.userId, [target.id])) throw new OpenWorkoutError();
          await w.touch(target, { action: "delete" });
          await softDeleteProgram(w.tx, target.id);
        } else if (isRowType(target.type)) {
          if (!(await liveForUndo(w, target))) continue;
          await w.touch(target, { action: "delete" });
          const table = ROW_TABLES[target.type];
          await w.tx.update(table).set({ deletedAt: new Date() }).where(eq(table.id, target.id));
        } else if (target.type === "planned_session") {
          if (!(await liveForUndo(w, target))) continue;
          await w.touch(target, { action: "delete" });
          await w.tx.update(plannedSessions).set({ deletedAt: new Date() }).where(eq(plannedSessions.id, target.id));
        } else if (target.type === "season") {
          if (!(await liveForUndo(w, target))) continue;
          await w.touch(target, { action: "delete" });
          await releaseSeasonPhases(w, target.id);
          await w.tx.update(seasons).set({ deletedAt: new Date() }).where(eq(seasons.id, target.id));
        } else {
          if (!(await liveForUndo(w, target))) continue;
          await w.touch(target, { action: "delete" });
          const [gone] = await w.tx
            .update(trainingCycles)
            .set({ deletedAt: new Date() })
            .where(eq(trainingCycles.id, target.id))
            .returning({ seasonId: trainingCycles.seasonId });
          if (gone?.seasonId != null) w.seasonsToSettle.add(gone.seasonId);
        }
        continue;
      }
      if (prior) skipped.push(...(await restoreInSession(w, prior)));
    }
    for (const s of w.seasonsToSettle) await settleSeason(w, s);
    return skipped;
  });
  await resyncAfterRestore(ctx.userId, targets);
  return { objects: targets.length, skipped: result };
}

// ── Reading the history ──────────────────────────────────────────────────────

export type RevisionEntry = {
  id: number;
  version: number;
  action: PlanRevisionAction;
  writer: PlanWriter;
  reason: string | null;
  changeSetId: string | null;
  clientId: string | null;
  createdAt: Date;
  changes: string[];
  rejected: unknown;
  /** What the training limits found on an assistant write (docs/plans/ai-coach.md, 2.4). */
  limitCheck: unknown;
};

const HISTORY_LIMIT = 200;

/** One object's revisions, newest first, each with what changed. Null if not the caller's. */
export async function listRevisions(userId: string, target: PlanTarget): Promise<RevisionEntry[]> {
  const rows = await db
    .select()
    .from(planRevisions)
    .where(
      and(
        eq(planRevisions.userId, userId),
        eq(planRevisions.objectType, target.type),
        eq(planRevisions.objectId, target.id),
      ),
    )
    .orderBy(desc(planRevisions.id))
    .limit(HISTORY_LIMIT + 1);
  const chrono = rows.reverse();
  const out: RevisionEntry[] = [];
  let prev: PlanSnapshot | null = null;
  for (const r of chrono) {
    const snap = r.snapshot as PlanSnapshot;
    const changes =
      r.action === "baseline"
        ? ["How it looked before history started"]
        : r.action === "delete"
          ? ["Deleted"]
          : r.action === "conflict"
            ? conflictLines(r.rejected)
            : diffSnapshots(prev, snap);
    out.push({ ...r, changes });
    if (r.action !== "conflict") prev = snap;
  }
  // The extra row was read only to diff the oldest shown one against.
  if (rows.length > HISTORY_LIMIT) out.shift();
  return out.reverse();
}

/**
 * The revisions of a cycle's dated sessions, newest first, each change
 * prefixed with the session it is about (docs/plans/sessions.md, 5): the
 * cycle's history page lists them with the template's own.
 */
export async function listCycleSessionRevisions(userId: string, cycleId: number): Promise<RevisionEntry[]> {
  const ids = await db
    .selectDistinct({ id: planRevisions.objectId })
    .from(planRevisions)
    .innerJoin(plannedSessions, eq(plannedSessions.id, planRevisions.objectId))
    .where(
      and(
        eq(planRevisions.userId, userId),
        eq(planRevisions.objectType, "planned_session"),
        eq(plannedSessions.cycleId, cycleId),
      ),
    );
  const out: RevisionEntry[] = [];
  for (const { id } of ids) {
    for (const r of await listRevisions(userId, { type: "planned_session", id })) {
      if (r.action === "baseline") continue;
      const [rev] = await db.select({ snapshot: planRevisions.snapshot }).from(planRevisions).where(eq(planRevisions.id, r.id));
      const name = snapshotName(rev.snapshot as PlanSnapshot);
      out.push({ ...r, changes: r.changes.map((c) => (c.startsWith("Added") || c.startsWith("Skipped ") ? c : `${name}: ${c}`)) });
    }
  }
  return out.sort((a, b) => b.id - a.id);
}

function conflictLines(rejected: unknown): string[] {
  const r = rejected as {
    sets?: { programSetId: number; fields: Record<string, unknown>; setDeleted?: boolean }[];
  } | null;
  if (!r?.sets?.length) return ["A change was not applied"];
  return r.sets.map((s) =>
    s.setDeleted
      ? "Not applied: the set was removed from the plan"
      : `Not applied: ${Object.entries(s.fields).map(([f, v]) => `${f} ${v ?? "none"}`).join(", ")}`,
  );
}

export type ChangeSetEntry = {
  changeSetId: string;
  clientId: string | null;
  firstAt: Date;
  lastAt: Date;
  reasons: string[];
  objects: { type: PlanObjectType; id: number; name: string; changes: string[] }[];
  /** Lines for the training limits the assistant went past on purpose. */
  overrides: string[];
};

/** The user's assistant change sets, newest first, with what each changed. */
export async function listAssistantChangeSets(userId: string, limit = 30): Promise<ChangeSetEntry[]> {
  // One query: each assistant revision with the snapshot just before it on
  // the same object (LAG over the user's real revisions), so the feed reads
  // no row per change.
  const { rows } = await db.execute<{
    id: number;
    object_type: PlanObjectType;
    object_id: number;
    action: PlanRevisionAction;
    reason: string | null;
    change_set_id: string | null;
    client_id: string | null;
    created_at: Date | string;
    snapshot: PlanSnapshot;
    prior: PlanSnapshot | null;
    limit_check: unknown;
  }>(sql`
    SELECT * FROM (
      SELECT id, object_type, object_id, action, writer, reason, change_set_id, client_id, created_at, snapshot, limit_check,
             LAG(snapshot) OVER (PARTITION BY object_type, object_id ORDER BY id) AS prior
      FROM plan_revisions
      WHERE user_id = ${userId} AND action <> 'conflict'
    ) r
    WHERE r.writer = 'assistant'
    ORDER BY r.id DESC
    LIMIT 500`);
  const revs = rows.map((r) => ({
    id: r.id,
    objectType: r.object_type,
    objectId: r.object_id,
    action: r.action,
    reason: r.reason,
    changeSetId: r.change_set_id,
    clientId: r.client_id,
    createdAt: new Date(r.created_at),
    snapshot: r.snapshot,
    prior: r.prior,
    limitCheck: r.limit_check,
  }));
  const sets = new Map<string, typeof revs>();
  for (const r of revs) {
    const k = r.changeSetId ?? `rev:${r.id}`;
    if (!sets.has(k)) {
      if (sets.size >= limit) continue;
      sets.set(k, []);
    }
    sets.get(k)!.push(r);
  }
  const out: ChangeSetEntry[] = [];
  for (const [changeSetId, items] of sets) {
    const chrono = [...items].reverse();
    const objects: ChangeSetEntry["objects"] = [];
    for (const r of chrono) {
      const snap = r.snapshot;
      const name = snapshotName(snap);
      const changes = r.action === "delete" ? ["Deleted"] : diffSnapshots(r.prior ?? null, snap);
      const existing = objects.find((o) => o.type === r.objectType && o.id === r.objectId);
      if (existing) existing.changes.push(...changes);
      else objects.push({ type: r.objectType, id: r.objectId, name, changes });
    }
    out.push({
      changeSetId,
      clientId: chrono[0].clientId,
      firstAt: chrono[0].createdAt,
      lastAt: chrono[chrono.length - 1].createdAt,
      reasons: [...new Set(chrono.map((r) => r.reason).filter((r): r is string => !!r))],
      objects,
      overrides: [...new Set(chrono.map((r) => limitOverrideLine(r.limitCheck)).filter((l): l is string => !!l))],
    });
  }
  return out;
}

/** Deleted programs or cycles the user can still restore, newest first. */
export async function listDeleted(userId: string, type: PlanObjectType) {
  const table = type === "program" ? programs : type === "season" ? seasons : trainingCycles;
  const rows = await db
    // plan-read: includes deleted (the Recently deleted list)
    .select({ id: table.id, name: table.name, deletedAt: table.deletedAt })
    .from(table)
    .where(and(eq(table.userId, userId), isNotNull(table.deletedAt)))
    .orderBy(desc(table.deletedAt));
  const out: { id: number; name: string; deletedAt: Date; revisionId: number | null }[] = [];
  for (const r of rows) {
    const [rev] = await db
      .select({ id: planRevisions.id })
      .from(planRevisions)
      .where(
        and(
          eq(planRevisions.userId, userId),
          eq(planRevisions.objectType, type),
          eq(planRevisions.objectId, r.id),
          eq(planRevisions.action, "delete"),
        ),
      )
      .orderBy(desc(planRevisions.id))
      .limit(1);
    out.push({ id: r.id, name: r.name, deletedAt: r.deletedAt!, revisionId: rev?.id ?? null });
  }
  return out;
}

// ── Retention (section 9) ────────────────────────────────────────────────────

/**
 * Daily: drop revisions older than a year except each object's newest, and
 * delete for good the programs and cycles deleted more than 90 days ago, with
 * their revisions. Logged rows only lose their link then, as a delete always
 * did; no logged row is deleted.
 */
export async function purgePlanRevisions(now = new Date()) {
  const historyCut = new Date(now.getTime() - REVISION_RETENTION_DAYS * 86_400_000);
  const trashCut = new Date(now.getTime() - DELETED_PLAN_RETENTION_DAYS * 86_400_000);
  // A newer conflict row is not a newer state: it records a write that was not
  // applied, so it never makes the last real snapshot "old".
  await db.execute(sql`
    DELETE FROM plan_revisions r
    WHERE r.created_at < ${historyCut}
      AND EXISTS (
        SELECT 1 FROM plan_revisions n
        WHERE n.user_id = r.user_id AND n.object_type = r.object_type AND n.object_id = r.object_id
          AND n.id > r.id AND n.action <> 'conflict'
      )`);
  // Programs first: deleting a cycle cascades to the programs it generated
  // (created_by_cycle_id), which would take them out with their revisions
  // left behind.
  // plan-read: includes deleted (the purge reads deleted rows on purpose)
  const oldPrograms = await db.select({ id: programs.id }).from(programs).where(lt(programs.deletedAt, trashCut));
  if (oldPrograms.length) {
    const ids = oldPrograms.map((p) => p.id);
    await db.delete(planRevisions).where(and(eq(planRevisions.objectType, "program"), inArray(planRevisions.objectId, ids)));
    await db.delete(programs).where(inArray(programs.id, ids));
  }
  const oldMemory = await db.select({ id: coachMemory.id }).from(coachMemory).where(lt(coachMemory.deletedAt, trashCut));
  if (oldMemory.length) {
    const ids = oldMemory.map((m) => m.id);
    await db.delete(planRevisions).where(and(eq(planRevisions.objectType, "memory"), inArray(planRevisions.objectId, ids)));
    await db.delete(coachMemory).where(inArray(coachMemory.id, ids));
  }
  for (const type of ["athlete", "threshold", "injury", "workout", "illness"] as const) {
    const table = ROW_TABLES[type];
    const old = await db.select({ id: table.id }).from(table).where(lt(table.deletedAt, trashCut));
    if (!old.length) continue;
    const ids = old.map((r) => r.id);
    await db.delete(planRevisions).where(and(eq(planRevisions.objectType, type), inArray(planRevisions.objectId, ids)));
    await db.delete(table).where(inArray(table.id, ids));
  }
  // plan-read: includes deleted (the purge reads deleted rows on purpose)
  const oldCycles = await db.select({ id: trainingCycles.id }).from(trainingCycles).where(lt(trainingCycles.deletedAt, trashCut));
  if (oldCycles.length) {
    const ids = oldCycles.map((c) => c.id);
    // Every program still kept, live or still in the trash, must not go with
    // its cycle: unhook it first (the old ones are already gone above).
    await db.update(programs).set({ createdByCycleId: null }).where(inArray(programs.createdByCycleId, ids));
    await db.delete(planRevisions).where(and(eq(planRevisions.objectType, "cycle"), inArray(planRevisions.objectId, ids)));
    // The cycle's dated sessions go with it (FK cascade); so do their revisions (review 17).
    await db.delete(planRevisions).where(
      and(
        eq(planRevisions.objectType, "planned_session"),
        inArray(planRevisions.objectId, db.select({ id: plannedSessions.id }).from(plannedSessions).where(inArray(plannedSessions.cycleId, ids))),
      ),
    );
    await db.delete(trainingCycles).where(inArray(trainingCycles.id, ids));
  }
  // Planned sessions a user or an assistant removed, unless a workout was
  // started for one (the link would be lost).
  const oldSessions = await db
    // plan-read: includes deleted (the purge reads deleted rows on purpose)
    .select({ id: plannedSessions.id })
    .from(plannedSessions)
    .where(
      and(
        lt(plannedSessions.deletedAt, trashCut),
        sql`NOT EXISTS (SELECT 1 FROM ${workoutSessions} WHERE ${workoutSessions.plannedSessionId} = ${plannedSessions.id})`,
      ),
    );
  if (oldSessions.length) {
    const ids = oldSessions.map((s) => s.id);
    await db.delete(planRevisions).where(and(eq(planRevisions.objectType, "planned_session"), inArray(planRevisions.objectId, ids)));
    await db.delete(plannedSessions).where(inArray(plannedSessions.id, ids));
  }
  // Seasons last: their cycles stay (season_id goes null with the FK) and their
  // races go with them (cascade).
  const oldSeasons = await db.select({ id: seasons.id }).from(seasons).where(lt(seasons.deletedAt, trashCut));
  if (oldSeasons.length) {
    const ids = oldSeasons.map((s) => s.id);
    await db.delete(planRevisions).where(and(eq(planRevisions.objectType, "season"), inArray(planRevisions.objectId, ids)));
    await db.delete(seasons).where(inArray(seasons.id, ids));
  }
}
