/**
 * Fuel logs, products and sweat tests on the server
 * (docs/plans/nutrition-and-race-day.md, 3, 6 and 8): one module for the
 * Server Actions and the MCP tools. Plain server code that takes a resolved
 * userId; callers check the endurance switch. Logged data: no revisions, last
 * write wins. Health data: logs carry ids only.
 *
 * A fuel log links to one completed session logged in the app, or to one of
 * the user's Garmin activities. A Garmin-linked log needs only the activity to
 * be the user's (as garmin_fuel_logs did); the caller gates the rest.
 */

import { db } from "@/db";
import { fuelLogs, fuelProducts, garminActivities, programs, sweatTests, userWeightEntries, workoutSessions, workoutSets } from "@/db/schema";
import { userToday } from "@/lib/user-settings";
import { toDateStr } from "@/lib/utils/cycle-position";
import {
  carbsPerHour,
  fluidPlan,
  gutTraining,
  itemTotals,
  sodiumPlan,
  sweatRate,
  sweatTestError,
  type FuelItem,
} from "@/lib/utils/fueling";
import { addDaysStr } from "@/lib/utils/seasons";
import { FUEL_PRODUCTS_MAX, SWEAT_TESTS_MAX, type FuelLogInput, type ProductInput, type SweatTestInput } from "@/lib/validators/nutrition";
import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";

/** A write the input or the data does not allow; the message says why. */
export class NutritionError extends Error {}

/** Sessions this long or longer get a fuel log (2.1: shorter ones need water only). */
export const FUEL_MIN_SECONDS = 3600;
/** How far back the Nutrition page lists sessions to log fuel for. */
export const FUEL_RECENT_DAYS = 14;

export type FuelLogRow = typeof fuelLogs.$inferSelect;
export type ProductRow = typeof fuelProducts.$inferSelect;
export type SweatTestRow = typeof sweatTests.$inferSelect;

// ── Products ─────────────────────────────────────────────────────────────────

export async function listProducts(userId: string): Promise<ProductRow[]> {
  return db.select().from(fuelProducts).where(eq(fuelProducts.userId, userId)).orderBy(fuelProducts.name, fuelProducts.id);
}

