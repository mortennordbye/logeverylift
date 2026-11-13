import { and, eq } from "drizzle-orm";
import {
  exercises,
  garminConnections,
  garminDailyMetrics,
  planRevisions,
  plannedSessions,
  programExercises,
  programSets,
  programs,
  trainingCycles,
  users,
  workoutSessions,
} from "../src/db/schema";
import { e2eUser } from "./fixtures/env";
import { testDb } from "./fixtures/reset";
import { expect, test } from "./fixtures/test";

/**
 * The readiness swap and the heavy-legs line
 * (docs/plans/limits-strength-readiness.md, 4 and 5). On a low-readiness
 * morning (Garmin, admins only) home offers to make today's hard session
 * easy; the tap writes the easy workout and an `apply` revision. A lifter
 * sees no card. The calendar marks heavy legs the day before a key run.
 * The browser and the user are in Auckland, so a day label that the server
 * and the browser worked out apart would differ from UTC.
 */

const ZONE = "Pacific/Auckland";
test.use({ timezoneId: ZONE });

/** `YYYY-MM-DD` in the user's zone, `offset` days from today. */
function dayStr(offset: number): string {
  const d = new Date(Date.now() + offset * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

async function me(parallelIndex: number) {
  const [u] = await testDb().select({ id: users.id }).from(users).where(eq(users.email, e2eUser(parallelIndex).email));
  return u.id;
}

async function clearGarmin(userId: string) {
  const db = testDb();
  await db.delete(garminDailyMetrics).where(eq(garminDailyMetrics.userId, userId));
  await db.delete(garminConnections).where(eq(garminConnections.userId, userId));
}

test.afterEach(async ({}, testInfo) => {
  const userId = await me(testInfo.parallelIndex);
  await clearGarmin(userId);
  await testDb().update(users).set({ role: "user", enduranceEnabled: false }).where(eq(users.id, userId));
});

/** A cycle around today in the user's zone, with these dated sessions. */
async function cycleWith(userId: string, rows: Omit<typeof plannedSessions.$inferInsert, "userId" | "cycleId">[]) {
  const db = testDb();
  await db.delete(workoutSessions).where(eq(workoutSessions.userId, userId));
  await db.delete(trainingCycles).where(eq(trainingCycles.userId, userId));
  const [cycle] = await db
    .insert(trainingCycles)
    .values({ userId, name: "Tri block", durationWeeks: 4, status: "active", startDate: dayStr(-7), sessionsGeneratedAt: new Date() })
    .returning();
  const ids: number[] = [];
  for (const r of rows) {
    const [row] = await db.insert(plannedSessions).values({ ...r, userId, cycleId: cycle.id }).returning({ id: plannedSessions.id });
    ids.push(row.id);
  }
  return ids;
}

const thresholdRide = {
  v: 1,
  sport: "bike",
  name: "Threshold ride",
  steps: [
    { type: "warmup", end: { type: "time", seconds: 600 } },
    { type: "repeat", count: 3, steps: [{ type: "work", end: { type: "time", seconds: 600 } }, { type: "recovery", end: { type: "time", seconds: 300 } }] },
  ],
};

async function lowReadiness(userId: string) {
  const db = testDb();
  await db.insert(garminConnections).values({ userId, encryptedKey: "e2e", lastSyncedAt: new Date(), historyDone: true, recentDetailAt: new Date() });
  const metrics = { hrv: { ms: 40, state: "fatigued", mean7: 48, bandLow: 52, bandHigh: 68 }, restingHr: { flag: true, mean7: 56, baseline: 50 } };
  await db.insert(garminDailyMetrics).values([
    { userId, day: dayStr(-1), modelVersion: 1, metrics },
    { userId, day: dayStr(0), modelVersion: 1, metrics },
  ]);
}

test("a low-readiness morning offers to make today's hard ride easy; the tap writes it as a revision", async ({ page, context }, testInfo) => {
  const userId = await me(testInfo.parallelIndex);
  const db = testDb();
  await db.update(users).set({ role: "admin", enduranceEnabled: true, timeZone: ZONE }).where(eq(users.id, userId));
  // Better Auth caches the session, role included, in a cookie; drop it so the new role is read.
  await context.clearCookies({ name: /session_data/ });
  const [rideId] = await cycleWith(userId, [{ date: dayStr(0), label: "Threshold ride", workout: thresholdRide }]);
  await lowReadiness(userId);

  await page.goto("/");
  const card = page.getByTestId("readiness-swap");
  await expect(card).toBeVisible();
  await expect(card).toContainText("HRV 7-day mean 48 ms is below your band (52-68) for 2 days and resting HR is 6 bpm over your normal 50");
  await expect(card).toContainText('Make "Threshold ride" an easy 55 min zone 2 session?');

  await card.getByRole("button", { name: "Make it easy" }).click();
  await expect(card).toBeHidden();
  await expect
    .poll(async () => {
      const [row] = await db.select().from(plannedSessions).where(eq(plannedSessions.id, rideId));
      return (row.workout as { name?: string } | null)?.name;
    })
    .toBe("Easy bike (readiness)");
  const [rev] = await db
    .select()
    .from(planRevisions)
    .where(and(eq(planRevisions.objectType, "planned_session"), eq(planRevisions.objectId, rideId), eq(planRevisions.writer, "apply")));
  expect(rev.reason).toContain("Readiness:");
});

test("a lifter with the same readings sees no card", async ({ page, context }, testInfo) => {
  const userId = await me(testInfo.parallelIndex);
  await testDb().update(users).set({ role: "admin", enduranceEnabled: false, timeZone: ZONE }).where(eq(users.id, userId));
  await context.clearCookies({ name: /session_data/ });
  await cycleWith(userId, [{ date: dayStr(0), label: "Threshold ride", workout: thresholdRide }]);
  await lowReadiness(userId);
  await page.goto("/");
  await expect(page.getByText("Tri block")).toBeVisible();
  await expect(page.getByTestId("readiness-swap")).toHaveCount(0);
});

test("the calendar marks heavy legs the day before a key run", async ({ page }, testInfo) => {
  const userId = await me(testInfo.parallelIndex);
  const db = testDb();
  await db.update(users).set({ enduranceEnabled: true, timeZone: ZONE }).where(eq(users.id, userId));
  const [squat] = await db
    .insert(exercises)
    .values({ name: `E2E squat ${Date.now()}`, category: "strength", isCustom: true, userId, bodyArea: "lower_body", movementPattern: "squat", equipment: "barbell" })
    .returning();
  const [legs] = await db.insert(programs).values({ userId, name: "Leg day" }).returning();
  const [pe] = await db.insert(programExercises).values({ programId: legs.id, exerciseId: squat.id, orderIndex: 0 }).returning();
  await db.insert(programSets).values([1, 2, 3, 4].map((n) => ({ programExerciseId: pe.id, setNumber: n, targetReps: 5 })));
  // Two days in this month, so the calendar shows them without paging.
  const first = dayStr(0).slice(0, 7) === dayStr(1).slice(0, 7) ? 0 : -1;
  const liftDay = dayStr(first);
  const keyDay = dayStr(first + 1);
  await cycleWith(userId, [
    { date: liftDay, programId: legs.id },
    { date: keyDay, label: "Long run", priority: "key", workout: { v: 1, sport: "run", name: "Long run", steps: [{ type: "work", end: { type: "time", seconds: 6000 } }] } },
  ]);

  await page.goto("/more/calendar");
  await page.getByTestId(`day-${liftDay}`).click();
  const line = page.getByTestId("heavy-legs-line");
  await expect(line).toHaveCount(1);
  await expect(line).toContainText('Heavy legs 1 day before key "Long run"');
});
