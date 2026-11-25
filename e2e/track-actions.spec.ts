import { expect, test } from "./fixtures/test";
import { programWorkoutHrefs, trackActions } from "./helpers";

/**
 * `trackActions` settles when a page load cancels an action that was still in
 * flight. The first page after the reset fills the time zone
 * (UserSettingsHydrator), and `openWorkout` leaves /new-workout at once. When
 * that fill was still running, Chromium reported the cancelled request as
 * neither finished nor failed, the count stayed at 1, and plan-conflict and
 * drag-reorder timed out in `settle()` on CI. Here the fill is held, so the
 * page load always cancels it.
 */
test("a page load that cancels an action in flight does not hold the wait", async ({ page }) => {
  let held = false;
  await page.route("**/new-workout", async (route) => {
    if (route.request().method() === "POST" && route.request().postData()?.includes('"ifUnset":true')) {
      held = true;
      return; // never answered
    }
    await route.continue();
  });
  const settle = trackActions(page);
  const [href] = await programWorkoutHrefs(page);
  await expect.poll(() => held).toBe(true);
  await page.goto(href);
  await expect(page.locator('a[href*="/exercises/"]').first()).toBeVisible();
  await settle();
});
