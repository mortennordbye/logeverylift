import { test, expect } from "@playwright/test";

/**
 * Opt-in start delay on a timed set: the countdown runs a "Get ready" prep
 * phase before the work phase, shown as an amber lead-in slice on the ring.
 *
 * Asserts the user-perceptible sequence: after saving a 15s duration with a
 * 3s start delay and tapping play, the overlay first shows "Get ready", then
 * hands off to the normal work countdown ("of 00:15"), reaches 00:00, and
 * auto-logs the set. Also asserts the set row advertises the delay (+3s).
 *
 * Requires the test user to have a program containing at least one timed
 * exercise (same prerequisite as exercise-timer.spec.ts).
 */
test("timed set with start delay runs Get ready phase then work countdown", async ({ page }) => {
  // Navigation + edit + an 18s (3s delay + 15s work) countdown + cleanup
  // doesn't fit Playwright's default 30s budget.
  test.setTimeout(90_000);
  await page.goto("/");

  const startWorkout = page.getByRole("link", { name: /Start Today's Workout/i });
  await expect(startWorkout).toBeVisible({ timeout: 10_000 });
  await startWorkout.click();

  const skipBtn = page.getByRole("button", { name: "Skip" });
  if (await skipBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await skipBtn.click();
  }

  // Find the first timed exercise: its set list shows mm:ss without "kg".
  // Wait for the list to render — count() doesn't wait, and on a cold
  // compile it returns 0 and silently skips the spec.
  const exerciseLinks = page.locator('a[href*="/exercises/"]');
  await expect(exerciseLinks.first()).toBeVisible({ timeout: 10_000 });
  const count = await exerciseLinks.count();
  let timedHref: string | null = null;
  for (let i = 0; i < count; i++) {
    const link = exerciseLinks.nth(i);
    const text = await link.innerText();
    if (/\b\d{2}:\d{2}\b/.test(text) && !/kg/i.test(text)) {
      timedHref = await link.getAttribute("href");
      if (timedHref) break;
    }
  }
  test.skip(timedHref === null, "Test user has no timed exercise — seed one to enable this spec");
  await page.goto(timedHref!);

  // Open the first set's edit view.
  await page.locator("p.text-lg.font-medium").first().click();

  // Set duration to the 15s preset (scoped to the bottom sheet so the
  // locator can't match the "15s" start-delay chip in the edit view).
  const durationButton = page
    .getByRole("button", { name: /duration/i })
    .or(page.getByText("Duration").locator(".."))
    .first();
  await durationButton.click();
  const fifteenSecondPreset = page
    .locator("div.rounded-t-3xl")
    .getByRole("button", { name: /^15\s?s?$/ });
  await expect(fifteenSecondPreset).toBeVisible({ timeout: 2_000 });
  await fifteenSecondPreset.click();

  // Opt in to a 3-second start delay via the inline chip row.
  await page.getByRole("button", { name: /^3s$/ }).click();

  await page.getByRole("button", { name: /^Save$/ }).click();

  // Back on the set list, the row advertises the delay next to the duration.
  await expect(page.getByText("+3s").first()).toBeVisible();

  // Record every frame the timer's big number shows: expect() polling backs
  // off to 1s intervals and can miss the 600ms 00:00 completion frame, so a
  // locator assertion on "00:00" is inherently flaky.
  await page.evaluate(() => {
    const obs = new MutationObserver(() => {
      const el = document.querySelector("span.text-8xl");
      if (el && el.textContent === "00:00") {
        document.documentElement.dataset.sawZero = "true";
      }
    });
    obs.observe(document.body, { subtree: true, childList: true, characterData: true });
  });

  // Start the timer.
  const playBtn = page.locator("button.w-7.h-7.rounded-full").first();
  await expect(playBtn).toBeVisible();
  await playBtn.click();

  // Phase 1: the prep countdown labels itself "Get ready".
  await expect(page.getByText(/get ready/i)).toBeVisible({ timeout: 5_000 });

  // Phase 2: after the delay elapses the normal work countdown takes over.
  await expect(page.getByText("of 00:15")).toBeVisible({ timeout: 10_000 });

  // The full countdown (3s delay + 15s work) completes and auto-logs the set.
  await expect(playBtn).toHaveClass(/bg-primary/, { timeout: 25_000 });

  // The user must have seen the 00:00 completion frame before the overlay
  // cleared.
  expect(await page.evaluate(() => document.documentElement.dataset.sawZero)).toBe("true");

  // Cleanup: un-log the set and reset the delay to None so the test is
  // idempotent and doesn't leak state into other specs.
  await playBtn.click();
  await expect(playBtn).toHaveClass(/bg-transparent/);
  await page.locator("p.text-lg.font-medium").first().click();
  await page.getByRole("button", { name: /^None$/ }).click();
  await page.getByRole("button", { name: /^Save$/ }).click();
  await expect(page.getByText("+3s")).toHaveCount(0);
});
