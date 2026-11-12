/**
 * Dated sessions on the server (docs/plans/sessions.md): generation and the
 * T7 regeneration inside a plan write, the lazy backfill, the reads the home
 * screen, the calendar and MCP share, and the per-session writes (move, skip,
 * change, add, remove, reset) that the app and the assistant both call.
 *
 * Plain server code, not Server Actions: callers resolve the user first.
 */

import { db } from "@/db";
import {
  dismissedMakeups,
  plannedSessions,
  programs,
  trainingCycleSlots,
  trainingCycles,
  workoutSessions,
} from "@/db/schema";
import { liveCycles, livePlannedSessions, livePrograms } from "@/lib/plan-live";
import { PlanNotFoundError, PlanStateError, lockCycleRows, planWrite, type PlanWriteContext, type PlanWriteSession, type Tx } from "@/lib/plan-revisions";
import { withLimits, type LimitContext, type LimitOverride, type LimitScope } from "@/lib/training-limits";
import type { LimitCheck, LimitRule } from "@/lib/utils/training-limits";
import { userToday } from "@/lib/user-settings";
import { cycleLengthDays, parseDateStr, projectRotation, toDateStr } from "@/lib/utils/cycle-position";
import {
  MAX_SLOTS_PER_DAY,
  addDaysStr,
  daySlotProblem,
  generateWeekday,
  mondayOf,
  matchPlanned,
  regenerationPlan,
  type CompletedForMatch,
  type ExistingRow,
  type TemplateSlot,
} from "@/lib/utils/planned-sessions";
import { insertAutoSessions } from "@/lib/auto-sessions";
import type { MissedSlot, TodaySession, TrainingCycleSlotWithProgram } from "@/types/workout";
import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";

type Executor = typeof db | Tx;
export type PlannedRow = typeof plannedSessions.$inferSelect;

/** A cycle's dates: [start, end) for an active cycle or a scheduled draft, else null. */
export function cycleBlock(c: {
  status: string;
  startDate: string | null;
  scheduledStartDate: string | null;
  durationWeeks: number;
  durationDays: number | null;
  deletedAt?: Date | null;
}): { start: string; end: string } | null {
  if (c.deletedAt) return null;
  const start = c.status === "active" ? c.startDate : c.status === "draft" ? c.scheduledStartDate : null;
  if (!start) return null;
  return { start, end: addDaysStr(start, cycleLengthDays(c)) };
}

async function templateSlots(ex: Executor, cycleId: number): Promise<TemplateSlot[]> {
  const rows = await ex
    .select({ slot: trainingCycleSlots, programDeletedAt: programs.deletedAt })
    .from(trainingCycleSlots)
    // plan-read: includes deleted (a deleted program reads as a rest day, as liveSlotProgram does)
    .leftJoin(programs, eq(programs.id, trainingCycleSlots.programId))
    .where(eq(trainingCycleSlots.trainingCycleId, cycleId));
  return rows.map(({ slot, programDeletedAt }) => ({
    id: slot.id,
    dayOfWeek: slot.dayOfWeek,
    daySlot: slot.daySlot,
    orderIndex: slot.orderIndex,
    programId: programDeletedAt ? null : slot.programId,
    label: slot.label,
    notes: slot.notes,
    autoComplete: slot.autoComplete,
  }));
}

/** Completed workouts that can match planned sessions dated in [from, to], or linked to these rows. */
export async function completedFor(ex: Executor, userId: string, from: string, to: string, rowIds: number[] = []): Promise<CompletedForMatch[]> {
  return ex
    .select({
      id: workoutSessions.id,
      date: workoutSessions.date,
      intendedDate: workoutSessions.intendedDate,
      programId: workoutSessions.programId,
      plannedSessionId: workoutSessions.plannedSessionId,
    })
    .from(workoutSessions)
    .where(
      and(
        eq(workoutSessions.userId, userId),
        eq(workoutSessions.isCompleted, true),
        or(
          and(gte(workoutSessions.date, from), lte(workoutSessions.date, to)),
          and(gte(workoutSessions.intendedDate, from), lte(workoutSessions.intendedDate, to)),
          rowIds.length ? inArray(workoutSessions.plannedSessionId, rowIds) : sql`false`,
        ),
      ),
    );
}

/** Which of these rows are done (matched to a completed workout). */
export function doneIds(rows: Pick<PlannedRow, "id" | "date" | "position" | "programId" | "status">[], sessions: CompletedForMatch[]): Map<number, number> {
  const match = matchPlanned(
    rows.filter((r) => r.status === "planned" && r.date != null).map((r) => ({ id: r.id, date: r.date!, position: r.position, programId: r.programId })),
    sessions,
  );
  return new Map([...match].map(([id, m]) => [id, m.sessionId]));
}

/**
 * Bring a cycle's dated sessions in line with its template (3.4, T7), inside
 * the caller's transaction. Writes no revisions: the cycle's own revision
 * holds the template. Stamps `sessions_generated_at` on the first run.
 */
