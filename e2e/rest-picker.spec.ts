import { test, expect } from "@playwright/test";
import { openFirstExercise, openWorkout, tapAndSave } from "./helpers";

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
  await openWorkout(page);

  // Tap the first exercise in the workout list.
  await openFirstExercise(page);

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
  // tapAndSave, not click + networkidle: Done fans out into a reorder and a
  // write per changed set, and networkidle resolved while they were still in
  // flight — the reload below then cancelled the write and the spec failed as
  // if the picker had saved nothing.
  await tapAndSave(page, page.getByRole("button", { name: "Done" }));

  // Picker should be gone, label should now show 05:00.
  await expect(page.getByText("Select Rest Time")).not.toBeVisible();
  await expect(restRow).toHaveText("REST 05:00");
  expect(originalLabel).not.toBe("REST 05:00"); // sanity: actually changed

  // The label above is optimistic. Reload to prove the write actually persisted.
  await page.reload();
  await expect(restRow).toHaveText("REST 05:00");

  // Restore original to keep the test idempotent across runs. Losing this is
  // not a local failure: the rest time lives on the shared program, so a
  // restore that does not persist leaves 05:00 behind and every later run
  // fails the sanity check above until someone edits the database by hand.
  const originalSeconds = parseRestLabel(originalLabel);
  const originalButton = preserveLabelToButton(originalSeconds);

  await restRow.click();
  await page.getByRole("button", { name: originalButton }).click();
  await tapAndSave(page, page.getByRole("button", { name: "Done" }));
  await expect(restRow).toHaveText(originalLabel);

  // Re-read from the server to prove the restore persisted, not just rendered.
  await page.reload();
  await expect(
    restRow,
    "rest time must be restored, or it leaks into every later run",
  ).toHaveText(originalLabel);
});

/**
 * A second rest edit made before the first save's refresh lands.
 *
 * The list used to diff a save against the values it had loaded, which lag a
 * write until router.refresh() returns. Changing a rest and changing it back
 * inside that window looked like "no change": the label showed the original,
 * the database kept 05:00. The refresh is held back here so the window is
 * guaranteed rather than a race.
 */
test("a rest edit made before the refresh lands still persists", async ({ page }) => {
  await openWorkout(page);
  await openFirstExercise(page);

  const restRow = page.getByText(/^REST \d{2}:\d{2}$/).first();
  await expect(restRow).toBeVisible();
  const originalLabel = (await restRow.textContent())?.trim() ?? "";
  expect(originalLabel).not.toBe("REST 05:00");
  const originalButton = preserveLabelToButton(parseRestLabel(originalLabel));

  let holdRefresh = true;
  await page.route("**/*", async (route) => {
    if (holdRefresh && route.request().headers()["rsc"] === "1") {
      await new Promise((resolve) => setTimeout(resolve, 4_000));
    }
    await route.continue().catch(() => {});
  });

  try {
    await restRow.click();
    await page.getByRole("button", { name: "5 m" }).click();
    await tapAndSave(page, page.getByRole("button", { name: "Done" }));
    await expect(restRow).toHaveText("REST 05:00");

    await restRow.click();
    await page.getByRole("button", { name: originalButton }).click();
    await tapAndSave(page, page.getByRole("button", { name: "Done" }));
    await expect(restRow).toHaveText(originalLabel);
  } finally {
    holdRefresh = false;
  }

  await page.reload();
  await expect(restRow).toBeVisible();
  const persisted = (await restRow.textContent())?.trim();
  if (persisted !== originalLabel) {
    // Put the shared program back before failing, or every later run starts
    // from 05:00. A reload first means this edit diffs against fresh values.
    await restRow.click();
    await page.getByRole("button", { name: originalButton }).click();
    await tapAndSave(page, page.getByRole("button", { name: "Done" }));
    await page.reload();
  }
  expect(persisted, "the second edit must reach the database").toBe(originalLabel);
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
