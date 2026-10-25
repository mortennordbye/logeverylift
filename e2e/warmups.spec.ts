import { asc, eq } from "drizzle-orm";
import { workoutSets } from "../src/db/schema";
import { expect, test } from "./fixtures/test";
import { testDb } from "./fixtures/reset";
import { openWorkout, trackActions, waitForLiveSession } from "./helpers";

/**
 * Plate line and warm-up generator on a barbell exercise, mid-workout.
 *
 * The seed's Bench Press is 4 × 8 at 80 kg, so the ramp is 20, 32.5, 47.5 and
 * 65 kg. A working set is logged before the warm-ups go in, because inserting
 * sets in front of a logged one is what could detach it.
 */
test("generating warm-ups mid-workout keeps the logged set and logs the warm-up", async ({ page }) => {
  const settle = trackActions(page);
  await openWorkout(page);
  await page.locator('a[href*="/exercises/"]', { hasText: "Bench Press" }).first().click();
  await page.waitForURL(/\/workout\/exercises\/\d+$/);
  await waitForLiveSession(page);

  const rows = page.getByTestId("set-row");
  await expect(rows).toHaveCount(4);
  await expect(rows.first().getByTestId("set-plates")).toHaveText("25 + 5 per side");
  const firstWorkingId = Number(await rows.first().getAttribute("data-set-id"));

  await page.getByRole("button", { name: "Log set 1", exact: true }).click();
  await expect(page.getByRole("button", { name: "Un-log set 1", exact: true })).toBeVisible();
  await settle();

  await page.getByRole("button", { name: "Generate warm-ups" }).click();
  await expect(rows).toHaveCount(8);
  await expect(page.getByRole("button", { name: "Generate warm-ups" })).toHaveCount(0);
  await expect(rows.first()).toContainText("Warm-up");
  await expect(rows.first().getByTestId("set-prescription")).toHaveText("10 x 20kg");
  await expect(rows.first().getByTestId("set-plates")).toHaveText("Empty bar");
  await expect(rows.nth(3).getByTestId("set-prescription")).toHaveText("2 x 65kg");

  // The logged working set moved down with its row and is still logged.
  await expect(rows.nth(4)).toHaveAttribute("data-set-id", String(firstWorkingId));
  await expect(page.getByRole("button", { name: "Un-log set 5", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Log set 1", exact: true }).click();
  await expect(page.getByRole("button", { name: "Un-log set 1", exact: true })).toBeVisible();
  await settle();

  const sessionId = await page.evaluate(
    () => JSON.parse(localStorage.getItem("activeWorkout") ?? "{}").sessionId as number,
  );
  const logged = await testDb()
    .select()
    .from(workoutSets)
    .where(eq(workoutSets.sessionId, sessionId))
    .orderBy(asc(workoutSets.setNumber));
  expect(logged.map((r) => [r.setNumber, r.setType, r.weightKg])).toEqual([
    [1, "warmup", "20.00"],
    [5, "working", "80.00"],
  ]);
  expect(logged[1].programSetId).toBe(firstWorkingId);
});
