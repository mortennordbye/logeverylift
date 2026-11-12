import type { Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { planRevisions, programSets, programs, workoutSessions, workoutSets } from "../src/db/schema";
import { testDb } from "./fixtures/reset";
import { expect, test } from "./fixtures/test";
import { openWorkout, trackActions, waitForLiveSession } from "./helpers";

/**
 * A finished workout whose plan changed under it (decision T9,
 * docs/plans/revisions.md 2.7). The logged sets and the finished session are
 * saved, the plan keeps the newer value, the user is told, and the program's
 * history shows the change as "Not applied".
 *
 * The plan change is an assistant's write, made in the database the way the
 * MCP tool leaves it: the new value, the version bump and its revisions.
 */

type Active = { programId: number; sessionId: number; planVersion: number | null };

/** Start a workout, log the first set of the first exercise, and note the ids. */
async function logFirstSet(page: Page) {
  const settle = trackActions(page);
  await openWorkout(page);
  await waitForLiveSession(page);
  const active = await page.evaluate(() => JSON.parse(localStorage.getItem("activeWorkout") ?? "{}") as Active);
  expect(active.planVersion).toBe(1);
  const first = page.getByTestId("exercise-row").first();
  const programExerciseId = Number(await first.getAttribute("data-program-exercise-id"));
  await page.goto((await first.getByRole("link").getAttribute("href"))!);
  const setId = Number(await page.getByTestId("set-row").first().getAttribute("data-set-id"));
  await page.getByRole("button", { name: "Log set 1", exact: true }).click();
  await settle();
  await expect
    .poll(async () => (await testDb().select().from(workoutSets).where(eq(workoutSets.sessionId, active.sessionId))).length)
    .toBe(1);
  const [planned] = await testDb().select().from(programSets).where(eq(programSets.id, setId));
  return { active, programExerciseId, setId, planned };
}

/** An assistant sets the weight of `setId` to 99 kg (version 1 → 2). */
async function assistantChangesWeight(programId: number, programExerciseId: number, planned: typeof programSets.$inferSelect) {
  const db = testDb();
  const base = {
    v: 1,
    program: { id: programId },
    exercises: [{ id: programExerciseId, sets: [{ id: planned.id, weightKg: planned.weightKg, targetReps: planned.targetReps }] }],
  };
  await db.update(programSets).set({ weightKg: "99.00" }).where(eq(programSets.id, planned.id));
  await db.update(programs).set({ version: 2 }).where(eq(programs.id, programId));
  const [{ userId }] = await db.select({ userId: programs.userId }).from(programs).where(eq(programs.id, programId));
  await db.insert(planRevisions).values([
    { userId, objectType: "program", objectId: programId, version: 1, action: "baseline", writer: "user", snapshot: base },
    {
      userId,
      objectType: "program",
      objectId: programId,
      version: 2,
      action: "update",
      writer: "assistant",
      reason: "Heavier top set",
      snapshot: { ...base, exercises: [{ ...base.exercises[0], sets: [{ ...base.exercises[0].sets[0], weightKg: "99.00" }] }] },
    },
  ]);
}

async function expectSavedAndKept(page: Page, active: Active, setId: number) {
  const db = testDb();
  await expect
    .poll(async () => (await db.select().from(workoutSessions).where(eq(workoutSessions.id, active.sessionId)))[0].isCompleted, {
      timeout: 15_000,
    })
    .toBe(true);
  expect(await db.select().from(workoutSets).where(eq(workoutSets.sessionId, active.sessionId))).toHaveLength(1);
  const [kept] = await db.select().from(programSets).where(eq(programSets.id, setId));
  expect(kept.weightKg).toBe("99.00");
  const conflicts = await db
    .select()
    .from(planRevisions)
    .where(and(eq(planRevisions.objectId, active.programId), eq(planRevisions.action, "conflict")));
  expect(conflicts).toHaveLength(1);

  await page.goto(`/programs/${active.programId}/history`);
  await expect(page.getByText("Not applied", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply my value" })).toBeVisible();
}

test("finishing a workout whose plan changed meanwhile saves the workout and keeps the newer plan", async ({ page }) => {
  const { active, programExerciseId, setId, planned } = await logFirstSet(page);
  // The workout changed this set's weight: the finish flushes it to the plan.
  await page.evaluate(
    ([id, reps]) => localStorage.setItem("workoutOverrides", JSON.stringify({ [id]: { targetReps: reps, weightKg: 77.5 } })),
    [setId, planned.targetReps ?? 8] as const,
  );
  await assistantChangesWeight(active.programId, programExerciseId, planned);

  // Reload the workout so the provider picks the override up, then finish the
  // way a lifter does. (A direct load of the finish page renders its timer on
  // the server with another start time and fails hydration.)
  await page.goto(`/programs/${active.programId}/workout`);
  await page.getByRole("button", { name: "Finished", exact: true }).click();
  await page.getByRole("button", { name: "Yes, finish", exact: true }).click();
  await expect(page).toHaveURL(/\/workout\/finish/);
  await page.getByRole("button", { name: "Save Workout" }).click();
  await page.getByRole("button", { name: "Yes, save", exact: true }).click();
  await expect(page.getByText(/One plan change from this workout was not applied/)).toBeVisible();
  // The save then goes home; let that navigation land before the spec moves on.
  await expect(page).toHaveURL(/\/$/);
  await expectSavedAndKept(page, active, setId);
});

test("a queued finish replays its sets and the finish, and drops the conflicting plan change as final", async ({ page }) => {
  const { active, programExerciseId, setId, planned } = await logFirstSet(page);
  await assistantChangesWeight(active.programId, programExerciseId, planned);

  // What the finish page leaves in the queue when it saves offline: the plan
  // flush (with the version the workout started on), then the finish. Seeded
  // directly, because an offline navigation in the browser is not repeatable.
  await page.evaluate(
    ([programId, sessionId, id, reps]) =>
      localStorage.setItem(
        "pendingMutationQueue",
        JSON.stringify([
          {
            id: "flush",
            kind: "flushWorkoutPlan",
            payload: { programId, baseVersion: 1, sets: [{ id, targetReps: reps, weightKg: 77.5 }] },
            queuedAt: 1,
          },
          {
            id: "finish",
            kind: "completeWorkoutSession",
            payload: { sessionId, endTime: new Date().toISOString(), feeling: "Good" },
            queuedAt: 2,
          },
        ]),
      ),
    [active.programId, active.sessionId, setId, planned.targetReps ?? 8] as const,
  );
  await page.evaluate(() => localStorage.removeItem("activeWorkout"));

  await page.goto("/");
  await expect(page.getByText(/Workout saved\. One plan change from your workout was not applied/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/dropped/)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("pendingMutationQueue"))).toBeNull();
  await expectSavedAndKept(page, active, setId);
});
