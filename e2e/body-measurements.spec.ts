import { eq } from "drizzle-orm";
import { bodyMeasurements, users } from "../src/db/schema";
import { e2eUser } from "./fixtures/env";
import { testDb } from "./fixtures/reset";
import { expect, test } from "./fixtures/test";
import { trackActions } from "./helpers";

/**
 * Body measurements (docs/plans/body-measurements.md): open from Account, log
 * a few parts in the step flow with a Skip, read them back on the summary and
 * delete one on its part page.
 */

async function userId(parallelIndex: number) {
  const [user] = await testDb().select({ id: users.id }).from(users).where(eq(users.email, e2eUser(parallelIndex).email));
  return user.id;
}

const rowsOf = (uid: string) =>
  testDb()
    .select({ site: bodyMeasurements.site, side: bodyMeasurements.side, valueCm: bodyMeasurements.valueCm, measuredOn: bodyMeasurements.measuredOn })
    .from(bodyMeasurements)
    .where(eq(bodyMeasurements.userId, uid));

test("log measurements step by step, read them back and delete one", async ({ page }, testInfo) => {
  const settle = trackActions(page);
  const uid = await userId(testInfo.parallelIndex);

  await page.goto("/more/account/body-and-health");
  await expect(page.getByTestId("account-measurements")).toContainText("Not set");
  await page.getByTestId("account-measurements").click();
  await page.waitForURL("**/more/account/measurements");
  await expect(page.getByTestId("measurements-empty")).toBeVisible();
  await page.getByRole("link", { name: "Log measurements" }).click();
  await page.waitForURL("**/more/account/measurements/log");

  // A first log has the 13 circumference steps and the 3 lengths. Log an old date.
  await expect(page.getByTestId("step-count")).toHaveText("1 of 16");
  await page.getByLabel("Log date").fill("2026-10-01");
  await expect(page.getByText("1 Oct ›")).toBeVisible();
  await page.getByRole("textbox", { name: "Neck in cm" }).fill("39");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await settle();

  await expect(page.getByTestId("step-count")).toHaveText("2 of 16");
  await page.getByRole("button", { name: "Skip", exact: true }).click();

  // Next on the keypad (Enter) goes on as well.
  await page.getByRole("textbox", { name: "Chest in cm" }).fill("110.5");
  await page.getByRole("textbox", { name: "Chest in cm" }).press("Enter");
  await settle();
  await expect(page.getByTestId("step-count")).toHaveText("4 of 16");

  for (let n = 4; n <= 5; n++) await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Upper arm · right" })).toBeVisible();
  await page.getByRole("textbox", { name: "Upper arm · right in cm" }).fill("36.5");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await settle();
  for (let n = 7; n <= 16; n++) {
    await expect(page.getByTestId("step-count")).toHaveText(`${n} of 16`);
    await page.getByRole("button", { name: "Skip", exact: true }).click();
  }

  await expect(page.getByTestId("measure-done")).toBeVisible();
  await expect(page.getByText("3 of 16 parts · 13 skipped")).toBeVisible();
  await expect(page.getByTestId("done-row-shoulders")).toContainText("Skipped");

  // Tap a value to correct it.
  await page.getByTestId("done-row-neck").click();
  await page.getByRole("textbox", { name: "Neck in cm" }).fill("38.5");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await settle();
  await expect(page.getByTestId("done-row-neck")).toContainText("38.5 cm");

  expect((await rowsOf(uid)).sort((a, b) => a.site.localeCompare(b.site))).toEqual([
    { site: "chest", side: "none", valueCm: 110.5, measuredOn: "2026-10-01" },
    { site: "neck", side: "none", valueCm: 38.5, measuredOn: "2026-10-01" },
    { site: "upper-arm", side: "right", valueCm: 36.5, measuredOn: "2026-10-01" },
  ]);

  await page.getByRole("link", { name: "Done" }).click();
  await page.waitForURL("**/more/account/measurements");
  await expect(page.getByTestId("measurement-row-neck")).toContainText("38.5 cm");
  await expect(page.getByTestId("measurement-row-upper-arm")).toContainText("R 36.5");
  await expect(page.getByTestId("next-log")).toHaveText("Next log from 15 Oct · every 2 to 4 weeks");

  await page.getByTestId("measurement-row-neck").click();
  await page.waitForURL("**/more/account/measurements/neck");
  await expect(page.getByTestId("measure-guide")).toContainText("Adam's apple");
  await page.getByRole("button", { name: "Delete 1 Oct" }).click();
  await settle();
  await expect(page.getByText("No values yet")).toBeVisible();
  expect((await rowsOf(uid)).map((r) => r.site).sort()).toEqual(["chest", "upper-arm"]);
});
