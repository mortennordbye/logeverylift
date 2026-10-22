import { and, eq } from "drizzle-orm";
import { programSets, workoutSessions, workoutSets } from "../src/db/schema";
import { testDb } from "./fixtures/reset";
import { expect, test } from "./fixtures/test";
import { openWorkout, trackActions, waitForLiveSession } from "./helpers";

/**
 * A workout from the first tap to the finished session in history, and the
 * same thing with the connection dropping halfway. Each checks what reached
 * the database, not only what the screen shows.
 */

async function sessionId(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() => JSON.parse(localStorage.getItem("activeWorkout") ?? "{}").sessionId as number);
}

test("tick an exercise, finish, and the session is in history with its sets", async ({ page }) => {
  const settle = trackActions(page);
  await openWorkout(page);
  await waitForLiveSession(page);
  const id = await sessionId(page);

  const first = page.getByTestId("exercise-row").first();
  const name = await first.getByRole("paragraph").first().innerText();
  const planned = await testDb()
    .select({ id: programSets.id })
    .from(programSets)
    .where(eq(programSets.programExerciseId, Number(await first.getAttribute("data-program-exercise-id"))));
  expect(planned.length).toBeGreaterThan(0);

  await page.getByRole("button", { name: `Mark ${name} as done`, exact: true }).click();
  await expect(page.getByRole("button", { name: `Mark ${name} as not done`, exact: true })).toBeVisible();
  await settle();

  const logged = await testDb().select().from(workoutSets).where(eq(workoutSets.sessionId, id));
  expect(logged.map((r) => r.programSetId).sort()).toEqual(planned.map((p) => p.id).sort());

  await page.getByRole("button", { name: "Finished", exact: true }).click();
  await page.getByRole("button", { name: "Yes, finish", exact: true }).click();
  await expect(page).toHaveURL(/\/workout\/finish/);
  await page.getByRole("button", { name: "Save Workout" }).click();
  await page.getByRole("button", { name: "Yes, save", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await settle();

  const [session] = await testDb().select().from(workoutSessions).where(eq(workoutSessions.id, id));
  expect(session.isCompleted).toBe(true);

  await page.goto("/history");
  const row = page.locator(`a[href="/history/${id}"]`);
  await expect(row).toBeVisible();
  await expect(row).toContainText(`${planned.length} sets`);
});

test("sets logged offline are saved once the connection is back", async ({ page, context }) => {
  const settle = trackActions(page);
  await openWorkout(page);
  await waitForLiveSession(page);
  const id = await sessionId(page);
  const first = page.getByTestId("exercise-row").first();
  const href = await first.getByRole("link").getAttribute("href");
  await page.goto(href!);
  await expect(page.getByTestId("set-row").first()).toBeVisible();
  const setId = Number(await page.getByTestId("set-row").first().getAttribute("data-set-id"));

  await context.setOffline(true);
  await page.getByRole("button", { name: "Log set 1", exact: true }).click();
  await expect(page.getByText(/Offline — saved locally/)).toBeVisible();
  expect(await testDb().select().from(workoutSets).where(eq(workoutSets.sessionId, id))).toHaveLength(0);

  await context.setOffline(false);
  // The provider replays on the browser's `online` event.
  await expect
    .poll(async () =>
      (
        await testDb()
          .select()
          .from(workoutSets)
          .where(and(eq(workoutSets.sessionId, id), eq(workoutSets.programSetId, setId)))
      ).length,
    { timeout: 15_000 })
    .toBe(1);
  await settle();
  await expect(page.getByText(/Synced 1 pending set/)).toBeVisible();

  // And the set still shows logged after a reload, from the server's rows.
  await page.reload();
  await expect(
    page.locator(`[data-testid="set-row"][data-set-id="${setId}"]`).getByRole("button", { name: /Un-log set/ }),
  ).toBeVisible();
});
