import { expect, test } from "./fixtures/test";
import { programWorkoutHrefs, waitForLiveSession } from "./helpers";

/**
 * The workout layout starts a session on load (WorkoutSessionInitializer).
 * A tap into an exercise can land while that Server Action is in flight. The
 * navigation supersedes the action, and when an action that revalidated
 * finishes after being superseded, Next schedules a refresh. If the
 * navigation is still loading at that moment, the refresh is built from the
 * route the user just left and lands on top of the new one, pulling them back.
 * In the suite it showed up as taps that "never committed" and a set editor
 * that vanished under the timer specs.
 *
 * The action and the navigation's data are held so they finish in that
 * order every run instead of now and then.
 */
test("a session that starts as the user moves on does not pull them back", async ({ page }) => {
  // Keep the readiness sheet out of the way: it only asks when no answer is stored.
  await page.addInitScript(() => localStorage.setItem("workoutReadiness", "3"));

  const [workoutHref] = await programWorkoutHrefs(page);

  let releaseActions!: () => void;
  const actionsReleased = new Promise<void>((resolve) => (releaseActions = resolve));
  let releaseNavigation!: () => void;
  const navigationReleased = new Promise<void>((resolve) => (releaseNavigation = resolve));
  let navigationRequested!: () => void;
  const navigationSeen = new Promise<void>((resolve) => (navigationRequested = resolve));
  let exerciseHref = "";

  await page.route("**/*", async (route) => {
    const req = route.request();
    const headers = req.headers();
    // Send each request, hold only its response: a slow server, not a
    // request the browser never got to send.
    if (req.method() === "POST" && headers["next-action"]) {
      const response = await route.fetch();
      await actionsReleased;
      return route.fulfill({ response });
    }
    if (
      exerciseHref &&
      headers["rsc"] === "1" &&
      !headers["next-router-prefetch"] &&
      new URL(req.url()).pathname === exerciseHref
    ) {
      navigationRequested();
      const response = await route.fetch();
      await navigationReleased;
      return route.fulfill({ response });
    }
    await route.continue();
  });

  await page.goto(workoutHref);
  const exercise = page.locator('a[href*="/exercises/"]').first();
  exerciseHref = (await exercise.getAttribute("href")) ?? "";
  if (!exerciseHref) throw new Error("No exercise link on the workout page");

  // Tap while the session start is still in flight, then let the session
  // start finish while the exercise page is still loading.
  await exercise.click();
  await navigationSeen;
  const actionDone = page.waitForResponse((r) => r.request().method() === "POST" && Boolean(r.request().headers()["next-action"]));
  releaseActions();
  await actionDone;
  releaseNavigation();

  await page.waitForURL(`**${exerciseHref}`);
  await waitForLiveSession(page);
  await expect(page.getByTestId("set-row").first()).toBeVisible();
  // Give a refresh scheduled by the superseded action time to land.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await expect(page).toHaveURL(new RegExp(`${exerciseHref}$`));
  await expect(page.getByTestId("set-row").first()).toBeVisible();

  // The set list fires its own actions on load; don't let one still passing
  // through the handler fail the spec when the page closes.
  await page.unrouteAll({ behavior: "ignoreErrors" });
});
