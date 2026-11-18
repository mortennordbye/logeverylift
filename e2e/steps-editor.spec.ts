import { and, asc, eq, isNull } from "drizzle-orm";
import { athleteThresholds, exercises, programExercises, programSets, programs, users, workoutSessions } from "../src/db/schema";
import { e2eUser } from "./fixtures/env";
import { testDb } from "./fixtures/reset";
import { expect, test } from "./fixtures/test";

/**
 * The step editor (docs/plans/one-program-model.md, step 4): an endurance user
 * builds a run of 4 × (1 km at threshold pace, 2 min easy) in the app, saves
 * it, and the program holds one set per step and round. A run with plain
 * sets offers "Edit as steps" and keeps its set ids when saved as steps.
 */

const pad = (n: number) => String(n).padStart(2, "0");
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function setup(parallelIndex: number, plainSets: { distanceMeters?: number; durationSeconds?: number; targetHeartRateZone?: number }[] = []) {
  const db = testDb();
  const user = await db.query.users.findFirst({ where: eq(users.email, e2eUser(parallelIndex).email) });
  const userId = user!.id;
  await db.delete(workoutSessions).where(eq(workoutSessions.userId, userId));
  await db.delete(athleteThresholds).where(eq(athleteThresholds.userId, userId));
  await db.update(users).set({ enduranceEnabled: true }).where(eq(users.id, userId));
  await db.insert(athleteThresholds).values({ userId, kind: "run_threshold_pace", value: 1000 / 240, measuredOn: today(), source: "manual" });
  const [run] = await db.select({ id: exercises.id }).from(exercises).where(and(eq(exercises.discipline, "run"), isNull(exercises.userId))).orderBy(asc(exercises.id)).limit(1);
  const [program] = await db.insert(programs).values({ userId, name: "Track night" }).returning();
  const [pe] = await db.insert(programExercises).values({ programId: program.id, exerciseId: run.id, orderIndex: 0, progressionAdvance: "manual" }).returning();
  if (plainSets.length) await db.insert(programSets).values(plainSets.map((s, i) => ({ programExerciseId: pe.id, setNumber: i + 1, restTimeSeconds: 60, ...s })));
  return { programId: program.id, peId: pe.id };
}

const rows = (peId: number) =>
  testDb().select().from(programSets).where(and(eq(programSets.programExerciseId, peId), isNull(programSets.deletedAt))).orderBy(asc(programSets.setNumber));

test("build 4 × 1 km in the app and save it as steps", async ({ page }, testInfo) => {
  const { programId, peId } = await setup(testInfo.parallelIndex);
  await page.goto(`/programs/${programId}/exercises/${peId}`);
  const editor = page.getByTestId("steps-editor");
  await expect(editor).toBeVisible();

  // The new exercise starts with one 30 min step; make it the warm-up.
  await editor.getByTestId("step-row").first().click();
  const sheet = page.getByTestId("step-sheet");
  await sheet.getByRole("button", { name: "Warm-up", exact: true }).click();
  await sheet.getByLabel("Minutes").fill("15");
  await sheet.getByRole("button", { name: "Done" }).click();

  await editor.getByRole("button", { name: "Add repeat block" }).click();
  const block = editor.getByTestId("step-block");
  await expect(block.getByTestId("block-rounds")).toHaveText("4 ×");
  await block.getByTestId("step-row").first().click();
  await sheet.getByRole("button", { name: "Distance", exact: true }).click();
  await sheet.getByLabel("Distance in km").fill("1");
  await sheet.getByRole("button", { name: "Pace", exact: true }).click();
  await expect(sheet.getByTestId("step-target-preview")).toHaveText("4:00-4:13/km");
  await sheet.getByRole("button", { name: "Done" }).click();

  await editor.getByRole("button", { name: "Save steps" }).click();
  await expect(editor.getByRole("button", { name: "Saved" })).toBeVisible();

  const stored = await rows(peId);
  expect(stored.map((r) => [r.stepKind, r.blockId, r.blockRound, r.distanceMeters, r.durationSeconds])).toEqual([
    ["warmup", null, null, null, 900],
    ["work", 1, 1, 1000, null],
    ["recovery", 1, 1, null, 120],
    ["work", 1, 2, 1000, null],
    ["recovery", 1, 2, null, 120],
    ["work", 1, 3, 1000, null],
    ["recovery", 1, 3, null, 120],
    ["work", 1, 4, 1000, null],
    ["recovery", 1, 4, null, 120],
  ]);

  // One round less removes a whole round.
  await block.getByRole("button", { name: "One round less" }).click();
  await editor.getByRole("button", { name: "Save steps" }).click();
  await expect(editor.getByRole("button", { name: "Saved" })).toBeVisible();
  await expect.poll(async () => (await rows(peId)).length).toBe(7);
});

test("plain run sets turn into steps and keep their set ids", async ({ page }, testInfo) => {
  const { programId, peId } = await setup(testInfo.parallelIndex, [{ distanceMeters: 2000, targetHeartRateZone: 2 }, { distanceMeters: 1000, targetHeartRateZone: 4 }]);
  const before = (await rows(peId)).map((r) => r.id);
  await page.goto(`/programs/${programId}/exercises/${peId}`);
  await page.getByTestId("edit-as-steps").click();
  const editor = page.getByTestId("steps-editor");
  await expect(editor.getByTestId("steps-converted")).toBeVisible();
  await expect(editor.getByTestId("step-row")).toHaveCount(2);
  await editor.getByRole("button", { name: "Save steps" }).click();
  await expect(editor.getByRole("button", { name: "Saved" })).toBeVisible();
  const after = await rows(peId);
  expect(after.map((r) => r.id)).toEqual(before);
  expect(after.map((r) => [r.stepKind, r.distanceMeters, r.restTimeSeconds])).toEqual([
    ["work", 2000, 60],
    ["work", 1000, 60],
  ]);
});

test("Insert FTP test writes the 20 min test on a bike exercise", async ({ page }, testInfo) => {
  const { programId, peId } = await setup(testInfo.parallelIndex);
  const db = testDb();
  const [bike] = await db.select({ id: exercises.id }).from(exercises).where(and(eq(exercises.discipline, "bike"), isNull(exercises.userId))).orderBy(asc(exercises.id)).limit(1);
  await db.update(programExercises).set({ exerciseId: bike.id }).where(eq(programExercises.id, peId));
  await page.goto(`/programs/${programId}/exercises/${peId}`);
  const editor = page.getByTestId("steps-editor");
  await expect(editor).toBeVisible();

  await editor.getByRole("button", { name: "Insert FTP test" }).click();
  const sheet = page.getByTestId("ftp-test-sheet");
  await sheet.getByRole("button", { name: /^20 min test/ }).click();
  await expect(editor.getByTestId("steps-totals")).toContainText("55:00");
  await editor.getByRole("button", { name: "Save steps" }).click();
  await expect(editor.getByRole("button", { name: "Saved" })).toBeVisible();

  expect((await rows(peId)).map((r) => [r.stepKind, r.durationSeconds])).toEqual([
    ["warmup", 780],
    ["work", 60],
    ["recovery", 300],
    ["work", 60],
    ["recovery", 300],
    ["work", 1200],
    ["cooldown", 600],
  ]);
  const [pe] = await db.select({ rideTest: programExercises.rideTest }).from(programExercises).where(eq(programExercises.id, peId));
  expect(pe.rideTest).toBe("20min");
});
