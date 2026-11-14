import { expect, test } from "./fixtures/test";

/**
 * The accent is on the first paint (review 2026-11-14, finding 2). The app's
 * scripts are blocked, so the page never hydrates and the theme provider's
 * effect never runs: only the pre-paint script in src/app/layout.tsx can set
 * the colour. Before it did, a green accent painted the default blue first.
 */

const brand = (page: import("@playwright/test").Page) =>
  page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--brand").trim().toLowerCase());

test("a stored accent paints before hydration, named and custom", async ({ page }) => {
  await page.goto("/");
  // Block the scripts, not the stylesheets (also under chunks/).
  await page.route(/\/_next\/static\/chunks\/.*\.js(\?|$)/, (route) => route.abort());

  await page.evaluate(() => {
    localStorage.setItem("theme", "light");
    localStorage.setItem("accentColor", "green");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  expect(await page.evaluate(() => document.documentElement.dataset.accent)).toBe("green");
  expect(await brand(page)).toBe("#21734f");

  // A custom colour too light for white text: its brand is darkened, and the
  // home's text on it is dark.
  await page.evaluate(() => {
    localStorage.setItem("theme", "dark");
    localStorage.setItem("accentColor", "custom");
    localStorage.setItem("customAccentHex", "#ffee00");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true);
  expect(await brand(page)).toBe("#ffee00");
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--on-brand-custom").trim())).toBe("#0b0b0c");
});
