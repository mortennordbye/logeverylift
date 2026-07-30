import { expect, type Page } from "@playwright/test";

/**
 * Shared navigation into a workout screen.
 *
 * Specs used to enter through the dashboard's "Start Today's Workout" link,
 * but that CTA only renders when the user's training cycle schedules a program
 * for the current weekday — the seed schedules Mon/Wed/Fri. On the other four
 * days the dashboard renders "No program today" instead and every spec failed
 * on its first assertion with "element(s) not found", which reads like a real
 * regression and isn't one. The /new-workout picker lists every program
 * regardless of the day, so it is the stable entry point.
 */

/**
 * Dismiss the readiness check-in sheet and wait until it is really gone.
 *
 * The sheet does not mount on load: `WorkoutSessionClient` decides to show it
 * from client session state, and `ReadinessSheet` then waits a further 300ms
 * before sliding in. A short probe therefore runs *before the sheet exists*,
 * finds no Skip button and returns, and the sheet arrives afterwards over its
 * `fixed inset-0 z-50` backdrop — swallowing the caller's next tap. That is
 * what made `rest-picker` fail on WebKit while passing on Chromium: the two
 * engines hydrate the dev build on different schedules, and rest-picker is the
 * only spec that *clicks* a link here instead of using `page.goto`.
 *
 * So: probe past the auto-skip deadline, then assert absence. The sheet
 * unmounts on confirm (`showReadiness && <ReadinessSheet/>`), so "hidden" is a
 * real detach and not an opacity-0 element Playwright would still call visible.
 */
async function dismissReadinessSheet(page: Page) {
  const skipBtn = page.getByRole("button", { name: "Skip" });
  if (await skipBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await skipBtn.click();
  }
  await expect(skipBtn).toBeHidden({ timeout: 10_000 });
}

/** Every program's workout href, in picker order. */
async function programWorkoutHrefs(page: Page): Promise<string[]> {
  await page.goto("/new-workout");
  const links = page.locator('a[href^="/programs/"][href$="/workout"]');
  await expect(links.first()).toBeVisible({ timeout: 10_000 });
  // Read every href in one DOM pass. Resolving them one locator at a time
  // races the list's own re-render and hangs waiting for an nth() that no
  // longer exists.
  return links.evaluateAll((els) =>
    els.map((el) => el.getAttribute("href")).filter((h): h is string => h !== null),
  );
}

/** Opens the first program's exercise list, ready for a set to be tapped. */
export async function openWorkout(page: Page): Promise<void> {
  const [href] = await programWorkoutHrefs(page);
  await page.goto(href);
  // Wait for the page before probing for the sheet: the sheet is mounted from
  // client state, so probing straight after goto can beat it into existence.
  await expect(page.locator('a[href*="/exercises/"]').first()).toBeVisible({
    timeout: 10_000,
  });
  await dismissReadinessSheet(page);
}

/**
 * Tap the first exercise on the workout page and wait for its set list.
 *
 * Why this isn't just `.click()`: dismissing the readiness sheet calls
 * `confirmReadiness`, which runs a Server Action and a `router.refresh()`. A
 * tap that lands while that refresh is re-rendering the list is accepted by the
 * anchor — `defaultPrevented` is true, so React had hydrated — but the App
 * Router navigation never commits and the user stays on the workout page.
 *
 * Verified with a throwaway diagnostic: clicking immediately after
 * `openWorkout` left `page.url()` unchanged, while inserting a single
 * `getAttribute` round trip beforehand made it navigate 3/3. So the retry below
 * is covering a real dropped tap, not a slow one — the first click is not
 * "still in flight", it is gone.
 *
 * This only reproduces on WebKit; Chromium never dropped the tap, which is why
 * the suite looked green when it was run there.
 */
export async function openFirstExercise(page: Page): Promise<void> {
  const link = page.locator('a[href*="/exercises/"]').first();
  const href = await link.getAttribute("href");
  if (!href) throw new Error("No exercise link on the workout page");

  await link.click();
  try {
    await page.waitForURL(`**${href}`, { timeout: 5_000 });
  } catch {
    await link.click();
    await page.waitForURL(`**${href}`, { timeout: 10_000 });
  }
}

/**
 * Tap the first set row to open its edit view, and wait for the route.
 *
 * Same dropped-tap window as `openFirstExercise`, one level deeper: the set
 * row navigates to `.../sets/<id>`, and a tap that lands while the set list is
 * still settling is accepted and then lost. Both timer specs open the editor
 * this way to shorten a duration before playing it.
 */
export async function openFirstSetEditor(page: Page): Promise<void> {
  const row = page.locator("p.text-lg.font-medium").first();
  await expect(row).toBeVisible({ timeout: 10_000 });
  await row.click();
  try {
    await page.waitForURL(/\/sets\/\d+$/, { timeout: 5_000 });
  } catch {
    await row.click();
    await page.waitForURL(/\/sets\/\d+$/, { timeout: 10_000 });
  }
}

/**
 * Opens the set list of the first timed exercise found in any program.
 *
 * Timed exercises are identified by their set summary, which renders each set
 * as mm:ss (`buildSetSummary` + `setToken`). The summary is its own line under
 * the exercise name, and the first token is always a set — so a timed exercise
 * is one whose summary line *starts* with mm:ss.
 *
 * "Contains mm:ss and no kg" is the tempting test and it is wrong: every
 * summary appends rest tokens ("8 reps; 01:30; ..."), and a bodyweight
 * exercise has no kg either, so Pull-up matched and the spec then timed out
 * hunting for a Duration control that a rep-based set does not have.
 *
 * Scanning across programs rather than only today's matters because the seed
 * puts the one timed exercise (Plank) on Upper Body, scheduled one weekday.
 *
 * Throws rather than skipping — the seed guarantees a timed exercise exists, so
 * finding none is a real failure, not a missing prerequisite.
 */
export async function openTimedExercise(page: Page): Promise<void> {
  for (const href of await programWorkoutHrefs(page)) {
    await page.goto(href);
    const exerciseLinks = page.locator('a[href*="/exercises/"]');
    await expect(exerciseLinks.first()).toBeVisible({ timeout: 10_000 });
    await dismissReadinessSheet(page);
    const timedHref = await exerciseLinks.evaluateAll((els) => {
      const timed = els.find((el) =>
        /^\d{2}:\d{2}\b/m.test((el as HTMLElement).innerText),
      );
      return timed ? timed.getAttribute("href") : null;
    });
    if (timedHref) {
      await page.goto(timedHref);
      return;
    }
  }
  throw new Error(
    "No timed exercise in any program. The seed adds Plank to Upper Body — " +
      "re-run `docker-compose exec app pnpm db:seed-fake --force`.",
  );
}
