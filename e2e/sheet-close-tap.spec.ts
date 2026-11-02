import { expect, test } from "./fixtures/test";
import { openFirstExercise, openFirstSetEditor, openWorkout, waitForLiveSession } from "./helpers";

/**
 * A closing sheet stays mounted while it animates out, looking gone well before
 * that ends. It must let go of the screen quickly, or tapping Save straight after
 * picking a weight does nothing. It must not let go at once, or the second tap of
 * a double tap on Done lands on whatever is behind the sheet.
 */
test("Save can be tapped the moment a picker closes", async ({ page }) => {
  await openWorkout(page);
  await openFirstExercise(page);
  await waitForLiveSession(page);
  await openFirstSetEditor(page);

  const save = page.getByRole("button", { name: /^Save$/ });
  await save.scrollIntoViewIfNeeded();
  const box = (await save.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  await page.getByRole("button", { name: /^Weight \(kg\)/ }).click();
  const done = page.getByRole("dialog").getByRole("button", { name: "Done" });
  await expect(done).toBeVisible();

  // In the page, so nothing between the close and the look can outlast the hold.
  const release = await done.evaluate(async (el, [px, py]) => {
    const start = performance.now();
    (el as HTMLElement).click();
    while (document.elementFromPoint(px, py)?.textContent !== "Save") {
      await new Promise((r) => requestAnimationFrame(r));
    }
    return {
      afterMs: performance.now() - start,
      stillAnimating: document.querySelector('[role="dialog"]') !== null,
    };
  }, [x, y]);
  expect(release.afterMs).toBeGreaterThanOrEqual(100); // Long enough for a double tap.
  expect(release.stillAnimating).toBe(true); // Let go early, not by unmounting.

  await page.mouse.click(x, y);
  await expect(page).toHaveURL(/\/exercises\/\d+$/);
});

test("a sheet reopened while it is still closing takes taps", async ({ page }) => {
  await openWorkout(page);
  await openFirstExercise(page);
  await waitForLiveSession(page);
  await openFirstSetEditor(page);

  const row = page.getByRole("button", { name: /^Weight \(kg\)/ });
  await row.click();
  const done = page.getByRole("dialog").getByRole("button", { name: "Done" });
  await expect(done).toBeVisible();

  // Reopened once the closing sheet has let go, which is the state to recover from.
  await done.evaluate(async (el) => {
    (el as HTMLElement).click();
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    while (getComputedStyle(dialog).pointerEvents !== "none") {
      await new Promise((r) => requestAnimationFrame(r));
    }
    [...document.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Weight (kg)"))?.click();
  });

  await expect(done).toBeVisible();
  await expect(done).toHaveCSS("pointer-events", "auto");
  await done.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
