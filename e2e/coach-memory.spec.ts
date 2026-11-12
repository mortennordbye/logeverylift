import { and, asc, eq } from "drizzle-orm";
import { coachMemory, planRevisions, users } from "../src/db/schema";
import { e2eUser } from "./fixtures/env";
import { testDb } from "./fixtures/reset";
import { expect, test } from "./fixtures/test";
import { trackActions } from "./helpers";

/**
 * Coach memory (docs/plans/ai-coach.md, 2.7): the user adds an entry, edits
 * it, switches it off and deletes it; each change is a row change and a
 * revision written as the user.
 */

async function userId(parallelIndex: number) {
  const [user] = await testDb().select({ id: users.id }).from(users).where(eq(users.email, e2eUser(parallelIndex).email));
  return user.id;
}

const entries = (uid: string) => testDb().select().from(coachMemory).where(eq(coachMemory.userId, uid)).orderBy(asc(coachMemory.id));

test("add, edit, switch off and delete a coach memory entry", async ({ page }, testInfo) => {
  const settle = trackActions(page);
  const uid = await userId(testInfo.parallelIndex);

  await page.goto("/more");
  await page.getByRole("link", { name: /Coach memory/ }).click();
  await expect(page).toHaveURL(/\/more\/coach-memory$/);
  await expect(page.getByTestId("memory-empty")).toBeVisible();

  await page.getByRole("button", { name: "Add an entry", exact: true }).click();
  await page.getByRole("radio", { name: "Life limit" }).click();
  await page.getByRole("textbox", { name: "Entry" }).fill("Hotel gym only on trips");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await settle();
  await expect(page.getByText("Limits in your life")).toBeVisible();
  await expect(page.getByTestId("memory-entry")).toContainText("Hotel gym only on trips");
  await expect.poll(async () => (await entries(uid)).map((e) => [e.kind, e.text, e.active])).toEqual([["limit", "Hotel gym only on trips", true]]);

  await page.getByTestId("memory-entry").click();
  await page.getByRole("textbox", { name: "Entry" }).fill("Hotel gym or bands on trips");
  await page.getByRole("switch", { name: /In use/ }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await settle();
  await expect(page.getByText("Not in use (1)")).toBeVisible();
  await expect.poll(async () => (await entries(uid)).map((e) => [e.text, e.active])).toEqual([["Hotel gym or bands on trips", false]]);

  await page.getByText("Not in use (1)").click();
  await page.getByTestId("memory-entry").click();
  await page.getByRole("button", { name: "Delete entry", exact: true }).click();
  await page.getByRole("button", { name: "Delete for sure", exact: true }).click();
  await settle();
  await expect(page.getByTestId("memory-empty")).toBeVisible();

  const [row] = await entries(uid);
  expect(row.deletedAt).not.toBeNull();
  const revs = await testDb()
    .select({ action: planRevisions.action, writer: planRevisions.writer })
    .from(planRevisions)
    .where(and(eq(planRevisions.objectType, "memory"), eq(planRevisions.objectId, row.id)))
    .orderBy(asc(planRevisions.id));
  expect(revs).toEqual([
    { action: "create", writer: "user" },
    { action: "update", writer: "user" },
    { action: "delete", writer: "user" },
  ]);
});
