import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { openFirstSetEditor, openTimedExercise } from "./helpers";

/**
 * Pressing Save must save, whatever had focus before it.
 *
 * Pressing a button moves focus off the last one, and that focusout used to reset
 * the page's scroll, a fix meant for the iOS keyboard. On a scrolled page the
 * button then moved out from under the pointer between press and release, so no
 * click fired and the set editor just sat there.
 */
const focusBefore: Record<string, (page: Page) => Promise<void>> = {
  // Clicking a button focuses it on Chromium and on Linux WebKit, not on Mac WebKit.
  button: (page) => page.getByRole("button", { name: /^3s$/ }).click(),
  "note field": (page) => page.getByPlaceholder(/How did it feel/).click(),
};

for (const [name, focus] of Object.entries(focusBefore)) {
  test(`Save still saves when pressing it moves focus off a ${name} on a scrolled page`, async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 500 });
  await openTimedExercise(page);
  await openFirstSetEditor(page);

  await focus(page);

  const save = page.getByRole("button", { name: /^Save$/ });
  await save.scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    document.body.scrollTop = 64;
  });
  await expect.poll(() => page.evaluate(() => document.body.scrollTop)).toBeGreaterThan(0);

  const box = (await save.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // Two frames: what focusout scheduled gets its chance before the release.
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  await page.mouse.up();

  await expect(page).toHaveURL(/\/exercises\/\d+$/);
});
}
