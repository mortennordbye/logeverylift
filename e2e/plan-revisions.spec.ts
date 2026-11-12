import { asc, eq } from "drizzle-orm";
import { programExercises, programSets, programs, users } from "../src/db/schema";
import { e2eUser } from "./fixtures/env";
import { testDb } from "./fixtures/reset";
import { expect, test } from "./fixtures/test";
import { trackActions } from "./helpers";

/**
 * Plan history and restore (docs/plans/revisions.md, 2.6 and 2.9): a change
 * shows in the program's history, a restore brings the old state back with
 * the same set ids, and a deleted program comes back from Recently deleted.
 */

async function firstProgram(parallelIndex: number) {
  const db = testDb();
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, e2eUser(parallelIndex).email));
  const [program] = await db
    .select({ id: programs.id, name: programs.name })
    .from(programs)
    .where(eq(programs.userId, user.id))
    .orderBy(asc(programs.name))
    .limit(1);
  return program;
}

async function setIdsOf(programId: number) {
  const rows = await testDb()
    .select({ id: programSets.id })
    .from(programSets)
    .innerJoin(programExercises, eq(programExercises.id, programSets.programExerciseId))
    .where(eq(programExercises.programId, programId))
    .orderBy(asc(programSets.id));
  return rows.map((r) => r.id);
}

const nameOf = async (id: number) =>
  // plan-read: includes deleted (the spec reads what the flow wrote)
  (await testDb().select({ name: programs.name, deletedAt: programs.deletedAt }).from(programs).where(eq(programs.id, id)))[0];

test("a rename shows in the history, and restoring the earlier version brings the old name back with the same sets", async ({ page }, testInfo) => {
  const settle = trackActions(page);
  const program = await firstProgram(testInfo.parallelIndex);
  const setsBefore = await setIdsOf(program.id);

  await page.goto(`/programs/${program.id}`);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.locator("input").first().fill(`${program.name} renamed`);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await settle();
  await expect.poll(async () => (await nameOf(program.id)).name).toBe(`${program.name} renamed`);

  await page.getByRole("link", { name: "History", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/programs/${program.id}/history$`));
  await expect(page.getByText(`Renamed "${program.name}" → "${program.name} renamed"`)).toBeVisible();
  await expect(page.getByText("Before history started", { exact: true })).toBeVisible();

  // Only the older entry can be restored; the newest is the current state.
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Restore this version?" })).toBeVisible();
  await page.getByRole("button", { name: "Restore", exact: true }).last().click();
  await settle();

  await expect.poll(async () => (await nameOf(program.id)).name).toBe(program.name);
  expect(await setIdsOf(program.id)).toEqual(setsBefore);
  await expect(page.getByText(/restored/).first()).toBeVisible();
});

test("a deleted program comes back from Recently deleted with the same ids", async ({ page }, testInfo) => {
  const settle = trackActions(page);
  const program = await firstProgram(testInfo.parallelIndex);
  const setsBefore = await setIdsOf(program.id);

  await page.goto("/programs");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("button", { name: `Select ${program.name}`, exact: true }).click();
  await page.getByRole("button", { name: "Delete 1 selected" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await settle();
  await expect.poll(async () => (await nameOf(program.id)).deletedAt).not.toBeNull();

  await page.goto("/programs");
  await page.getByRole("button", { name: /Recently deleted \(1\)/ }).click();
  await page.getByTestId("recently-deleted-programs").getByRole("button", { name: "Restore", exact: true }).click();
  await settle();
  await expect.poll(async () => (await nameOf(program.id)).deletedAt).toBeNull();
  expect(await setIdsOf(program.id)).toEqual(setsBefore);
  await expect(page.locator(`a[href="/programs/${program.id}"]`)).toBeVisible();
});
