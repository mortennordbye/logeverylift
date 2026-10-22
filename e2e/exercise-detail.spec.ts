import { expect, test } from "./fixtures/test";

/**
 * The exercise detail screen grew an illustration and a muscle map, which made
 * it taller than a phone. Scrolled all the way down, its last row must clear
 * the bottom nav; it used to end under it, so the bottom of the page could not
 * be reached.
 */
test("the exercise detail scrolls its last row clear of the bottom nav", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/exercises");
  // Text typed before hydration lands in the input without filtering the
  // list, so type until the result row shows up.
  const search = page.getByRole("textbox", { name: "Search" });
  const row = page.getByRole("button", { name: /^Barbell Curl/ }).first();
  await expect(async () => {
    await search.fill("");
    await search.fill("Barbell Curl");
    await expect(row).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await row.click();
  await expect(page.getByRole("img", { name: /Barbell Curl, front view/ })).toBeVisible();

  const lastRow = page.getByText("Movement", { exact: true });
  await expect
    .poll(async () => {
      // Scroll the page's scroller to its end (mobile WebKit has no wheel
      // events). Inside the poll, so late layout (fonts, the drawing) can't
      // leave the measurement short of the real end.
      await lastRow.evaluate((el) => {
        const scroller = el.closest(".overflow-y-auto");
        if (scroller) scroller.scrollTop = scroller.scrollHeight;
      });
      const row = await lastRow.locator("..").boundingBox();
      const nav = await page.getByRole("navigation").boundingBox();
      return row && nav ? nav.y - (row.y + row.height) : -1;
    })
    .toBeGreaterThanOrEqual(8);
});
