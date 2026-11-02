import { expect, test } from "./fixtures/test";
import { openFirstExercise, openFirstSetEditor, openWorkout, waitForLiveSession } from "./helpers";

/**
 * A sheet that has been closed must not block the screen behind it.
 *
 * Its backdrop stays mounted while it fades out, looking gone well before the
 * fade ends, and it used to swallow every tap until then. Pick a weight, tap Save
 * straight away, and nothing happened. Tap a moment later, and it worked.
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

  // In the page, so nothing between the close and the look can outlast the fade.
  const under = await done.evaluate(async (el, [px, py]) => {
    (el as HTMLElement).click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return document.elementFromPoint(px, py)?.textContent ?? "";
  }, [x, y]);
  expect(under).toBe("Save");

  await page.mouse.click(x, y);
  await expect(page).toHaveURL(/\/exercises\/\d+$/);
});
