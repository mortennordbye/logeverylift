import { expect, test } from "./fixtures/test";
import { openWorkout, waitForLiveSession } from "./helpers";

/**
 * The finish page loaded straight from the server: a refresh on it, or iOS
 * reopening the PWA there. The server has no workout data, so anything it
 * renders from the workout's start differs from what the browser renders,
 * and hydration fails (React #418, which the fixture turns into a failure).
 * The page must also show the workout's real start and duration, not the
 * moment of the reload.
 */

test("reloading the finish page shows the workout's own start and duration, with no hydration error", async ({ page }) => {
  await openWorkout(page);
  await waitForLiveSession(page);
  const programId = await page.evaluate(() => JSON.parse(localStorage.getItem("activeWorkout") ?? "{}").programId as number);

  // A workout started 75 minutes ago (in the browser's own zone below).
  const started = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("activeWorkout") ?? "{}");
    const start = new Date(Date.now() - 75 * 60_000);
    localStorage.setItem("activeWorkout", JSON.stringify({ ...raw, startTime: start.toISOString() }));
    return start.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  });

  await page.goto(`/programs/${programId}/workout/finish`);
  await expect(page.getByRole("button", { name: "Save Workout" })).toBeVisible();
  await expect(page.getByText(/^1h 15min$/)).toBeVisible();
  await expect(page.getByText(started, { exact: true })).toBeVisible();

  // And once more, as a second refresh.
  await page.reload();
  await expect(page.getByText(/^1h 15min$/)).toBeVisible();
});
