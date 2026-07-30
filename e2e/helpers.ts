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

/** The readiness check-in sheet auto-dismisses after ~4s; race it. */
async function dismissReadinessSheet(page: Page) {
  const skipBtn = page.getByRole("button", { name: "Skip" });
  if (await skipBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await skipBtn.click();
  }
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
  await dismissReadinessSheet(page);
  await expect(page.locator('a[href*="/exercises/"]').first()).toBeVisible({
    timeout: 10_000,
  });
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
    await dismissReadinessSheet(page);
    const exerciseLinks = page.locator('a[href*="/exercises/"]');
    await expect(exerciseLinks.first()).toBeVisible({ timeout: 10_000 });
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
