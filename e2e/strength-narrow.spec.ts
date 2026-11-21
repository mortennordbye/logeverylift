import type { Locator } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { openWorkout } from "./helpers";

/**
 * The workout and program headers on a 320 x 568 phone (final QA of the run
 * logger, journey 6 of the steps set): every control is inside the screen and
 * none runs into the one next to it.
 */

test.use({ viewport: { width: 320, height: 568 } });

async function box(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error("not on screen");
  return b;
}

test("at 320 px the workout header keeps Finished, Workout, Edit and + inside the screen", async ({ page }) => {
  await openWorkout(page);
  const plus = await box(page.getByRole("button", { name: "Workout actions" }));
  expect(plus.x + plus.width).toBeLessThanOrEqual(320);
  const edit = await box(page.getByRole("button", { name: "Edit", exact: true }));
  const title = await box(page.getByRole("heading", { name: "Workout", exact: true }));
  expect(title.x + title.width).toBeLessThanOrEqual(edit.x);
  expect(edit.x + edit.width).toBeLessThanOrEqual(plus.x);
});

test("at 320 px the program header keeps Back, Change history, Share and Edit apart and inside the screen", async ({ page }) => {
  await openWorkout(page);
  const programPath = new URL(page.url()).pathname.replace(/\/workout$/, "");
  await page.goto(programPath);
  const edit = await box(page.getByRole("button", { name: "Edit", exact: true }));
  expect(edit.x + edit.width).toBeLessThanOrEqual(320);
  const back = await box(page.getByTestId("back-link"));
  const history = await box(page.getByRole("link", { name: "Change history" }));
  expect(back.x + back.width).toBeLessThanOrEqual(history.x);
  await expect(page.getByTestId("back-link")).toHaveText("Programs");
});
