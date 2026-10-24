import type { Page } from "@playwright/test";
import { and, asc, eq } from "drizzle-orm";
import { programExercises, programSets, programs, workoutSessions, workoutSets } from "../src/db/schema";
import { testDb } from "./fixtures/reset";
import { expect, test } from "./fixtures/test";
import { openFirstExercise, openWorkout, stableBox, tapAndSave, trackActions, waitForLiveSession } from "./helpers";

/**
 * A suggestion from history to the plan, in a real browser.
 *
 * The engine is unit-tested and the queries are integration-tested; this is
 * the part neither reaches: the chip a lifter sees after two clean sessions,
 * what tapping it writes, and the two ways a change to today's numbers must
 * not leak into the programme (a low-readiness day, and a corrected rep count).
 *
 * History is written straight to the database rather than logged through the
 * UI, so the spec controls exactly which sessions the engine reads.
 */

type Slot = { programId: number; slotId: number; setId: number; weightKg: number; targetReps: number };

/** The first exercise's slot, read off the URL the set list is on. */
async function openSlot(page: Page): Promise<Slot> {
  await openWorkout(page);
  await openFirstExercise(page);
  await waitForLiveSession(page);
  const [, programId, slotId] = page.url().match(/\/programs\/(\d+)\/workout\/exercises\/(\d+)/)!.map(Number);
  const [first] = await testDb()
    .select({ id: programSets.id, weightKg: programSets.weightKg, targetReps: programSets.targetReps })
    .from(programSets)
    .where(and(eq(programSets.programExerciseId, slotId), eq(programSets.setType, "working")))
    .orderBy(asc(programSets.setNumber))
    .limit(1);
  return {
    programId,
    slotId,
    setId: first.id,
    weightKg: Number(first.weightKg),
    targetReps: first.targetReps ?? 0,
  };
}

/**
 * Load progression with a fixed 2.5kg step and the plan opt-in on, and two
 * completed sessions that cleared every working set at the planned numbers,
 * newer than anything the seed wrote.
 */
async function twoCleanSessions(slot: Slot, readiness: "hold" | "reduce") {
  const db = testDb();
  await db
    .update(programExercises)
    .set({
      progressionAdvance: "load",
      progressionScope: "all",
      progressionRequiredHits: 2,
      progressionRegress: "backoff",
      progressionReadiness: readiness,
      overloadIncrementKg: "2.50",
      progressionApplyToPlan: true,
      progressionConfigAt: null,
    })
    .where(eq(programExercises.id, slot.slotId));

  const [pe] = await db
    .select({ exerciseId: programExercises.exerciseId, userId: programs.userId })
    .from(programExercises)
    .innerJoin(programs, eq(programs.id, programExercises.programId))
    .where(eq(programExercises.id, slot.slotId));
  const working = await db
    .select()
    .from(programSets)
    .where(and(eq(programSets.programExerciseId, slot.slotId), eq(programSets.setType, "working")))
    .orderBy(asc(programSets.setNumber));

  const today = new Date().toISOString().slice(0, 10);
  for (const hoursAgo of [2, 1]) {
    const startTime = new Date(Date.now() - hoursAgo * 3_600_000);
    const [session] = await db
      .insert(workoutSessions)
      .values({
        userId: pe.userId,
        programId: slot.programId,
        date: today,
        startTime,
        endTime: startTime,
        isCompleted: true,
        feeling: "Good",
      })
      .returning({ id: workoutSessions.id });
    await db.insert(workoutSets).values(
      working.map((s, i) => ({
        sessionId: session.id,
        exerciseId: pe.exerciseId,
        programExerciseId: slot.slotId,
        programSetId: s.id,
        setNumber: i + 1,
        setType: "working",
        prescribedWorkingSets: working.length,
        targetReps: s.targetReps,
        actualReps: s.targetReps ?? 0,
        weightKg: s.weightKg ?? "0",
        restTimeSeconds: 0,
        isCompleted: true,
      })),
    );
  }
}

const plannedSet = async (setId: number) =>
  (
    await testDb()
      .select({ weightKg: programSets.weightKg, targetReps: programSets.targetReps })
      .from(programSets)
      .where(eq(programSets.id, setId))
  )[0];

test("two clean sessions offer a bump, and taking it writes the plan", async ({ page }) => {
  const slot = await openSlot(page);
  if (slot.weightKg <= 0) throw new Error("First exercise carries no load; the seed puts Bench Press first.");
  await twoCleanSessions(slot, "hold");
  await page.reload();

  const next = slot.weightKg + 2.5;
  const chip = page.getByTestId("set-row").first().getByRole("button", { name: `↑ ${next}kg` });
  await expect(chip).toBeVisible({ timeout: 10_000 });
  await tapAndSave(page, chip, { bodyIncludes: '"updates"' });

  await expect(page.getByTestId("set-row").first().getByRole("button", { name: `✓ ${next}kg` })).toBeVisible();
  // The run that earned the bump is spent once it is taken.
  await expect(
    page.getByTestId("set-row").first().getByRole("button", { name: "Progress: 0 of 2 sessions since the increase" }),
  ).toBeVisible();
  await expect.poll(async () => Number((await plannedSet(slot.setId)).weightKg)).toBe(next);
});

