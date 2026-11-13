/**
 * Sick periods on the server (docs/plans/workouts-and-compliance.md, 6.7;
 * decision D20): one entry per period. Sessions inside it read as missed by
 * illness on read; nothing on the sessions changes. Every write is a revision
 * (object type `illness`). Health data: logs carry ids only.
 *
 * Plain server code: callers resolve the user and check the endurance switch.
 */

import { db } from "@/db";
import { illnessPeriods, ILLNESS_SEVERITIES } from "@/db/schema";
import { assertAthleteRoom, assertNoIllnessOverlap, planWrite, PlanNotFoundError, PlanStateError, type PlanWriteContext } from "@/lib/plan-revisions";
import { userToday } from "@/lib/user-settings";
import { toDateStr } from "@/lib/utils/cycle-position";
import { addDaysStr } from "@/lib/utils/seasons";
import { and, desc, eq, isNull, sql } from "drizzle-orm";

export type IllnessSeverity = (typeof ILLNESS_SEVERITIES)[number];
export type IllnessRow = typeof illnessPeriods.$inferSelect;

/** How far ahead a planned last day may be ("sick until Sunday"). */
export const ILLNESS_END_AHEAD_DAYS = 14;

/** The user's live sick periods, newest first. */
export async function listIllness(userId: string): Promise<IllnessRow[]> {
  return db
    .select()
    .from(illnessPeriods)
    .where(and(eq(illnessPeriods.userId, userId), isNull(illnessPeriods.deletedAt)))
    .orderBy(desc(illnessPeriods.startedOn), desc(illnessPeriods.id));
}

function checkDates(startedOn: string, endedOn: string | null, today: string) {
  if (startedOn > today) throw new PlanStateError("A sick period starts today or earlier.");
  if (endedOn != null && endedOn < startedOn) throw new PlanStateError("The last sick day is on or after the first.");
  if (endedOn != null && endedOn > addDaysStr(today, ILLNESS_END_AHEAD_DAYS)) {
    throw new PlanStateError(`The last sick day is at most ${ILLNESS_END_AHEAD_DAYS} days ahead.`);
  }
}

export type IllnessInput = { startedOn: string; endedOn?: string | null; severity?: IllnessSeverity | null; notes?: string | null };

export async function addIllness(ctx: PlanWriteContext, input: IllnessInput): Promise<{ id: number; version: number }> {
  const today = toDateStr(await userToday(ctx.userId));
  checkDates(input.startedOn, input.endedOn ?? null, today);
  const { result, versions } = await planWrite(ctx, async (w) => {
    await assertAthleteRoom(w.tx, ctx.userId, "illness");
    await assertNoIllnessOverlap(w.tx, ctx.userId, input.startedOn, input.endedOn ?? null);
    const [row] = await w.tx
      .insert(illnessPeriods)
      .values({ userId: ctx.userId, startedOn: input.startedOn, endedOn: input.endedOn ?? null, severity: input.severity ?? null, notes: input.notes ?? null })
      .returning({ id: illnessPeriods.id });
    w.create({ type: "illness", id: row.id });
    return row.id;
  });
  return { id: result, version: versions.get(`illness:${result}`) ?? 1 };
}

export async function updateIllness(
  ctx: PlanWriteContext,
  id: number,
  input: Partial<IllnessInput> & { expectedVersion?: number },
): Promise<{ id: number; version: number }> {
  const today = toDateStr(await userToday(ctx.userId));
  const { versions } = await planWrite(ctx, async (w) => {
    // The cap lock first, as every illness write takes it: the overlap check reads every period.
    await w.tx.execute(sqlLock(ctx.userId));
    await w.touch({ type: "illness", id }, { expectedVersion: input.expectedVersion });
    const [row] = await w.tx.select().from(illnessPeriods).where(and(eq(illnessPeriods.id, id), eq(illnessPeriods.userId, ctx.userId), isNull(illnessPeriods.deletedAt)));
    if (!row) throw new PlanNotFoundError({ type: "illness", id });
    const startedOn = input.startedOn ?? row.startedOn;
    const endedOn = input.endedOn !== undefined ? input.endedOn : row.endedOn;
    checkDates(startedOn, endedOn, today);
    await assertNoIllnessOverlap(w.tx, ctx.userId, startedOn, endedOn, id);
    await w.tx
      .update(illnessPeriods)
      .set({
        startedOn,
        endedOn,
        ...(input.severity !== undefined && { severity: input.severity }),
        ...(input.notes !== undefined && { notes: input.notes }),
        updatedAt: new Date(),
      })
      .where(eq(illnessPeriods.id, id));
  });
  return { id, version: versions.get(`illness:${id}`) ?? 0 };
}

export async function deleteIllness(ctx: PlanWriteContext, id: number, expectedVersion?: number): Promise<void> {
  await planWrite(ctx, async (w) => {
    await w.touch({ type: "illness", id }, { expectedVersion, action: "delete" });
    const [row] = await w.tx.select({ id: illnessPeriods.id }).from(illnessPeriods).where(and(eq(illnessPeriods.id, id), eq(illnessPeriods.userId, ctx.userId), isNull(illnessPeriods.deletedAt)));
    if (!row) throw new PlanNotFoundError({ type: "illness", id });
    await w.tx.update(illnessPeriods).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(illnessPeriods.id, id));
  });
}

function sqlLock(userId: string) {
  return sql`SELECT pg_advisory_xact_lock(hashtext(${`athlete_illness:${userId}`}))`;
}
