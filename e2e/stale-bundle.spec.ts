import { and, eq } from "drizzle-orm";
import { workoutSets } from "../src/db/schema";
import { testDb } from "./fixtures/reset";
import { expect, test } from "./fixtures/test";
import { openFirstExercise, openWorkout, waitForLiveSession } from "./helpers";

/**
 * A set logged while a deploy lands.
 *
 * Every deploy changes all Server Action IDs (a fresh key per build, on
 * purpose, because the image is public). A PWA left open across a deploy then
 * sends IDs the new server doesn't know, and the server answers with its
 * "action not found" response. On 2026-11-12 that made every write look like
 * a network error: the queue retried with the same stale IDs, spent its
 * attempts and dropped the sets.
 *
 * Here the old bundle is simulated by rewriting the action ID on every action
 * POST until the page reloads, and the real server answers it. The set must
 * reach the database after the app reloads itself.
 */
test("a set logged across a deploy is saved once the app has reloaded", async ({ page }) => {
  await openWorkout(page);
  await openFirstExercise(page);
  await waitForLiveSession(page);
  const sessionId = await page.evaluate(
    () => JSON.parse(localStorage.getItem("activeWorkout") ?? "{}").sessionId as number,
  );

  // The old bundle lasts until the next full page load.
  let stale = true;
  let staleSent = 0;
  let reloaded = false;
  // framenavigated, not a navigation request: WebKit with a Service Worker in
  // control may not report the reload's request to the page. Nothing else
  // navigates the page between the tap and the reload.
  page.on("framenavigated", (frame) => {
    if (frame !== page.mainFrame()) return;
    stale = false;
    reloaded = true;
  });
  await page.route("**/*", async (route) => {
    const req = route.request();
    const id = req.headers()["next-action"];
    if (stale && req.method() === "POST" && id) {
      staleSent++;
      // Same length as a real ID, so the server answers as it does for an ID
      // from another build.
      const unknown = id.slice(0, -8) + (id.endsWith("deadbeef") ? "feedface" : "deadbeef");
      await route.continue({ headers: { ...req.headers(), "next-action": unknown } }).catch(() => {});
      return;
    }
    await route.continue().catch(() => {});
  });

  await page.getByTestId("set-row").first().getByRole("button", { name: "Log set 1", exact: true }).click();

  // The user is told the truth, not "didn't save".
  await expect(page.getByText("Updating app. Your sets are saved on this phone.").first()).toBeVisible();
  await expect.poll(() => reloaded, { timeout: 15_000 }).toBe(true);
  expect(staleSent).toBeGreaterThan(0);

  // The new page sends the queued set with the new action IDs.
  await expect
    .poll(
      async () =>
        (
          await testDb()
            .select({ id: workoutSets.id })
            .from(workoutSets)
            .where(and(eq(workoutSets.sessionId, sessionId), eq(workoutSets.setNumber, 1)))
        ).length,
      { timeout: 20_000 },
    )
    .toBe(1);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("pendingMutationQueue")), { timeout: 10_000 })
    .toBeNull();
});
