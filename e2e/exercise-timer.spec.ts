import { test, expect } from "@playwright/test";

/**
 * Exercise timer countdown completes visibly.
 *
 * Regression guard for the "timer ends a second early" bug — the visible
 * countdown was racing with React's render cycle and the user's last frame
 * was 00:01 before the overlay disappeared, never 00:00. Hard to spot in
 * code review; obvious in a real workout.
 *
 * Strategy: find a timed exercise in the test user's program, override its
 * duration to 3 seconds via SetEditView (so the test isn't slow), tap play,
 * assert that the visible countdown reaches 00:00 before the timer overlay
 * clears. That asserts the user-perceptible behavior, not implementation
 * details.
 *
 * Requires the test user to have a program containing at least one timed
 * exercise (any exercise where `isTimed = true`). Common enough — most
 * programs include a warm-up.
 */
test("exercise timer countdown shows 00:00 before completing", async ({ page }) => {
  // Navigation + edit + the 15s countdown doesn't reliably fit Playwright's
  // default 30s budget.
  test.setTimeout(90_000);
  await page.goto("/");

  const startWorkout = page.getByRole("link", { name: /Start Today's Workout/i });
  await expect(startWorkout).toBeVisible({ timeout: 10_000 });
  await startWorkout.click();

  const skipBtn = page.getByRole("button", { name: "Skip" });
  if (await skipBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await skipBtn.click();
  }

  // Find the first timed exercise. Heuristic: its set list shows mm:ss
  // (e.g. "05:00") instead of "Nx Wkg". Walk the exercise tiles and pick
  // the first one whose set summary matches that shape. Wait for the list
  // to render — count() doesn't wait, and on a cold compile it returns 0
  // and silently skips the spec.
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

  // Open the first set's edit view to override duration to 3 seconds for
  // the test. The set row is tappable; the edit view exposes a duration
  // picker with minute and second inputs.
  const firstSetRow = page.locator("button.w-7.h-7.rounded-full").first();
  await expect(firstSetRow).toBeVisible();
  // The set row container is the parent that's clickable. Click on the
  // duration text to open the edit view.
  await page.locator("p.text-lg.font-medium").first().click();

  // In the edit view, the duration is shown as a tappable row. Tap it
  // to open the picker. Different builds use sheet vs. inline pickers;
  // we just need to surface the input fields. Use a generic numeric input
  // approach: find inputs with mode="numeric" and write 0 / 3.
  const durationButton = page
    .getByRole("button", { name: /duration/i })
    .or(page.getByText("Duration").locator(".."))
    .first();
  // Hard wait — the tolerant isVisible() check raced the edit view's render
  // and silently skipped opening the picker.
  await expect(durationButton).toBeVisible({ timeout: 10_000 });
  await durationButton.click();

  // Most direct approach — set duration via the picker presets. The 15-second
  // preset is the shortest stock value; close enough to 3s for the spec to be
  // fast (15s) while still testing the completion frame. Scoped to the bottom
  // sheet so it can't match the "15s" start-delay chip in the edit view behind it.
  const fifteenSecondPreset = page
    .locator("div.rounded-t-3xl")
    .getByRole("button", { name: /^15\s?s?$/ });
  // Hard assert instead of a tolerant isVisible race: if the preset isn't
  // applied the timer runs its full stock duration and the spec fails late
  // and confusingly.
  await expect(fifteenSecondPreset).toBeVisible({ timeout: 2_000 });
  await fifteenSecondPreset.click();

  await page.getByRole("button", { name: /^Save$/ }).click();

  // Back on the set list. Record every frame the timer's big number shows:
  // expect() polling backs off to 1s intervals and can miss the 600ms 00:00
  // completion frame, so a locator assertion on "00:00" is inherently flaky.
  await page.evaluate(() => {
    const obs = new MutationObserver(() => {
      const el = document.querySelector("span.text-8xl");
      if (el && el.textContent === "00:00") {
        document.documentElement.dataset.sawZero = "true";
      }
    });
    obs.observe(document.body, { subtree: true, childList: true, characterData: true });
  });

  // Tap the play button on the first set to start the timer. The play button
  // lives next to the set toggle (the small w-7 h-7 round one).
  const playBtn = page.locator("button.w-7.h-7.rounded-full").first();
  await expect(playBtn).toBeVisible();
  await playBtn.click();

  // After the timer completes the set is marked logged (toggle uses bg-primary).
  await expect(playBtn).toHaveClass(/bg-primary/, { timeout: 25_000 });

  // The user must have seen the 00:00 frame before the overlay cleared —
  // this is the "timer ends a second early" regression guard.
  expect(await page.evaluate(() => document.documentElement.dataset.sawZero)).toBe("true");

  // Cleanup: un-log so the test is idempotent.
  await playBtn.click();
  await expect(playBtn).toHaveClass(/bg-transparent/);
});
