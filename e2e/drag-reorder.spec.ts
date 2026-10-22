import type { Locator, Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { workoutSets } from "../src/db/schema";
import { expect, test } from "./fixtures/test";
import { testDb } from "./fixtures/reset";
import { openFirstExercise, openWorkout, trackActions, waitForLiveSession } from "./helpers";

/**
 * Drag-to-reorder, mid-workout, with real pointer drags.
 *
 * Asserted three ways: the order on screen, the order after a reload (what the
 * server saved), and the rows in workout_sets (what got logged against which
 * set). The last is the one that matters: logged sets used to be keyed by
 * position, so a set logged before a drag had its row overwritten by the set
 * that later took its place, and the screen gave no sign of it until history.
 */

/**
 * Drag `handle` onto `target` the way a finger does: press, travel past dnd-kit's
 * 8 px activation distance in small steps, release over the target.
 */
async function drag(page: Page, handle: Locator, target: Locator) {
  const from = await handle.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error("drag endpoints not visible");
  const x = from.x + from.width / 2;
  await page.mouse.move(x, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, from.y + from.height / 2 + 12, { steps: 4 });
  await page.mouse.move(x, to.y + to.height / 2, { steps: 20 });
  // Let dnd-kit settle the drop position before releasing.
  await page.waitForTimeout(150);
  await page.mouse.up();
}

/** Tap Done and wait until edit mode has really ended. */
async function leaveEditMode(page: Page) {
  const done = page.getByRole("button", { name: "Done", exact: true });
  // A tap that lands while the drop animation is finishing can be swallowed.
  await expect(async () => {
    if (await done.isVisible()) await done.click();
    await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
}

/** Set ids in on-screen order, once the set list has rendered. */
async function setIds(page: Page): Promise<number[]> {
  // The URL changes before the new route paints, so a read straight after
  // navigating can still see the previous screen.
  await expect(page.getByTestId("set-row").first()).toBeVisible();
  return page.getByTestId("set-row").evaluateAll((rows) => rows.map((r) => Number(r.getAttribute("data-set-id"))));
}

async function exerciseIds(page: Page): Promise<number[]> {
  await expect(page.getByTestId("exercise-row").first()).toBeVisible();
  return page
    .getByTestId("exercise-row")
    .evaluateAll((rows) => rows.map((r) => Number(r.getAttribute("data-program-exercise-id"))));
}

async function openSessionId(page: Page): Promise<number> {
  return page.evaluate(() => JSON.parse(localStorage.getItem("activeWorkout") ?? "{}").sessionId as number);
}

test("a set dragged after it was logged stays logged, and the set in its old place logs separately", async ({ page }) => {
  const settle = trackActions(page);
  await openWorkout(page);
  await openFirstExercise(page);
  await waitForLiveSession(page);

  const before = await setIds(page);
  expect(before.length).toBeGreaterThanOrEqual(3);
  const [s1, s2, s3, ...rest] = before;

  // Log set 1.
  await page.getByRole("button", { name: "Log set 1", exact: true }).click();
  await expect(page.getByTestId("set-row").first().getByRole("button", { name: /Un-log set/ })).toBeVisible();
  await settle();

  // Drag it onto set 3.
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await drag(
    page,
    page.getByRole("button", { name: "Reorder set 1", exact: true }),
    page.locator(`[data-testid="set-row"][data-set-id="${s3}"]`),
  );
  const expected = [s2, s3, s1, ...rest];
  await expect.poll(() => setIds(page)).toEqual(expected);
  await leaveEditMode(page);
  await settle();

  // Saved: the order survives a reload, and set 1 is still the logged one.
  await page.reload();
  await expect.poll(() => setIds(page)).toEqual(expected);
  const row = (id: number) => page.locator(`[data-testid="set-row"][data-set-id="${id}"]`);
  await expect(row(s1).getByRole("button", { name: /Un-log set/ })).toBeVisible();
  await expect(row(s2).getByRole("button", { name: /^Log set/ })).toBeVisible();

  // Log the set now in first place.
  await row(s2).getByRole("button", { name: "Log set 1", exact: true }).click();
  await expect(row(s2).getByRole("button", { name: /Un-log set/ })).toBeVisible();
  await settle();

  // One row per set, each at its new position.
  const sessionId = await openSessionId(page);
  const logged = await testDb()
    .select({ programSetId: workoutSets.programSetId, setNumber: workoutSets.setNumber })
    .from(workoutSets)
    .where(eq(workoutSets.sessionId, sessionId));
  expect(logged.sort((a, b) => a.setNumber - b.setNumber)).toEqual([
    { programSetId: s2, setNumber: 1 },
    { programSetId: s1, setNumber: 3 },
  ]);

  // And after a reload both still show logged.
  await page.reload();
  await expect(row(s1).getByRole("button", { name: /Un-log set/ })).toBeVisible();
  await expect(row(s2).getByRole("button", { name: /Un-log set/ })).toBeVisible();
});

test("un-logging a moved set removes its own log", async ({ page }) => {
  const settle = trackActions(page);
  await openWorkout(page);
  await openFirstExercise(page);
  await waitForLiveSession(page);
  const [s1, s2, s3, ...rest] = await setIds(page);

  await page.getByRole("button", { name: "Log set 1", exact: true }).click();
  await page.getByRole("button", { name: "Log set 2", exact: true }).click();
  await settle();

  // Move set 1 to third place, then un-log it there.
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await drag(
    page,
    page.getByRole("button", { name: "Reorder set 1", exact: true }),
    page.locator(`[data-testid="set-row"][data-set-id="${s3}"]`),
  );
  await expect.poll(() => setIds(page)).toEqual([s2, s3, s1, ...rest]);
  await leaveEditMode(page);
  await settle();

  const row = page.locator(`[data-testid="set-row"][data-set-id="${s1}"]`);
  await row.getByRole("button", { name: /Un-log set/ }).click();
  await expect(row.getByRole("button", { name: /^Log set/ })).toBeVisible();
  await settle();

  const sessionId = await openSessionId(page);
  const logged = await testDb()
    .select({ programSetId: workoutSets.programSetId })
    .from(workoutSets)
    .where(eq(workoutSets.sessionId, sessionId));
  expect(logged).toEqual([{ programSetId: s2 }]);
});

test("exercises can be dragged into a new order that survives a reload", async ({ page }) => {
  const settle = trackActions(page);
  await openWorkout(page);
  const before = await exerciseIds(page);
  expect(before.length).toBeGreaterThanOrEqual(2);
  const [e1, e2, ...rest] = before;
  const firstName = await page.getByTestId("exercise-row").first().locator("p.text-base").first().innerText();

  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await drag(
    page,
    page.getByRole("button", { name: `Reorder ${firstName}`, exact: true }),
    page.locator(`[data-testid="exercise-row"][data-program-exercise-id="${e2}"]`),
  );
  await expect.poll(() => exerciseIds(page)).toEqual([e2, e1, ...rest]);
  await leaveEditMode(page);
  await settle();

  await page.reload();
  await expect.poll(() => exerciseIds(page)).toEqual([e2, e1, ...rest]);
});
