import { test, expect } from "@playwright/test";

/**
 * Rest-time picker flow.
 *
 * Requires the test user to have an active program with at least one
 * exercise that has a REST row. Failure on the navigation steps usually
 * means the test account isn't set up — seed it via the admin panel.
 *
 * The flow we're protecting:
 *   1. Open a workout, tap an exercise.
 *   2. Tap a REST row to open the picker.
 *   3. Tap a preset that requires the row to scroll.
 *   4. Tap Done.
 *   5. The REST label updates to the new value.
 *
 * This exact flow contained the "bean" bug — a thin scroll artifact when
 * the chosen preset wasn't fully on-screen. The implicit guarantee here is
 * that tapping any preset always saves correctly, even ones off-screen.
 */
test("rest-time picker saves the selected preset", async ({ page }) => {
  await page.goto("/");

  // Home → workout. Falls back gracefully if no active program is set up.
  const startWorkout = page.getByRole("link", { name: /Start Today's Workout/i });
  await expect(startWorkout).toBeVisible({ timeout: 10_000 });
  await startWorkout.click();

  // Skip the readiness check-in sheet if it shows. Auto-dismisses after ~4s
  // anyway, so just race the auto-dismiss.
  const skipBtn = page.getByRole("button", { name: "Skip" });
  if (await skipBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await skipBtn.click();
  }

  // Tap the first exercise in the workout list.
  const firstExercise = page.locator('a[href*="/exercises/"]').first();
  await expect(firstExercise).toBeVisible();
  await firstExercise.click();

  // The exercise page has REST rows between sets. Tap the first one.
  const restRow = page.getByText(/^REST \d{2}:\d{2}$/).first();
  await expect(restRow).toBeVisible();
  const originalLabel = (await restRow.textContent())?.trim() ?? "";
  await restRow.click();

  // Picker should be open.
  await expect(page.getByText("Select Rest Time")).toBeVisible();

  // Pick a preset different from the current selection. We deliberately
  // pick "5 m" because it's at the far right and requires the row to
  // scroll — that's the position where the original bean bug appeared.
  await page.getByRole("button", { name: "5 m" }).click();
  await page.getByRole("button", { name: "Done" }).click();

  // Picker should be gone, label should now show 05:00.
  await expect(page.getByText("Select Rest Time")).not.toBeVisible();
  await expect(restRow).toHaveText("REST 05:00");
  expect(originalLabel).not.toBe("REST 05:00"); // sanity: actually changed

  // The label above is optimistic. Reload to (a) prove the write actually
  // persisted and (b) refresh the client's diff base — saveCurrentState only
  // writes rests that differ from the last-fetched DB values, so restoring
  // before router.refresh() lands is silently skipped and leaks 05:00 into
  // the shared program (which then breaks every later run's sanity check).
  await page.waitForLoadState("networkidle");
  await page.reload();
  await expect(restRow).toHaveText("REST 05:00");

  // Restore original to keep the test idempotent across runs.
  await restRow.click();
  const originalSeconds = parseRestLabel(originalLabel);
  const originalButton = preserveLabelToButton(originalSeconds);
  await page.getByRole("button", { name: originalButton }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(restRow).toHaveText(originalLabel);
  // Same deal for the restore write: let it land, then prove it persisted.
  await page.waitForLoadState("networkidle");
  await page.reload();
  await expect(restRow).toHaveText(originalLabel);
});

function parseRestLabel(label: string): number {
  // "REST 01:30" → 90
  const m = label.match(/REST (\d{2}):(\d{2})/);
  if (!m) throw new Error(`Unexpected rest label: ${label}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

function preserveLabelToButton(seconds: number): RegExp {
  // Map seconds back to the button name in the picker.
  // REST_OPTIONS = [30, 60, 90, 120, 150, 180, 240, 300]
  if (seconds === 30) return /^30 s$/;
  if (seconds % 60 === 0) {
    const m = seconds / 60;
    return new RegExp(`^${m} m$`);
  }
  const m = Math.floor(seconds / 60);
  const s = String(seconds % 60).padStart(2, "0");
  return new RegExp(`^${m}:${s} m$`);
}
