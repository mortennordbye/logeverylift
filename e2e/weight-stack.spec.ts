import { and, eq } from "drizzle-orm";
import { exercises, programExercises, programSets, programs } from "../src/db/schema";
import { testDb } from "./fixtures/reset";
import { expect, test } from "./fixtures/test";
import { openFirstExercise, openWorkout, tapAndSave, trackActions, waitForLiveSession } from "./helpers";

/**
 * A custom weight teaches the stack, from the session that logs it to the next
 * one. The unit and integration suites cover the rules; this is the whole loop
 * in a browser: finish a real workout, come back, and see weights the machine
 * has, both on the suggestion and in the picker.
 */

test("a custom cable weight changes the next suggestion and the picker, and can be forgotten", async ({ page }) => {
  const db = testDb();
  // Exercise names are unique across users, and workers run side by side.
  const NAME = `Stack Spec Pushdown ${Date.now()}-${test.info().workerIndex}-${test.info().repeatEachIndex}`;
  await openWorkout(page);
  await openFirstExercise(page);
  await waitForLiveSession(page);
  const [, programId, slotId] = page.url().match(/\/programs\/(\d+)\/workout\/exercises\/(\d+)/)!.map(Number);

  // A custom exercise rather than editing a built-in one: those are shared with
  // the specs running in the other workers, and this one goes with the reset.
  const [{ userId }] = await db
    .select({ userId: programs.userId })
    .from(programs)
    .where(eq(programs.id, programId));
  const [exercise] = await db
    .insert(exercises)
    .values({ name: NAME, category: "strength", equipment: "cable", userId })
    .returning({ id: exercises.id });
  await db
    .update(programExercises)
    .set({
      exerciseId: exercise.id,
      progressionAdvance: "load",
      progressionScope: "all",
      progressionRequiredHits: 1,
      overloadIncrementKg: null,
      progressionConfigAt: null,
    })
    .where(eq(programExercises.id, slotId));
  await db
    .update(programSets)
    .set({ weightKg: "18", setType: "working" })
    .where(eq(programSets.programExerciseId, slotId));

  const workout = `/programs/${programId}/workout`;
  // Reloaded, then Back as a lifter would: a goto here can be cut off by the
  // exercise page's own navigation settling.
  await page.reload();
  await page.getByRole("link", { name: "Back" }).click();
  await page.waitForURL(`**${workout}`);
  // Started after the reload: a request it cut off would never settle.
  const settle = trackActions(page);
  await page.getByRole("button", { name: `Mark ${NAME} as done`, exact: true }).click();
  await expect(page.getByRole("button", { name: `Mark ${NAME} as not done`, exact: true })).toBeVisible();
  await settle();

  await page.getByRole("button", { name: "Finished", exact: true }).click();
  await page.getByRole("button", { name: "Yes, finish", exact: true }).click();
  await expect(page).toHaveURL(/\/workout\/finish/);
  await page.getByRole("button", { name: "Save Workout" }).click();
  await page.getByRole("button", { name: "Yes, save", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await settle();

  const stored = async () =>
    (
      await db
        .select({ weightStack: programExercises.weightStack })
        .from(programExercises)
        .where(and(eq(programExercises.id, slotId), eq(programExercises.exerciseId, exercise.id)))
    )[0].weightStack;
  await expect.poll(stored).toBe("kg4_5");

  // Next time: the suggestion is the stack's next weight, not 18.75.
  await page.goto(`${workout}/exercises/${slotId}`);
  await waitForLiveSession(page);
  const row = page.getByTestId("set-row").first();
  await expect(row.getByRole("button", { name: /^↑ 22\.5kg/ })).toBeVisible({ timeout: 10_000 });

  // The picker offers the stack's weights.
  await row.getByTestId("set-prescription").click();
  await page.waitForURL(/\/sets\/\d+$/);
  await page.getByRole("button", { name: /^Weight \(kg\)/ }).click();
  const picker = page.getByRole("dialog");
  await expect(picker.getByRole("button", { name: "22.5 kg", exact: true })).toBeVisible();
  await expect(picker.getByRole("button", { name: "18.75 kg", exact: true })).toHaveCount(0);

  // And it can be forgotten from the progression sheet.
  await page.goto(`${workout}/exercises/${slotId}`);
  await page.getByRole("button", { name: "Progression settings" }).click();
  await expect(page.getByText("Learned stack: 4.5 kg steps")).toBeVisible();
  await tapAndSave(page, page.getByRole("button", { name: "Forget", exact: true }), {
    bodyIncludes: `"programExerciseId":${slotId}`,
  });
  await expect(page.getByText("Learned stack: 4.5 kg steps")).toHaveCount(0);
  await expect.poll(stored).toBeNull();
});