test("a low-readiness day under reduce is lighter today and leaves the plan alone", async ({ page }) => {
  const slot = await openSlot(page);
  if (slot.weightKg <= 0) throw new Error("First exercise carries no load; the seed puts Bench Press first.");
  await twoCleanSessions(slot, "reduce");
  const sessionId = await page.evaluate(
    () => JSON.parse(localStorage.getItem("activeWorkout") ?? "{}").sessionId as number,
  );
  await testDb().update(workoutSessions).set({ readiness: 1 }).where(eq(workoutSessions.id, sessionId));
  await page.reload();

  const chip = page.getByTestId("set-row").first().getByRole("button", { name: /— lighter today$/ });
  await expect(chip).toBeVisible({ timeout: 10_000 });
  const settled = trackActions(page);
  await chip.click();
  await settled();

  expect(Number((await plannedSet(slot.setId)).weightKg)).toBe(slot.weightKg);
});

test("correcting reps mid-workout keeps the plan's target unless asked to change it", async ({ page }) => {
  const slot = await openSlot(page);
  if (slot.targetReps < 3) throw new Error("First set has no rep target to fall short of; the seed puts Bench Press first.");
  const short = slot.targetReps - 2;
  // Opened by tapping the row, as a lifter does. A goto to the editor's URL
  // can be cut off by the list's own navigation settling.
  const openEditor = async () => {
    await page
      .locator(`[data-testid="set-row"][data-set-id="${slot.setId}"]`)
      .getByTestId("set-prescription")
      .click();
    await page.waitForURL(new RegExp(`/sets/${slot.setId}$`));
  };

  const correctTo = async (reps: number) => {
    await page.getByRole("button", { name: /^Reps done/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: String(reps), exact: true }).click();
  };
  const save = async () => {
    // The editor waits for its writes before it navigates back, so being back
    // on the list means every write it started has finished.
    //
    // tapAndSave, not click: on WebKit, scrolling the switch into view scrolls
    // the window, ViewportFix snaps it back, and a Save tap aimed a moment
    // before the snap lands 64px off. Saving mid-workout always writes the
    // set's note, so a tap that never started a write is retried.
    await tapAndSave(page, page.getByRole("button", { name: "Save", exact: true }));
    await expect(page).toHaveURL(/\/exercises\/\d+$/);
  };

  // A short set is a miss against the target that stands.
  await openEditor();
  await correctTo(short);
  await expect(page.getByRole("switch", { name: new RegExp(`change the program target to ${short}`) })).toBeVisible();
  await save();
  expect((await plannedSet(slot.setId)).targetReps).toBe(slot.targetReps);

  // The program was wrong: the explicit toggle rewrites the target.
  await openEditor();
  await expect(page.getByRole("button", { name: new RegExp(`^Reps done\\s*${short}$`) })).toBeVisible();
  await page.getByRole("switch", { name: new RegExp(`change the program target to ${short}`) }).click();
  await save();
  await expect.poll(async () => (await plannedSet(slot.setId)).targetReps).toBe(short);
});

test("a set logged short empties the dots on the spot and says the count starts over", async ({ page }) => {
  const slot = await openSlot(page);
  if (slot.targetReps < 3) throw new Error("First set has no rep target to fall short of; the seed puts Bench Press first.");
  await twoCleanSessions(slot, "hold");
  await page.reload();
  await waitForLiveSession(page);

  const row = page.getByTestId("set-row").first();
  await expect(row.getByRole("button", { name: /^Progress: 2 of 2 sessions$/ })).toBeVisible({ timeout: 10_000 });

  // Long press into the miss sheet, held open past its 450ms timer.
  const toggle = row.getByRole("button", { name: /^(Log|Un-log) set 1$/ });
  const box = await stableBox(toggle);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // Holding the press is the action under test.
  // eslint-disable-next-line no-restricted-syntax
  await page.waitForTimeout(700);
  await page.mouse.up();
  await expect(page.getByRole("dialog").getByText("Reps done")).toBeVisible({ timeout: 5_000 });
  await page.getByRole("button", { name: "One rep fewer" }).click();
  await tapAndSave(page, page.getByRole("button", { name: "Log set", exact: true }), {
    bodyIncludes: '"actualReps":',
  });

  await expect(row.getByRole("button", { name: "Missed this session: count starts over, 0 of 2 sessions" })).toBeVisible();
  await expect(page.getByText(`Set 1: ${slot.targetReps - 1} of ${slot.targetReps}. Count starts over.`, { exact: false })).toBeVisible();

  // Un-logging takes the miss back.
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(row.getByRole("button", { name: /^Progress: 2 of 2 sessions$/ })).toBeVisible();
});
