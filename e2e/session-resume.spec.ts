import { and, eq } from "drizzle-orm";
import { workoutSessions } from "../src/db/schema";
import { expect, test } from "./fixtures/test";
import { testDb } from "./fixtures/reset";
import { openFirstExercise, openWorkout, trackActions, waitForLiveSession } from "./helpers";

/**
 * A fresh sign-in (or a second phone) has no stored workout. The steps journey
 * review (2026-11-16) found that the workout page then opened a new empty
 * session beside the open one. It must resume the open one.
 */
test("a workout page with no stored workout resumes the open workout of its program", async ({ page }) => {
  const settle = trackActions(page);
  await openWorkout(page);
  await openFirstExercise(page);
  await waitForLiveSession(page);
  await page.getByRole("button", { name: "Log set 1", exact: true }).click();
  await expect(page.getByRole("button", { name: "Un-log set 1", exact: true })).toBeVisible();
  await settle();

  const storedSession = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem("activeWorkout") ?? "{}").sessionId as number);
  const sessionId = await storedSession();
  const [{ userId }] = await testDb()
    .select({ userId: workoutSessions.userId })
    .from(workoutSessions)
    .where(eq(workoutSessions.id, sessionId));

  // As after a fresh sign-in: the phone holds no workout.
  await page.evaluate(() => localStorage.removeItem("activeWorkout"));
  await page.reload();
  await waitForLiveSession(page);
  await settle();

  expect(await storedSession()).toBe(sessionId);
  await expect(page.getByRole("button", { name: "Un-log set 1", exact: true })).toBeVisible();
  const open = await testDb()
    .select({ id: workoutSessions.id })
    .from(workoutSessions)
    .where(and(eq(workoutSessions.userId, userId), eq(workoutSessions.isCompleted, false)));
  expect(open).toEqual([{ id: sessionId }]);
});
