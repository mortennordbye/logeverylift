import { test, expect } from "@playwright/test";
import { openFirstExercise, openWorkout } from "./helpers";

/**
 * Log-a-set flow.
 *
 * The single most-trafficked flow in the app. Tapping the play button on a
 * set toggles its completion state and starts a rest timer. Failure here is
 * the kind of regression that breaks the app for everyone.
 *
 * Requires the test user to have an active program with at least one
 * exercise that has unlogged sets. Idempotent: the test logs a set, asserts
 * it's logged, then un-logs it (toggleSet is a true toggle).
 *
 * UI state signals (set toggle button, `w-7 h-7 rounded-full`):
 *   - unlogged: `bg-transparent` + Play icon
 *   - logged:   `bg-primary` + Check icon
 */
test("logging a set toggles its completion state", async ({ page }) => {
  await openWorkout(page);

  // Tap the first exercise to open its set list. Via the helper because a tap
  // dropped here does not fail loudly: `button.w-7.h-7.rounded-full` also
  // matches the *exercise* toggle on the workout page, so the spec carries on
  // asserting against the wrong control.
  await openFirstExercise(page);

  // Find the first set's toggle button. The set toggle is the small round
  // button at the start of each set row — `w-7 h-7 rounded-full`.
  const firstSetToggle = page.locator("button.w-7.h-7.rounded-full").first();
  await expect(firstSetToggle).toBeVisible();
  await expect(firstSetToggle).toHaveClass(/bg-transparent/);

  // Tap to log.
  await firstSetToggle.click();
  await expect(firstSetToggle).toHaveClass(/bg-primary/);

  // After logging, a rest countdown appears below the set. The timer starts
  // from the configured rest time (e.g. 02:30) and ticks down — assert it's
  // visible without pinning the exact value.
  await expect(page.getByText(/^REST \d{2}:\d{2}$/).first()).toBeVisible();

  // Cleanup: tap again to un-log so the test is idempotent.
  await firstSetToggle.click();
  await expect(firstSetToggle).toHaveClass(/bg-transparent/);
});
