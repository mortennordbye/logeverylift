import { and, asc, eq } from "drizzle-orm";
import { athleteThresholds, planRevisions, users } from "../src/db/schema";
import { e2eUser } from "./fixtures/env";
import { testDb } from "./fixtures/reset";
import { expect, test } from "./fixtures/test";
import { trackActions } from "./helpers";

/**
 * Thresholds for every user (docs/plans/athlete-profile.md, 2.9; D15): a
 * lifter with the endurance switch off enters FTP by hand, sees it in the
 * history, deletes it and restores it. The Athlete profile entry stays hidden.
 */

async function userId(parallelIndex: number) {
  const [user] = await testDb().select({ id: users.id }).from(users).where(eq(users.email, e2eUser(parallelIndex).email));
  return user.id;
}

const rows = (uid: string) => testDb().select().from(athleteThresholds).where(eq(athleteThresholds.userId, uid)).orderBy(asc(athleteThresholds.id));

test("a lifter enters, deletes and restores a threshold", async ({ page }, testInfo) => {
  const settle = trackActions(page);
  const uid = await userId(testInfo.parallelIndex);

  await page.goto("/more");
  await expect(page.getByRole("link", { name: /Athlete profile/ })).toHaveCount(0);
  await page.getByRole("link", { name: /Thresholds/ }).click();
  await expect(page).toHaveURL(/\/more\/thresholds$/);
  await expect(page.getByTestId("threshold-ftp")).toContainText("Not set");

  await page.getByTestId("threshold-ftp").click();
  await page.getByRole("textbox", { name: "FTP" }).fill("255");
  await expect(page.getByTestId("threshold-preview")).toHaveText("FTP: 255 W");
  await page.getByRole("button", { name: "Save FTP" }).click();
  await settle();
  await expect(page.getByTestId("threshold-ftp")).toContainText("255 W");
  await expect.poll(async () => (await rows(uid)).map((r) => [r.kind, r.value, r.source])).toEqual([["ftp", 255, "manual"]]);

  await page.getByTestId("threshold-ftp").click();
  await expect(page.getByTestId("threshold-history-row")).toContainText("255 W");
  await page.getByRole("button", { name: /^Delete 255 W/ }).click();
  await settle();
  await expect(page.getByTestId("threshold-ftp")).toContainText("Not set");

  await page.getByText("Recently deleted (1)").click();
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await settle();
  await expect(page.getByTestId("threshold-ftp")).toContainText("255 W");

  const [row] = await rows(uid);
  expect(row.deletedAt).toBeNull();
  const revs = await testDb()
    .select({ action: planRevisions.action, writer: planRevisions.writer })
    .from(planRevisions)
    .where(and(eq(planRevisions.objectType, "threshold"), eq(planRevisions.objectId, row.id)))
    .orderBy(asc(planRevisions.id));
  expect(revs).toEqual([
    { action: "create", writer: "user" },
    { action: "delete", writer: "user" },
    { action: "restore", writer: "user" },
  ]);
});