export async function addProduct(userId: string, input: ProductInput): Promise<ProductRow> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`fuel_products:${userId}`}))`);
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(fuelProducts).where(eq(fuelProducts.userId, userId));
    if (n >= FUEL_PRODUCTS_MAX) throw new NutritionError(`At most ${FUEL_PRODUCTS_MAX} products. Delete old ones first.`);
    const [row] = await tx
      .insert(fuelProducts)
      .values({ userId, name: input.name, carbsG: input.carbsG ?? null, sodiumMg: input.sodiumMg ?? null, caffeineMg: input.caffeineMg ?? null, fluidMl: input.fluidMl ?? null })
      .returning();
    return row;
  });
}

export async function updateProduct(userId: string, id: number, change: Partial<ProductInput>): Promise<ProductRow> {
  const set: Partial<typeof fuelProducts.$inferInsert> = { updatedAt: new Date() };
  for (const k of ["name", "carbsG", "sodiumMg", "caffeineMg", "fluidMl"] as const) if (change[k] !== undefined) (set as Record<string, unknown>)[k] = change[k];
  const [row] = await db
    .update(fuelProducts)
    .set(set)
    .where(and(eq(fuelProducts.id, id), eq(fuelProducts.userId, userId)))
    .returning();
  if (!row) throw new NutritionError("Product not found");
  return row;
}

/** A hard delete: logs keep the product's numbers in their items. */
export async function deleteProduct(userId: string, id: number): Promise<void> {
  const gone = await db.delete(fuelProducts).where(and(eq(fuelProducts.id, id), eq(fuelProducts.userId, userId))).returning({ id: fuelProducts.id });
  if (!gone.length) throw new NutritionError("Product not found");
}

// ── Fuel logs ────────────────────────────────────────────────────────────────

/** A completed app session's moving time: its timed sets, else start to end. Null when it is not the user's. */
async function sessionDuration(userId: string, sessionId: number): Promise<{ durationS: number | null } | null> {
  const [s] = await db
    .select({ startTime: workoutSessions.startTime, endTime: workoutSessions.endTime, isCompleted: workoutSessions.isCompleted })
    .from(workoutSessions)
    .where(and(eq(workoutSessions.id, sessionId), eq(workoutSessions.userId, userId)));
  if (!s || !s.isCompleted) return null;
  const [{ total }] = await db
    .select({ total: sql<number | null>`sum(${workoutSets.durationSeconds})::int` })
    .from(workoutSets)
    .where(and(eq(workoutSets.sessionId, sessionId), eq(workoutSets.isCompleted, true)));
  if (total && total > 0) return { durationS: total };
  if (s.endTime) return { durationS: Math.max(0, Math.round((s.endTime.getTime() - s.startTime.getTime()) / 1000)) || null };
  return { durationS: null };
}

/** A Garmin activity's duration. Null when it is not the user's. */
async function activityDuration(userId: string, garminActivityId: number): Promise<{ durationS: number | null } | null> {
  const [a] = await db
    .select({ duration: sql<number | null>`case when jsonb_typeof(${garminActivities.data}->'duration') = 'number' then round((${garminActivities.data}->>'duration')::float8)::int end` })
    .from(garminActivities)
    .where(and(eq(garminActivities.userId, userId), eq(garminActivities.garminActivityId, garminActivityId)));
  return a ? { durationS: a.duration } : null;
}

/** The user's products for these ids, as log items. Throws when one is not theirs. */
async function resolveItems(userId: string, items: { productId: number; count: number }[]): Promise<FuelItem[]> {
  if (!items.length) return [];
  const rows = await db
    .select()
    .from(fuelProducts)
    .where(and(eq(fuelProducts.userId, userId), inArray(fuelProducts.id, [...new Set(items.map((i) => i.productId))])));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return items.map((i) => {
    const p = byId.get(i.productId);
    if (!p) throw new NutritionError(`Product ${i.productId} not found`);
    return { productId: p.id, name: p.name, count: i.count, carbsG: p.carbsG, sodiumMg: p.sodiumMg, caffeineMg: p.caffeineMg, fluidMl: p.fluidMl };
  });
}

/**
 * Save or clear the fuel log of one session. With products, a total that is
 * not typed is their sum. `clear` (or nothing at all) deletes the log.
 */
export async function saveFuelLog(userId: string, input: FuelLogInput): Promise<FuelLogRow | null> {
  const link =
    input.workoutSessionId != null
      ? await sessionDuration(userId, input.workoutSessionId)
      : await activityDuration(userId, input.garminActivityId!);
  if (!link) throw new NutritionError(input.workoutSessionId != null ? "Session not found" : "Activity not found");
  const where = and(
    eq(fuelLogs.userId, userId),
    input.workoutSessionId != null ? eq(fuelLogs.workoutSessionId, input.workoutSessionId) : eq(fuelLogs.garminActivityId, input.garminActivityId!),
  );
  const items = await resolveItems(userId, input.items ?? []);
  const sums = itemTotals(items);
  const pick = (typed: number | null | undefined, summed: number | null) => (typed != null ? typed : items.length ? summed : null);
  const values = {
    carbsG: pick(input.carbsG, sums.carbsG),
    fluidMl: pick(input.fluidMl, sums.fluidMl),
    sodiumMg: pick(input.sodiumMg, sums.sodiumMg),
    caffeineMg: pick(input.caffeineMg, sums.caffeineMg),
    giScore: input.giScore ?? null,
    items: items.length ? items : null,
    notes: input.notes ?? null,
  };
  const empty = Object.values(values).every((v) => v == null);
  if (input.clear || empty) {
    await db.delete(fuelLogs).where(where);
    return null;
  }
  const [row] = await db
    .insert(fuelLogs)
    .values({
      userId,
      workoutSessionId: input.workoutSessionId ?? null,
      garminActivityId: input.garminActivityId ?? null,
      durationS: link.durationS,
      ...values,
    })
    .onConflictDoUpdate({
      target: input.workoutSessionId != null ? [fuelLogs.userId, fuelLogs.workoutSessionId] : [fuelLogs.userId, fuelLogs.garminActivityId],
      set: { durationS: link.durationS, ...values, updatedAt: new Date() },
    })
    .returning();
  return row;
}

export type FuelLogView = FuelLogRow & { day: string; name: string; carbsPerHour: number | null };

/** The user's fuel logs from this day on, newest first, with the session's day and name. */
export async function listFuelLogs(userId: string, fromDay?: string): Promise<FuelLogView[]> {
  const rows = await db
    .select({
      log: fuelLogs,
      sessionDate: workoutSessions.date,
      sessionNotes: workoutSessions.notes,
      garminStart: garminActivities.startTimeLocal,
      garminName: sql<string | null>`${garminActivities.data}->>'activityName'`,
    })
    .from(fuelLogs)
    .leftJoin(workoutSessions, eq(workoutSessions.id, fuelLogs.workoutSessionId))
    .leftJoin(garminActivities, and(eq(garminActivities.userId, fuelLogs.userId), eq(garminActivities.garminActivityId, fuelLogs.garminActivityId)))
    .where(eq(fuelLogs.userId, userId));
  return rows
    .map((r) => ({
      ...r.log,
      day: r.sessionDate ?? (r.garminStart ? r.garminStart.toISOString().slice(0, 10) : r.log.createdAt.toISOString().slice(0, 10)),
      name: r.log.workoutSessionId != null ? "Session" : (r.garminName ?? "Garmin activity"),
      carbsPerHour: carbsPerHour(r.log),
    }))
    .filter((r) => !fromDay || r.day >= fromDay)
    .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : b.id - a.id));
}

export type FuelSessionView = { id: number; date: string; name: string; durationS: number; log: FuelLogRow | null };

/** Completed app sessions of the last 14 days with an hour or more of timed sets, newest first. */
export async function sessionsForFuel(userId: string, today: string): Promise<FuelSessionView[]> {
  const from = addDaysStr(today, -FUEL_RECENT_DAYS);
  const rows = await db
    .select({
      id: workoutSessions.id,
      date: workoutSessions.date,
      programName: programs.name,
      durationS: sql<number>`coalesce(sum(${workoutSets.durationSeconds}), 0)::int`,
    })
    .from(workoutSessions)
    .innerJoin(workoutSets, and(eq(workoutSets.sessionId, workoutSessions.id), eq(workoutSets.isCompleted, true), isNotNull(workoutSets.durationSeconds)))
    // plan-read: includes deleted (a logged session keeps its program's name)
    .leftJoin(programs, eq(programs.id, workoutSessions.programId))
    .where(and(eq(workoutSessions.userId, userId), eq(workoutSessions.isCompleted, true), gte(workoutSessions.date, from)))
    .groupBy(workoutSessions.id, programs.name)
    .having(sql`sum(${workoutSets.durationSeconds}) >= ${FUEL_MIN_SECONDS}`)
    .orderBy(desc(workoutSessions.date), desc(workoutSessions.id));
  if (!rows.length) return [];
  const logs = await db
    .select()
    .from(fuelLogs)
    .where(and(eq(fuelLogs.userId, userId), inArray(fuelLogs.workoutSessionId, rows.map((r) => r.id))));
  const bySession = new Map(logs.map((l) => [l.workoutSessionId!, l]));
  return rows.map((r) => ({ id: r.id, date: r.date, name: r.programName ?? "Workout", durationS: r.durationS, log: bySession.get(r.id) ?? null }));
}

// ── Sweat tests ──────────────────────────────────────────────────────────────

export async function listSweatTests(userId: string): Promise<(SweatTestRow & ReturnType<typeof sweatRate>)[]> {
  const rows = await db.select().from(sweatTests).where(eq(sweatTests.userId, userId)).orderBy(desc(sweatTests.testedOn), desc(sweatTests.id));
  return rows.map((r) => ({ ...r, ...sweatRate({ durationS: r.durationS, preKg: r.preKg, postKg: r.postKg, fluidMl: r.fluidMl, urineMl: r.urineMl }) }));
}

export async function addSweatTest(userId: string, input: SweatTestInput): Promise<SweatTestRow> {
  const durationS = Math.round(input.durationMinutes * 60);
  const err = sweatTestError({ durationS, preKg: input.preKg, postKg: input.postKg, fluidMl: input.fluidMl, urineMl: input.urineMl });
  if (err) throw new NutritionError(err);
  const today = toDateStr(await userToday(userId));
  const testedOn = input.testedOn ?? today;
  if (testedOn > today) throw new NutritionError("A sweat test is on today or earlier.");
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`sweat_tests:${userId}`}))`);
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(sweatTests).where(eq(sweatTests.userId, userId));
    if (n >= SWEAT_TESTS_MAX) throw new NutritionError(`At most ${SWEAT_TESTS_MAX} sweat tests. Delete old ones first.`);
    const [row] = await tx
      .insert(sweatTests)
      .values({
        userId,
        testedOn,
        durationS,
        preKg: input.preKg,
        postKg: input.postKg,
        fluidMl: input.fluidMl,
        urineMl: input.urineMl ?? null,
        temperatureC: input.temperatureC ?? null,
        sport: input.sport ?? null,
        sweatSodiumMgL: input.sweatSodiumMgL ?? null,
        notes: input.notes ?? null,
      })
      .returning();
    return row;
  });
}

