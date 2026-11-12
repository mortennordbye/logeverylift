import { eq } from "drizzle-orm";
import { garminActivities, garminDays, users } from "../src/db/schema";
import { e2eUser } from "./fixtures/env";
import { testDb } from "./fixtures/reset";
import { expect, test } from "./fixtures/test";

/**
 * Every Garmin page renders without a page exception. Garmin is the owner's
 * tool (src/lib/garmin/access.ts): on for admin accounts only. The e2e
 * account is made an admin for this spec and a normal user again after it.
 */

const ACTIVITY_ID = 900_001;
const NOT_FOUND = "This page isn't here anymore";

async function me(workerIndex: number) {
  const [u] = await testDb().select({ id: users.id }).from(users).where(eq(users.email, e2eUser(workerIndex).email));
  return u.id;
}

async function clearGarmin(userId: string) {
  const db = testDb();
  await db.delete(garminDays).where(eq(garminDays.userId, userId));
  await db.delete(garminActivities).where(eq(garminActivities.userId, userId));
}

test.afterEach(async ({}, testInfo) => {
  const userId = await me(testInfo.parallelIndex);
  await clearGarmin(userId);
  await testDb().update(users).set({ role: "user" }).where(eq(users.id, userId));
});

test("an admin can open every Garmin tab, the race page and an activity", async ({ page, context }, testInfo) => {
  const userId = await me(testInfo.parallelIndex);
  const db = testDb();
  await db.update(users).set({ role: "admin" }).where(eq(users.id, userId));
  // Better Auth caches the session, role included, in a cookie for 5 minutes; drop it so the new role is read.
  await context.clearCookies({ name: /session_data/ });
  const today = new Date().toISOString().slice(0, 10);
  await db.insert(garminDays).values([
    { userId, calendarDate: today, kind: "sleep", data: { sleepTimeSeconds: 28000, sleepScores: { overall: { value: 81 } } } },
    { userId, calendarDate: today, kind: "user_summary", data: { totalSteps: 8000, bodyBatteryAtWakeTime: 90 } },
  ]);
  await db.insert(garminActivities).values({
    userId,
    garminActivityId: ACTIVITY_ID,
    startTimeLocal: new Date(),
    activityType: "running",
    data: { activityName: "E2E run", duration: 1800, distance: 5000, averageHR: 150 },
  });

  for (const tab of ["overview", "day", "training", "recovery", "activities", "trends"]) {
    await page.goto(`/more/garmin?tab=${tab}`);
    await expect(page.getByRole("heading", { name: "Garmin", exact: true, level: 1 })).toBeVisible();
  }
  await page.goto("/more/garmin?tab=activities");
  await expect(page.getByText("E2E run")).toBeVisible();
  await page.goto("/more/garmin/race");
  await expect(page.getByRole("heading", { name: NOT_FOUND })).toHaveCount(0);
  await page.goto(`/more/garmin/activity/${ACTIVITY_ID}`);
  await expect(page.getByRole("heading", { name: "E2E run" })).toBeVisible();
});

test("a normal account cannot open Garmin", async ({ page }) => {
  // The page streams, so the status is sent before notFound() runs: check the 404 screen instead.
  await page.goto("/more/garmin");
  await expect(page.getByRole("heading", { name: NOT_FOUND })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Garmin", exact: true })).toHaveCount(0);
});
