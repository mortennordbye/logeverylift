import { eq } from "drizzle-orm";
import { athleteInjuries, illnessPeriods, users } from "../src/db/schema";
import { e2eUser } from "./fixtures/env";
import { testDb } from "./fixtures/reset";
import { expect, test } from "./fixtures/test";
import { trackActions } from "./helpers";

/**
 * The profile facts on Account (docs/plans/account-profile.md): each row opens
 * its editor in a sheet and saves only that field. With the endurance switch
 * on, injuries and sick periods open their list, and their own sheet over it.
 */

async function userId(parallelIndex: number) {
  const [user] = await testDb().select({ id: users.id }).from(users).where(eq(users.email, e2eUser(parallelIndex).email));
  return user.id;
}

test("a row opens its editor and saves that field", async ({ page }, testInfo) => {
  const settle = trackActions(page);
  const uid = await userId(testInfo.parallelIndex);
  await testDb().update(users).set({ heightCm: null, gender: null }).where(eq(users.id, uid));

  await page.goto("/more/account");
  await page.getByTestId("account-group-body-and-health").click();
  await page.waitForURL("**/more/account/body-and-health");
  await page.getByTestId("account-height").click();
  await page.getByRole("spinbutton", { name: "Height" }).fill("182");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await settle();
  await expect(page.getByTestId("account-height")).toContainText("182 cm");

  await page.getByTestId("account-gender").click();
  await page.getByRole("button", { name: "Female", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await settle();
  await expect(page.getByTestId("account-gender")).toContainText("Female");

  const [row] = await testDb().select({ heightCm: users.heightCm, gender: users.gender }).from(users).where(eq(users.id, uid));
  expect(row).toEqual({ heightCm: 182, gender: "female" });
});

test("injuries and sick periods open their list and editor from Account", async ({ page }, testInfo) => {
  const settle = trackActions(page);
  const uid = await userId(testInfo.parallelIndex);
  await testDb().update(users).set({ enduranceEnabled: true }).where(eq(users.id, uid));

  await page.goto("/more/account/body-and-health");
  await page.getByTestId("account-injuries").click();
  await page.getByRole("button", { name: "Add an injury" }).click();
  await page.getByRole("textbox", { name: "What happens" }).fill("Sore after long runs");
  await page.getByRole("button", { name: "Save injury" }).click();
  await settle();
  await expect(page.getByTestId("injury-row")).toContainText("Sore after long runs");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("account-injuries")).toContainText("1 current");

  await page.getByTestId("account-sick-periods").click();
  await expect(page.getByTestId("consistency")).toBeVisible();
  await page.getByRole("button", { name: "Add a sick period" }).click();
  await page.getByRole("button", { name: "Save sick period" }).click();
  await settle();
  await expect(page.getByTestId("illness-row")).toContainText("still sick");

  expect(await testDb().select({ id: athleteInjuries.id }).from(athleteInjuries).where(eq(athleteInjuries.userId, uid))).toHaveLength(1);
  const [sick] = await testDb().select().from(illnessPeriods).where(eq(illnessPeriods.userId, uid));
  expect(sick.endedOn).toBeNull();
});

test("the goal chips open from the Goals row and save", async ({ page }, testInfo) => {
  const settle = trackActions(page);
  const uid = await userId(testInfo.parallelIndex);
  await testDb().update(users).set({ goals: null }).where(eq(users.id, uid));

  await page.goto("/more/account/goals-and-training");
  await page.getByRole("button", { name: /^Goals/ }).click();
  await page.getByRole("button", { name: "Endurance", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await settle();

  const [row] = await testDb().select({ goals: users.goals }).from(users).where(eq(users.id, uid));
  expect(row.goals).toBe(JSON.stringify(["endurance"]));
});