export async function deleteSweatTest(userId: string, id: number): Promise<void> {
  const gone = await db.delete(sweatTests).where(and(eq(sweatTests.id, id), eq(sweatTests.userId, userId))).returning({ id: sweatTests.id });
  if (!gone.length) throw new NutritionError("Sweat test not found");
}

// ── The summary ──────────────────────────────────────────────────────────────

export async function latestWeightKg(userId: string): Promise<number | null> {
  const [w] = await db
    .select({ kg: userWeightEntries.weightKg })
    .from(userWeightEntries)
    .where(eq(userWeightEntries.userId, userId))
    .orderBy(desc(userWeightEntries.recordedAt))
    .limit(1);
  return w?.kg ?? null;
}

/** The test nearest a temperature when one is given and tests carry one; else the newest. */
export function pickSweatTest<T extends { temperatureC: number | null }>(tests: T[], temperatureC: number | null): T | null {
  if (!tests.length) return null;
  if (temperatureC == null) return tests[0];
  const withTemp = tests.filter((t) => t.temperatureC != null);
  if (!withTemp.length) return tests[0];
  return withTemp.reduce((best, t) => (Math.abs(t.temperatureC! - temperatureC) < Math.abs(best.temperatureC! - temperatureC) ? t : best));
}

/** Gut training, fluid and sodium from the user's logs and tests. */
export async function nutritionSummary(userId: string, temperatureC: number | null = null) {
  const [logs, tests] = await Promise.all([listFuelLogs(userId), listSweatTests(userId)]);
  const gut = gutTraining(logs.map((l) => ({ durationS: l.durationS, carbsG: l.carbsG, giScore: l.giScore, day: l.day })));
  const test = pickSweatTest(tests, temperatureC);
  const fluid = fluidPlan(test ? test.mlPerHour : null);
  const sodium = sodiumPlan(fluid, test?.sweatSodiumMgL ?? null);
  return { logs, tests, gut, test, fluid, sodium };
}