export async function regenerateCycleSessions(
  tx: Tx,
  userId: string,
  cycleId: number,
  opts: { includePast?: boolean; backfill?: boolean } = {},
): Promise<{ inserted: number; updated: number; removed: number; removedTouched: number }> {
  const none = { inserted: 0, updated: 0, removed: 0, removedTouched: 0 };
  // plan-read: includes deleted (a deleted cycle is checked just below)
  const [cycle] = await tx.select().from(trainingCycles).where(eq(trainingCycles.id, cycleId));
  if (!cycle || cycle.userId !== userId || cycle.deletedAt) return none;
  const today = toDateStr(await userToday(userId));
  const block = cycle.scheduleType === "day_of_week" ? cycleBlock(cycle) : null;
  const existingRows = await tx
    .select()
    .from(plannedSessions)
    .where(and(eq(plannedSessions.cycleId, cycleId), isNull(plannedSessions.rotationPosition), livePlannedSessions));
  const dates = existingRows.map((r) => r.date).filter((d): d is string => d != null && d <= today);
  const sessions = dates.length ? await completedFor(tx, userId, dates.reduce((a, b) => (a < b ? a : b)), today, existingRows.map((r) => r.id)) : [];
  const done = doneIds(existingRows.filter((r) => r.date != null && r.date <= today), sessions);
  const existing: ExistingRow[] = existingRows.map((r) => ({
    id: r.id,
    slotId: r.slotId,
    templateDate: r.templateDate,
    date: r.date,
    position: r.position,
    programId: r.programId,
    label: r.label,
    notes: r.notes,
    autoComplete: r.autoComplete,
    touched: r.touchedAt != null,
    done: done.has(r.id) || (r.date != null && r.date < today && r.status === "skipped"),
  }));
  const generated = block ? generateWeekday(block.start, cycleLengthDays(cycle), await templateSlots(tx, cycleId)) : [];
  const includePast = opts.includePast || opts.backfill || cycle.sessionsGeneratedAt == null;
  const plan = regenerationPlan({ existing, generated, today, block, includePast });

  const now = new Date();
  if (plan.remove.length) {
    await tx.update(plannedSessions).set({ deletedAt: now, updatedAt: now }).where(inArray(plannedSessions.id, plan.remove));
  }
  for (const u of plan.update) {
    await tx.update(plannedSessions).set({ ...u.fields, updatedAt: now }).where(eq(plannedSessions.id, u.id));
  }
  if (plan.insert.length) {
    const dismissed = opts.backfill
      ? new Set(
          (await tx.select({ date: dismissedMakeups.date }).from(dismissedMakeups).where(eq(dismissedMakeups.userId, userId))).map((d) => d.date),
        )
      : new Set<string>();
    await tx
      .insert(plannedSessions)
      .values(
        plan.insert.map((g) => ({
          ...g,
          userId,
          cycleId,
          status: dismissed.has(g.date) && g.date < today ? ("skipped" as const) : ("planned" as const),
        })),
      )
      .onConflictDoNothing();
  }
  if (cycle.sessionsGeneratedAt == null) {
    await tx.update(trainingCycles).set({ sessionsGeneratedAt: now }).where(eq(trainingCycles.id, cycleId));
  }
  const touchedIds = new Set(existingRows.filter((r) => r.touchedAt != null).map((r) => r.id));
  return {
    inserted: plan.insert.length,
    updated: plan.update.length,
    removed: plan.remove.length,
    removedTouched: plan.remove.filter((id) => touchedIds.has(id)).length,
  };
}

/** The template part of a cycle snapshot: what generation reads. */
export function cycleTemplateKey(snap: { cycle: Record<string, unknown>; slots: Record<string, unknown>[] }): string {
  const c = snap.cycle;
  const slots = [...snap.slots]
    .sort((a, b) => Number(a.id) - Number(b.id))
    .map((s) => [s.id, s.dayOfWeek, s.daySlot ?? 1, s.orderIndex, s.programId, s.label, s.notes, s.autoComplete]);
  return JSON.stringify([c.status, c.startDate, c.scheduledStartDate, c.durationWeeks, c.durationDays ?? null, c.scheduleType, slots]);
}

/**
 * The lazy backfill (3.5): a live active or scheduled cycle that has no dated
 * sessions yet gets them, from its start, with declined days skipped. One
 * indexed read when it is already done.
 */
export async function ensureCycleSessions(userId: string, cycleId: number): Promise<void> {
  const [c] = await db
    .select({ at: trainingCycles.sessionsGeneratedAt })
    .from(trainingCycles)
    .where(and(eq(trainingCycles.id, cycleId), eq(trainingCycles.userId, userId), liveCycles));
  if (!c || c.at) return;
  await db.transaction(async (tx) => {
    await lockCycleRows(tx, [cycleId]);
    const [again] = await tx
      .select({ at: trainingCycles.sessionsGeneratedAt })
      .from(trainingCycles)
      .where(and(eq(trainingCycles.id, cycleId), liveCycles));
    if (again?.at) return;
    await regenerateCycleSessions(tx, userId, cycleId, { backfill: true });
  });
}

// ── Reads ────────────────────────────────────────────────────────────────────

