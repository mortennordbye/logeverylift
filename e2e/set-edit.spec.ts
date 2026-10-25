import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { openFirstExercise, openWorkout, trackActions, waitForLiveSession } from "./helpers";

/**
 * The set editor during a workout.
 *
 * The editor seeds its fields from the session's overrides (a weight corrected
 * earlier, the reps a miss sheet recorded). Those are restored from
 * localStorage by a provider effect, and React runs a child's state
 * initialisers and effects before its parent's effects: on a cold load of the
 * editor's URL (iOS evicting the PWA mid-workout, then the lifter reopening a
 * set) the fields seeded from the plan, and saving wrote the plan's values
 * back over the correction.
 */

async function firstSetEditorUrl(page: Page): Promise<{ url: string; setId: number }> {
  await openWorkout(page);
  await openFirstExercise(page);
  await waitForLiveSession(page);
  const row = page.getByTestId("set-row").first();
  await expect(row).toBeVisible();
  const setId = Number(await row.getAttribute("data-set-id"));
  return { url: `${page.url()}/sets/${setId}`, setId };
}

test("a cold load of the editor shows the session's corrected values, and saving keeps them", async ({ page }) => {
  const { url, setId } = await firstSetEditorUrl(page);

  // What the session would have stored after the lifter corrected this set.
  await page.evaluate((id) => {
    localStorage.setItem(
      "workoutOverrides",
      JSON.stringify({ [id]: { targetReps: 8, weightKg: 82.5, actualReps: 6 } }),
    );
  }, setId);

  await page.goto(url);
  // Barbell sets follow the weight with the plate line, so the name runs on.
  await expect(page.getByRole("button", { name: /^Weight \(kg\)\s*82\.5(\s|$)/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Reps done\s*6$/ })).toBeVisible();

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page).toHaveURL(/\/exercises\/\d+$/);
  const stored = await page.evaluate(
    (id) => JSON.parse(localStorage.getItem("workoutOverrides") ?? "{}")[id],
    setId,
  );
  expect(stored).toMatchObject({ weightKg: 82.5, actualReps: 6 });
});

test("a note saved on a logged set is still there when the set is reopened", async ({ page }) => {
  const settle = trackActions(page);
  const { url } = await firstSetEditorUrl(page);
  await page.getByRole("button", { name: "Log set 1", exact: true }).click();
  await settle();

  await page.goto(url);
  const notes = page.getByPlaceholder(/How did it feel/);
  await notes.fill("belt on, felt solid");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page).toHaveURL(/\/exercises\/\d+$/);
  await settle();

  await page.goto(url);
  await expect(page.getByPlaceholder(/How did it feel/)).toHaveValue("belt on, felt solid");
});
