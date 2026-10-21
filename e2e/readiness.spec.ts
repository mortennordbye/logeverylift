import { expect, test } from "./fixtures/test";
import { waitForLiveSession } from "./helpers";

/**
 * The readiness check-in auto-skips after 4 seconds if ignored.
 *
 * Every other spec taps Skip, so none of them would notice the auto-skip
 * stalling. It did: the countdown's tick was cancelled and restarted on each
 * render of the workout screen, which re-renders every second for its clock,
 * and the overlay could stay over the workout indefinitely.
 */
test("the readiness sheet dismisses itself when ignored", async ({ page }) => {
  await page.goto("/new-workout");
  const showAll = page.getByRole("button", { name: "Different program" });
  if (await showAll.waitFor({ state: "visible", timeout: 5_000 }).then(() => true, () => false)) {
    await showAll.click();
  }
  const link = page.locator('a[href^="/programs/"][href$="/workout"]').first();
  await page.goto((await link.getAttribute("href"))!);
  await waitForLiveSession(page);

  const sheet = page.getByText("How are you feeling today?");
  await expect(sheet).toBeVisible();
  await expect(page.getByText(/Auto-skipping in [1-3]s/)).toBeVisible({ timeout: 3_000 });
  // 300 ms slide-in + 4 s countdown, with slack for a slow runner.
  await expect(sheet).toBeHidden({ timeout: 8_000 });

  // And the workout underneath takes taps again.
  const exercise = page.locator('a[href*="/exercises/"]').first();
  await exercise.click();
  await expect(page).toHaveURL(/\/exercises\/\d+$/);
});