export type PlannedView = {
  id: number | null;
  cycleId: number;
  date: string;
  position: number;
  programId: number | null;
  programName: string | null;
  label: string | null;
  notes: string | null;
  autoComplete: boolean;
  status: "planned" | "done" | "missed" | "skipped";
  skipReason: string | null;
  loggedSessionId: number | null;
  touched: boolean;
  templateDate: string | null;
  slotId: number | null;
  rotationPosition: number | null;
  version: number | null;
};

/** A user's weekday rows in [from, to], live, in live cycles, with program names. */
export async function plannedRowsInRange(ex: Executor, userId: string, from: string, to: string, cycleId?: number) {
  return ex
    .select({ row: plannedSessions, programName: programs.name, programDeletedAt: programs.deletedAt })
    .from(plannedSessions)
    .innerJoin(trainingCycles, and(eq(trainingCycles.id, plannedSessions.cycleId), isNull(trainingCycles.deletedAt)))
    // plan-read: includes deleted (a deleted program reads as no program)
    .leftJoin(programs, eq(programs.id, plannedSessions.programId))
    .where(
      and(
        eq(plannedSessions.userId, userId),
        livePlannedSessions,
        isNotNull(plannedSessions.date),
        gte(plannedSessions.date, from),
        lte(plannedSessions.date, to),
        cycleId != null ? eq(plannedSessions.cycleId, cycleId) : undefined,
      ),
    )
    .orderBy(asc(plannedSessions.date), asc(plannedSessions.position), asc(plannedSessions.id));
}

/**
 * Planned sessions in [from, to] as the user and the assistant see them:
 * weekday cycles from their rows, rotation cycles from the walk (with the
 * stored overrides). Done and missed are matched on read.
 */
export async function listPlanned(userId: string, from: string, to: string, cycleId?: number): Promise<PlannedView[]> {
  const today = toDateStr(await userToday(userId));
  const cycles = await db
    .select()
    .from(trainingCycles)
    .where(
      and(
        eq(trainingCycles.userId, userId),
        isNull(trainingCycles.deletedAt),
        or(eq(trainingCycles.status, "active"), isNotNull(trainingCycles.scheduledStartDate)),
        cycleId != null ? eq(trainingCycles.id, cycleId) : undefined,
      ),
    );
  for (const c of cycles) if (c.scheduleType === "day_of_week") await ensureCycleSessions(userId, c.id);
  const rows = await plannedRowsInRange(db, userId, from, to, cycleId);
  const sessions = await completedFor(db, userId, from, to < today ? to : today, rows.map((r) => r.row.id));
  const done = doneIds(rows.map((r) => r.row).filter((r) => r.date! <= today), sessions);
  const out: PlannedView[] = rows.map(({ row, programName, programDeletedAt }) => ({
    id: row.id,
    cycleId: row.cycleId,
    date: row.date!,
    position: row.position,
    programId: programDeletedAt ? null : row.programId,
    programName: programDeletedAt ? null : programName,
    label: row.label,
    notes: row.notes,
    autoComplete: row.autoComplete,
    status:
      row.status === "skipped" ? "skipped" : done.has(row.id) ? "done" : row.date! < today ? "missed" : "planned",
    skipReason: row.skipReason,
    loggedSessionId: done.get(row.id) ?? null,
    touched: row.touchedAt != null,
    templateDate: row.templateDate,
    slotId: row.slotId,
    rotationPosition: null,
    version: row.version,
  }));
  for (const c of cycles.filter((x) => x.scheduleType === "rotation" && x.status === "active" && x.startDate)) {
    out.push(...(await rotationView(userId, c, from, to)));
  }
  return out.sort((a, b) => (a.date === b.date ? a.position - b.position : a.date < b.date ? -1 : 1));
}

/** Stored rotation overrides of a cycle, by walk position. */
export async function rotationOverrides(ex: Executor, cycleId: number) {
  const rows = await ex
    .select()
    .from(plannedSessions)
    .where(and(eq(plannedSessions.cycleId, cycleId), isNotNull(plannedSessions.rotationPosition), livePlannedSessions));
  return {
    rows,
    skipped: new Set(rows.filter((r) => r.status === "skipped").map((r) => r.rotationPosition!)),
    changed: new Map(rows.filter((r) => r.status === "planned").map((r) => [r.rotationPosition!, r])),
  };
}

async function rotationView(userId: string, c: typeof trainingCycles.$inferSelect, from: string, to: string): Promise<PlannedView[]> {
  const slots = await templateSlots(db, c.id);
  const sessions = await db
    .select({ date: workoutSessions.date })
    .from(workoutSessions)
    .where(and(eq(workoutSessions.userId, userId), eq(workoutSessions.isCompleted, true), gte(workoutSessions.date, c.startDate!)));
  const { rows, skipped, changed } = await rotationOverrides(db, c.id);
  const today = await userToday(userId);
  const end = addDaysStr(c.startDate!, cycleLengthDays(c) - 1);
  const until = to < end ? to : end;
  const days = projectRotation(
    parseDateStr(c.startDate!),
    slots.map((s) => ({ id: s.id, dayOfWeek: null, orderIndex: s.orderIndex ?? null, programId: s.programId })),
    sessions.map((s) => s.date).sort(),
    today,
    parseDateStr(until),
    skipped,
  );
  const names = new Map(
    (await db.select({ id: programs.id, name: programs.name }).from(programs).where(livePrograms)).map((p) => [p.id, p.name]),
  );
  const byPos = new Map(rows.map((r) => [r.rotationPosition!, r]));
  return days
    .filter((d) => d.date >= from)
    .map((d) => {
      const o = byPos.get(d.position);
      const programId = changed.get(d.position)?.programId ?? d.programId;
      return {
        id: o?.id ?? null,
        cycleId: c.id,
        date: d.date,
        position: 1,
        programId,
        programName: programId != null ? (names.get(programId) ?? null) : null,
        label: o?.label ?? null,
        notes: o?.notes ?? null,
        autoComplete: slots.find((s) => s.id === d.slotId)?.autoComplete ?? false,
        status: d.status,
        skipReason: o?.skipReason ?? null,
        loggedSessionId: null,
        touched: o != null,
        templateDate: null,
        slotId: d.slotId,
        rotationPosition: d.position,
        version: o?.version ?? null,
      };
    });
}

