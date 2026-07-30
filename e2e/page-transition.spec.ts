import { test, expect, type Page } from "@playwright/test";
import { openFirstExercise, openFirstSetEditor, openWorkout } from "./helpers";

/**
 * Page transitions animate what we drive, and stand down for what the platform
 * drives.
 *
 * The bug this guards: in a standalone PWA on iOS an edge swipe runs the
 * system's own interactive back transition. The app then ran its slide as well,
 * so one gesture moved the screen twice. The system gesture cannot be cancelled
 * from JavaScript, so the fix is for the app to stand down on `popstate`.
 *
 * `router.back()` also arrives as `popstate` and must be exempt, or every Back
 * control we draw goes dead. Those call sites mark their intent.
 *
 * Playwright cannot perform the iOS edge gesture, but `goBack()` produces the
 * same `popstate` the gesture does, which is the signal the app branches on.
 * The gesture's feel still wants a check on a real device.
 */

/** Largest horizontal translation applied to a page layer while `action` runs. */
async function maxSlide(page: Page, action: () => Promise<void>): Promise<number> {
  await page.evaluate(() => {
    const w = window as unknown as { __tx: number[]; __stop?: () => void };
    w.__tx = [];
    let stop = false;
    w.__stop = () => {
      stop = true;
    };
    const tick = () => {
      for (const el of Array.from(document.querySelectorAll(".page-layer"))) {
        const t = getComputedStyle(el as HTMLElement).transform;
        if (t && t !== "none") {
          // matrix(a, b, c, d, tx, ty)
          const m = t.match(/matrix\(([^)]+)\)/);
          if (m) {
            const parts = m[1].split(",").map((n) => parseFloat(n.trim()));
            if (parts.length >= 5) w.__tx.push(Math.abs(parts[4]));
          }
        }
      }
      if (!stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  await action();
  await page.waitForTimeout(700); // longer than the 240ms slide

  return page.evaluate(() => {
    const w = window as unknown as { __tx: number[]; __stop?: () => void };
    w.__stop?.();
    return w.__tx.length ? Math.max(...w.__tx) : 0;
  });
}

// A real slide crosses most of a 390px viewport; anything under this is either
// no animation at all or sub-pixel noise.
const SLID = 50;

test("a push into a deeper route animates", async ({ page }) => {
  test.setTimeout(120_000);
  await openWorkout(page);
  await page.waitForTimeout(600);

  const slide = await maxSlide(page, async () => {
    await openFirstExercise(page);
  });

  console.log(`TRANSITION push: maxSlide=${Math.round(slide)}px`);
  expect(slide, "an in-app push should slide").toBeGreaterThan(SLID);
});

test("a platform history navigation does not animate on top of the system", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openWorkout(page);
  await openFirstExercise(page);
  await page.waitForTimeout(900);

  // goBack() raises the same popstate the iOS edge swipe raises.
  const slide = await maxSlide(page, async () => {
    await page.goBack();
    await page.waitForTimeout(300);
  });

  console.log(`TRANSITION history-pop: maxSlide=${Math.round(slide)}px`);
  expect(slide, "the app must not slide over the system's own gesture").toBeLessThan(
    SLID,
  );
});

test("our own Back still animates even though it is also a popstate", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openWorkout(page);
  await openFirstExercise(page);
  await page.waitForTimeout(600);
  await openFirstSetEditor(page);
  await page.waitForTimeout(900);

  // Save runs markProgrammaticBack() then router.back().
  const save = page.getByRole("button", { name: /^Save$/ }).first();
  await expect(save).toBeVisible({ timeout: 10_000 });

  const slide = await maxSlide(page, async () => {
    await save.click();
    await page.waitForTimeout(300);
  });

  console.log(`TRANSITION programmatic-back: maxSlide=${Math.round(slide)}px`);
  expect(slide, "a Back control we drew should keep its slide").toBeGreaterThan(SLID);
});
