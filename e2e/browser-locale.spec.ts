import { expect, test } from "./fixtures/test";

/**
 * A browser in another locale renders the same text as the server.
 *
 * `toLocaleString()` with no locale formats in the runtime's locale: the
 * server's (en-US) for the HTML, the phone's for hydration. A Norwegian phone
 * writes 1234 as "1 234" and 2 pm as "14:00", so the server's "1,234" and
 * "02:00 PM" did not match and React threw the server HTML away (#418), which
 * the shared fixture reports as a failure.
 */
test.use({ locale: "nb-NO" });

test("History renders on a Norwegian phone without a hydration error", async ({ page }) => {
  await page.goto("/history");
  await expect(page.getByRole("link", { name: /kg/ }).first()).toBeVisible();
});