/**
 * Today and the missed list of an active weekday cycle, from its dated
 * sessions (4.2), and the auto rows for days tracked outside the app. For one
 * session a day this gives what the template rules gave before C2; the
 * characterization tests in src/__tests__/integration/cycle-today.test.ts pin it.
 */
export async function weekdayToday(params: {
  userId: string;
  cycleId: number;
  startDate: Date;
  slots: TrainingCycleSlotWithProgram[];
  today: Date;
  missedEnabled: boolean;
}): Promise<{ todaySlot: TrainingCycleSlotWithProgram | null; todaySessions: TodaySession[]; missedSlots: MissedSlot[] }> {
  const { userId, cycleId, slots, today, missedEnabled } = params;
  await ensureCycleSessions(userId, cycleId);
  const todayStr = toDateStr(today);
  // The last 7 days and today, bounded by the start (the window before C2).
  const back = new Date(today);
  back.setDate(back.getDate() - 7);
  const from = toDateStr(back < params.startDate ? params.startDate : back);
  const rows = (await plannedRowsInRange(db, userId, from, todayStr, cycleId))
    // A session whose program was deleted reads as a rest day, as its slot does.
    .filter((r) => r.row.status === "planned" && r.row.programId != null && r.programDeletedAt == null);
  const loadSessions = () =>
    db
      .select({
        id: workoutSessions.id,
        date: workoutSessions.date,
        intendedDate: workoutSessions.intendedDate,
        programId: workoutSessions.programId,
        plannedSessionId: workoutSessions.plannedSessionId,
        source: workoutSessions.source,
      })
      .from(workoutSessions)
      .where(and(eq(workoutSessions.userId, userId), eq(workoutSessions.isCompleted, true), gte(workoutSessions.date, from)));
  const forMatch = rows.map(({ row }) => ({ id: row.id, date: row.date!, position: row.position, programId: row.programId }));
  let sessions = await loadSessions();
  let match = matchPlanned(forMatch, sessions);

  // Days tracked outside the app: a session not done by its own workout or
  // one of its program (a workout of another program does not count, as before).
  const due = rows.filter(({ row, programDeletedAt }) => {
    if (!row.autoComplete || row.programId == null || programDeletedAt) return false;
    const m = match.get(row.id);
    return !m || m.step === 3;
  });
  if (due.length) {
    await insertAutoSessions(userId, due.map(({ row }) => ({ date: row.date!, programId: row.programId!, plannedSessionId: row.id })));
    sessions = await loadSessions();
    match = matchPlanned(forMatch, sessions);
  }

  const programIds = [...new Set(rows.map((r) => r.row.programId).filter((id): id is number => id != null))];
  const programRows = programIds.length ? await db.select().from(programs).where(and(inArray(programs.id, programIds), livePrograms)) : [];
  const programById = new Map(programRows.map((p) => [p.id, p]));
  const slotById = new Map(slots.map((s) => [s.id, s]));
  const slotFor = (row: PlannedRow): TrainingCycleSlotWithProgram => {
    const base =
      (row.slotId != null ? slotById.get(row.slotId) : undefined) ??
      ({
        id: 0,
        trainingCycleId: cycleId,
        dayOfWeek: null,
        orderIndex: null,
        label: null,
        notes: null,
        programId: null,
        autoComplete: false,
        daySlot: row.position,
        program: null,
      } satisfies TrainingCycleSlotWithProgram);
    const program = row.programId != null ? (programById.get(row.programId) ?? null) : null;
    return { ...base, programId: program ? program.id : null, program, label: row.label, notes: row.notes, autoComplete: row.autoComplete };
  };

  const todaySessions: TodaySession[] = rows
    .filter(({ row }) => row.date === todayStr)
    .map(({ row }) => {
      const m = match.get(row.id);
      const s = m ? sessions.find((x) => x.id === m.sessionId) : undefined;
      return { plannedSessionId: row.id, slot: slotFor(row), done: m != null, autoSessionId: s?.source === "auto" ? s.id : null };
    });
  // Today's slot: the first session not done, else the first; on a day with
  // no session, the template's rest slot (a session moved away leaves none).
  const dow = today.getDay() === 0 ? 7 : today.getDay();
  const restSlot = slots.find((s) => s.dayOfWeek === dow && s.programId == null) ?? null;
  const todaySlot = (todaySessions.find((t) => !t.done) ?? todaySessions[0])?.slot ?? (todaySessions.length ? null : restSlot);

  const missedSlots: MissedSlot[] = missedEnabled
    ? rows
        .filter(({ row }) => row.date! < todayStr && !match.has(row.id))
        .map(({ row }) => ({ date: row.date!, slot: slotFor(row), plannedSessionId: row.id }))
    : [];
  return { todaySlot, todaySessions, missedSlots };
}

// ── Template slots (3.1) ─────────────────────────────────────────────────────

type SlotValues = { label?: string | null; programId?: number | null; notes?: string | null; autoComplete?: boolean };

/**
 * Upsert one template slot inside a cycle write, keyed by weekday and the
 * slot's order in the day (or by rotation position). Shared by the app and
 * the MCP `edit_cycle_slot` tool. Refuses a rest day next to a session, more
 * than three sessions a day, and a gap in the day's order.
 */
export async function upsertSlotInTx(
  tx: Tx,
  cycleId: number,
  key: { dayOfWeek: number | null; orderIndex: number | null; daySlot?: number },
  values: SlotValues,
) {
  if (key.dayOfWeek == null && (key.daySlot ?? 1) !== 1) {
    throw new SessionInputError("Only a weekday cycle holds several sessions a day.");
  }
  const daySlot = key.daySlot ?? 1;
  const daySlots =
    key.dayOfWeek != null
      ? await tx
          .select()
          .from(trainingCycleSlots)
          .where(and(eq(trainingCycleSlots.trainingCycleId, cycleId), eq(trainingCycleSlots.dayOfWeek, key.dayOfWeek)))
      : await tx
          .select()
          .from(trainingCycleSlots)
          .where(and(eq(trainingCycleSlots.trainingCycleId, cycleId), eq(trainingCycleSlots.orderIndex, key.orderIndex ?? -1)));
  const existing = key.dayOfWeek != null ? daySlots.find((s) => s.daySlot === daySlot) : daySlots[0];
  if (key.dayOfWeek != null) {
    const programId = values.programId !== undefined ? values.programId : (existing?.programId ?? null);
    const problem = daySlotProblem({ daySlot, programId, others: daySlots.filter((s) => s.id !== existing?.id) });
    if (problem) throw new SessionInputError(problem);
  }
  if (existing) {
    const [updated] = await tx
      .update(trainingCycleSlots)
      .set({ ...values, dayOfWeek: key.dayOfWeek, orderIndex: key.orderIndex, daySlot })
      .where(eq(trainingCycleSlots.id, existing.id))
      .returning();
    return updated;
  }
  const [inserted] = await tx
    .insert(trainingCycleSlots)
    .values({ trainingCycleId: cycleId, dayOfWeek: key.dayOfWeek, orderIndex: key.orderIndex, daySlot, ...values })
    .returning();
  return inserted;
}

/** Remove one template slot inside a cycle write; the day's other sessions close the gap. */
export async function removeSlotInTx(tx: Tx, cycleId: number, slotId: number) {
  const removed = await tx
    .delete(trainingCycleSlots)
    .where(and(eq(trainingCycleSlots.id, slotId), eq(trainingCycleSlots.trainingCycleId, cycleId)))
    .returning();
  const gone = removed[0];
  if (gone?.dayOfWeek != null) {
    const rest = await tx
      .select({ id: trainingCycleSlots.id, daySlot: trainingCycleSlots.daySlot })
      .from(trainingCycleSlots)
      .where(and(eq(trainingCycleSlots.trainingCycleId, cycleId), eq(trainingCycleSlots.dayOfWeek, gone.dayOfWeek)))
      .orderBy(asc(trainingCycleSlots.daySlot));
    for (const [i, s] of rest.entries()) {
      if (s.daySlot !== i + 1) await tx.update(trainingCycleSlots).set({ daySlot: i + 1 }).where(eq(trainingCycleSlots.id, s.id));
    }
  }
  return removed;
}

// ── Writes ───────────────────────────────────────────────────────────────────

export type SessionOp =
  | { op: "move"; id: number; date: string; position?: number; expectedVersion?: number }
  | { op: "skip"; id: number; reason?: string | null; expectedVersion?: number }
  | { op: "unskip"; id: number; expectedVersion?: number }
  | { op: "change"; id: number; programId?: number; label?: string | null; notes?: string | null; position?: number; expectedVersion?: number }
  | { op: "reset"; id: number; expectedVersion?: number }
  | { op: "remove"; id: number; expectedVersion?: number }
  | { op: "add"; cycleId: number; date: string; programId: number; position?: number; label?: string | null; notes?: string | null };

export class SessionInputError extends PlanStateError {}

async function ownedProgram(ex: Executor, userId: string, programId: number) {
  const [p] = await ex.select({ userId: programs.userId }).from(programs).where(and(eq(programs.id, programId), livePrograms));
  if (!p || p.userId !== userId) throw new SessionInputError("Program not found");
}

async function liveRow(tx: Tx, userId: string, id: number) {
  const [row] = await tx
    .select({ row: plannedSessions, cycle: trainingCycles })
    .from(plannedSessions)
    .innerJoin(trainingCycles, eq(trainingCycles.id, plannedSessions.cycleId))
    .where(and(eq(plannedSessions.id, id), eq(plannedSessions.userId, userId), livePlannedSessions, isNull(trainingCycles.deletedAt)));
  if (!row) throw new PlanNotFoundError({ type: "planned_session", id });
  return row;
}

async function isDone(tx: Tx, userId: string, row: PlannedRow, today: string): Promise<boolean> {
  if (row.date == null || row.date > today || row.status !== "planned") return false;
  const sameDay = await tx
    .select()
    .from(plannedSessions)
    .where(and(eq(plannedSessions.cycleId, row.cycleId), eq(plannedSessions.date, row.date), livePlannedSessions));
  const sessions = await completedFor(tx, userId, row.date, row.date, [row.id]);
  return doneIds(sameDay, sessions).has(row.id);
}

async function dayCount(tx: Tx, userId: string, date: string, excludeId?: number): Promise<number> {
  const [{ n }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(plannedSessions)
    .innerJoin(trainingCycles, and(eq(trainingCycles.id, plannedSessions.cycleId), isNull(trainingCycles.deletedAt)))
    .where(
      and(
        eq(plannedSessions.userId, userId),
        eq(plannedSessions.date, date),
        livePlannedSessions,
        excludeId != null ? ne(plannedSessions.id, excludeId) : undefined,
      ),
    );
  return n;
}

/**
 * One change to one planned session, as the user or the assistant (5, 6).
 * Every change is a revision of the session (object type `planned_session`).
 * Returns the row after the change and its new version.
 */
export async function applySessionOp(
  ctx: PlanWriteContext,
  input: SessionOp,
  /** An assistant's write runs the training limits around it (D3); the app's never does (D4). */
  limits?: { lc: LimitContext; override: LimitOverride },
): Promise<{ row: PlannedRow; version: number; limits: { check: LimitCheck; unusedOverrides: LimitRule[] } | null }> {
  const today = toDateStr(await userToday(ctx.userId));
  const { result, versions } = await planWrite(ctx, async (w) => {
    if (!limits) return { row: await sessionOpBody(w, ctx, input, today), limits: null };
    const scope = await sessionScope(w.tx, ctx.userId, input);
    const { result, check, unusedOverrides } = await withLimits(w, limits.lc, scope, limits.override, () =>
      sessionOpBody(w, ctx, input, today),
    );
    return { row: result, limits: { check, unusedOverrides } };
  });
  return { row: result.row, limits: result.limits, version: versions.get(`planned_session:${result.row.id}`) ?? result.row.version };
}

/** The weeks and programs a session change touches, for the limits. */
async function sessionScope(tx: Tx, userId: string, input: SessionOp): Promise<LimitScope> {
  const mondays = new Set<string>();
  const programIds: number[] = [];
  if (input.op === "add") {
    mondays.add(mondayOf(input.date));
    programIds.push(input.programId);
  } else {
    const [row] = await tx
      .select({ date: plannedSessions.date })
      .from(plannedSessions)
      .where(and(eq(plannedSessions.id, input.id), eq(plannedSessions.userId, userId), livePlannedSessions));
    if (row?.date) mondays.add(mondayOf(row.date));
    if (input.op === "move") mondays.add(mondayOf(input.date));
    if (input.op === "change" && input.programId != null) programIds.push(input.programId);
  }
  return { programIds, cycleIds: [], sessionWeeks: { userId, mondays: [...mondays].sort() } };
}

async function sessionOpBody(w: PlanWriteSession, ctx: PlanWriteContext, input: SessionOp, today: string): Promise<PlannedRow> {
  const tx = w.tx;
  const now = new Date();
  if (input.op === "add") {
    const [cycle] = await tx
      .select()
      .from(trainingCycles)
      .where(and(eq(trainingCycles.id, input.cycleId), eq(trainingCycles.userId, ctx.userId), isNull(trainingCycles.deletedAt)));
    if (!cycle) throw new PlanNotFoundError({ type: "cycle", id: input.cycleId });
    if (cycle.scheduleType !== "day_of_week") throw new SessionInputError("Sessions can be added to a weekday cycle only.");
    const block = cycleBlock(cycle);
    if (!block) throw new SessionInputError("This cycle has no dates yet: start or schedule it first.");
    checkDate(input.date, today, block);
    await ownedProgram(tx, ctx.userId, input.programId);
    if ((await dayCount(tx, ctx.userId, input.date)) >= MAX_SLOTS_PER_DAY) {
      throw new SessionInputError(`A day holds at most ${MAX_SLOTS_PER_DAY} sessions.`);
    }
    const [row] = await tx
      .insert(plannedSessions)
      .values({
        userId: ctx.userId,
        cycleId: cycle.id,
        date: input.date,
        position: input.position ?? (await dayCount(tx, ctx.userId, input.date)) + 1,
        programId: input.programId,
        label: input.label ?? null,
        notes: input.notes ?? null,
        touchedAt: now,
      })
      .returning();
    w.create({ type: "planned_session", id: row.id });
    return row;
  }
  await w.touch({ type: "planned_session", id: input.id }, { expectedVersion: input.expectedVersion });
  const { row, cycle } = await liveRow(tx, ctx.userId, input.id);
  const block = cycleBlock(cycle);
  if (await isDone(tx, ctx.userId, row, today)) {
    throw new SessionInputError("This session is logged; past sessions do not change.");
  }
  let set: Partial<typeof plannedSessions.$inferInsert> = {};
  switch (input.op) {
    case "move": {
      if (!block) throw new SessionInputError("This cycle has no dates any more.");
      checkDate(input.date, today, block);
      if (input.date !== row.date && (await dayCount(tx, ctx.userId, input.date, row.id)) >= MAX_SLOTS_PER_DAY) {
        throw new SessionInputError(`A day holds at most ${MAX_SLOTS_PER_DAY} sessions.`);
      }
      set = { date: input.date, position: input.position ?? (input.date === row.date ? row.position : (await dayCount(tx, ctx.userId, input.date, row.id)) + 1) };
      break;
    }
    case "skip":
      set = { status: "skipped", skipReason: input.reason ?? null };
      break;
    case "unskip":
      if (row.date != null && row.date < today) throw new SessionInputError("A past session cannot be planned again; add one on a coming day instead.");
      set = { status: "planned", skipReason: null };
      break;
    case "change":
      if (input.programId != null) await ownedProgram(tx, ctx.userId, input.programId);
      set = {
        ...(input.programId != null && { programId: input.programId }),
        ...(input.label !== undefined && { label: input.label }),
        ...(input.notes !== undefined && { notes: input.notes }),
        ...(input.position !== undefined && { position: input.position }),
      };
      break;
    case "reset": {
      if (row.slotId == null || row.templateDate == null) throw new SessionInputError("This session was added by hand; remove it instead.");
      const [slot] = await tx.select().from(trainingCycleSlots).where(eq(trainingCycleSlots.id, row.slotId));
      if (!slot || slot.trainingCycleId !== row.cycleId) throw new SessionInputError("Its day is not in the template any more.");
      if (row.templateDate < today) throw new SessionInputError("A past session cannot be reset.");
      set = {
        date: row.templateDate,
        position: slot.daySlot,
        programId: slot.programId,
        label: slot.label,
        notes: slot.notes,
        autoComplete: slot.autoComplete,
        status: "planned",
        skipReason: null,
      };
      await tx.update(plannedSessions).set({ ...set, touchedAt: null, updatedAt: now }).where(eq(plannedSessions.id, row.id));
      return (await liveRow(tx, ctx.userId, row.id)).row;
    }
    case "remove":
      if (row.templateDate != null) throw new SessionInputError("A session from the template cannot be removed; skip it instead.");
      await w.touch({ type: "planned_session", id: row.id }, { action: "delete" });
      await tx.update(plannedSessions).set({ deletedAt: now, updatedAt: now }).where(eq(plannedSessions.id, row.id));
      return { ...row, deletedAt: now };
  }
  await tx.update(plannedSessions).set({ ...set, touchedAt: now, updatedAt: now }).where(eq(plannedSessions.id, row.id));
  return (await liveRow(tx, ctx.userId, row.id)).row;
}

function checkDate(date: string, today: string, block: { start: string; end: string }) {
  if (date < today) throw new SessionInputError("A session cannot move to a past day.");
  if (date < block.start || date >= block.end) {
    throw new SessionInputError(`Pick a day in the block, ${block.start} to ${addDaysStr(block.end, -1)}.`);
  }
}

/**
 * Skip or change one occurrence of a rotation cycle, by walk position (4.3).
 * The override is a stored row; `unskip` removes a skip.
 */
export async function applyRotationOp(
  ctx: PlanWriteContext,
  input: { op: "skip" | "unskip" | "change"; cycleId: number; rotationPosition: number; programId?: number; reason?: string | null; expectedVersion?: number },
): Promise<{ row: PlannedRow; version: number }> {
  const { result, versions } = await planWrite(ctx, async (w) => {
    const tx = w.tx;
    const [cycle] = await tx
      .select()
      .from(trainingCycles)
      .where(and(eq(trainingCycles.id, input.cycleId), eq(trainingCycles.userId, ctx.userId), isNull(trainingCycles.deletedAt)));
    if (!cycle) throw new PlanNotFoundError({ type: "cycle", id: input.cycleId });
    if (cycle.scheduleType !== "rotation" || cycle.status !== "active") throw new SessionInputError("This is not an active rotation cycle.");
    const [existing] = await tx
      .select()
      .from(plannedSessions)
      .where(and(eq(plannedSessions.cycleId, cycle.id), eq(plannedSessions.rotationPosition, input.rotationPosition), livePlannedSessions));
    const now = new Date();
    if (input.op === "change" && input.programId != null) await ownedProgram(tx, ctx.userId, input.programId);
    if (!existing) {
      if (input.op === "unskip") throw new SessionInputError("That session is not skipped.");
      const [row] = await tx
        .insert(plannedSessions)
        .values({
          userId: ctx.userId,
          cycleId: cycle.id,
          rotationPosition: input.rotationPosition,
          programId: input.op === "change" ? (input.programId ?? null) : null,
          status: input.op === "skip" ? "skipped" : "planned",
          skipReason: input.op === "skip" ? (input.reason ?? null) : null,
          touchedAt: now,
        })
        .returning();
      w.create({ type: "planned_session", id: row.id });
      return row;
    }
    await w.touch({ type: "planned_session", id: existing.id }, { expectedVersion: input.expectedVersion });
    if (input.op === "unskip") {
      await w.touch({ type: "planned_session", id: existing.id }, { action: "delete" });
      await tx.update(plannedSessions).set({ deletedAt: now, updatedAt: now }).where(eq(plannedSessions.id, existing.id));
      return { ...existing, deletedAt: now };
    }
    const [row] = await tx
      .update(plannedSessions)
      .set(
        input.op === "skip"
          ? { status: "skipped", skipReason: input.reason ?? null, touchedAt: now, updatedAt: now }
          : { status: "planned", programId: input.programId ?? existing.programId, touchedAt: now, updatedAt: now },
      )
      .where(eq(plannedSessions.id, existing.id))
      .returning();
    return row;
  });
  return { row: result, version: versions.get(`planned_session:${result.id}`) ?? result.version };
}

/**
 * Skip every planned session of the user on a date (the old "Decline", which
 * names a date only), or one session. Writes the old dismissal row when no
 * planned session is left that day, so an older app still hides the day.
 */
export async function declineDay(ctx: PlanWriteContext, date: string, plannedSessionId?: number): Promise<void> {
  const rows = await db
    .select({ id: plannedSessions.id })
    .from(plannedSessions)
    .innerJoin(trainingCycles, and(eq(trainingCycles.id, plannedSessions.cycleId), isNull(trainingCycles.deletedAt)))
    .where(
      and(
        eq(plannedSessions.userId, ctx.userId),
        eq(plannedSessions.date, date),
        eq(plannedSessions.status, "planned"),
        livePlannedSessions,
        plannedSessionId != null ? eq(plannedSessions.id, plannedSessionId) : undefined,
      ),
    )
    .orderBy(asc(plannedSessions.id));
  if (rows.length) {
    await planWrite(ctx, async (w) => {
      for (const r of rows) {
        await w.touch({ type: "planned_session", id: r.id });
        await w.tx
          .update(plannedSessions)
          .set({ status: "skipped", touchedAt: new Date(), updatedAt: new Date() })
          .where(eq(plannedSessions.id, r.id));
      }
    });
  }
  await dismissIfDayClear(ctx.userId, date);
}

/**
 * Write the old dismissal row for a date once no planned session is left on
 * it (hub decision 13): the app before C2 reads it, so a rollback still hides
 * the day, and rotation auto days still read it.
 */
export async function dismissIfDayClear(userId: string, date: string): Promise<void> {
  const left = await db
    .select({ id: plannedSessions.id })
    .from(plannedSessions)
    .innerJoin(trainingCycles, and(eq(trainingCycles.id, plannedSessions.cycleId), isNull(trainingCycles.deletedAt)))
    .where(and(eq(plannedSessions.userId, userId), eq(plannedSessions.date, date), eq(plannedSessions.status, "planned"), livePlannedSessions))
    .limit(1);
  if (left.length === 0) {
    await db.insert(dismissedMakeups).values({ userId, date }).onConflictDoNothing();
  }
}

/** Skip the planned session an auto day belonged to ("I skipped it"). */
export async function skipForAutoDay(ctx: PlanWriteContext, session: { plannedSessionId: number | null; programId: number | null; date: string }) {
  const rows = await db
    .select({ id: plannedSessions.id })
    .from(plannedSessions)
    .where(
      and(
        eq(plannedSessions.userId, ctx.userId),
        livePlannedSessions,
        eq(plannedSessions.status, "planned"),
        session.plannedSessionId != null
          ? eq(plannedSessions.id, session.plannedSessionId)
          : and(eq(plannedSessions.date, session.date), session.programId != null ? eq(plannedSessions.programId, session.programId) : sql`false`),
      ),
    );
  if (!rows.length) return;
  await planWrite(ctx, async (w) => {
    for (const r of rows) {
      await w.touch({ type: "planned_session", id: r.id });
      await w.tx.update(plannedSessions).set({ status: "skipped", touchedAt: new Date(), updatedAt: new Date() }).where(eq(plannedSessions.id, r.id));
    }
  });
}

/** A planned session the user may start a workout for: theirs, live, and for this program. */
export async function startablePlannedId(userId: string, plannedSessionId: number | undefined, programId: number | undefined): Promise<number | null> {
  if (plannedSessionId == null || programId == null) return null;
  const [row] = await db
    .select({ id: plannedSessions.id })
    .from(plannedSessions)
    .innerJoin(trainingCycles, and(eq(trainingCycles.id, plannedSessions.cycleId), isNull(trainingCycles.deletedAt)))
    .where(
      and(
        eq(plannedSessions.id, plannedSessionId),
        eq(plannedSessions.userId, userId),
        eq(plannedSessions.programId, programId),
        livePlannedSessions,
      ),
    );
  return row?.id ?? null;
}
