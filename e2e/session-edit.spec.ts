import { exercisePrs, exercises, users, workoutSessions, workoutSets } from "../src/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { e2eUser } from "./fixtures/env";
import { testDb } from "./fixtures/reset";
import { expect, test } from "./fixtures/test";

/**
 * Correcting a set in a finished session from history: the row changes, and so
 * do the records it earned.
 */
test("a set's weight edited in history is saved and becomes the record", async ({ page }, testInfo) => {
  const db = testDb();
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, e2eUser(testInfo.parallelIndex).email));
  const [exercise] = await db
    .select({ id: exercises.id, name: exercises.name })
    .from(exercises)
    .where(and(isNull(exercises.userId), eq(exercises.category, "strength")))
    .limit(1);
  const startTime = new Date(Date.now() - 3 * 24 * 60 * 60_000);
  const [session] = await db
    .insert(workoutSessions)
    .values({
      userId: user.id,
      date: startTime.toISOString().slice(0, 10),
      startTime,
      endTime: new Date(startTime.getTime() + 45 * 60_000),
      isCompleted: true,
    })
    .returning({ id: workoutSessions.id });
  const [set] = await db
    .insert(workoutSets)
    .values({
      sessionId: session.id,
      exerciseId: exercise.id,
      setNumber: 1,
      actualReps: 5,
      weightKg: "60",
      restTimeSeconds: 90,
      isCompleted: true,
      createdAt: startTime,
    })
    .returning({ id: workoutSets.id });

  await page.goto(`/history/${session.id}`);
  const edit = page.getByRole("button", { name: "Edit", exact: true });
  // A tap before hydration does nothing. React tags hydrated nodes with its props.
  await edit.evaluate((el) =>
    new Promise<void>((resolve) => {
      const check = () =>
        Object.keys(el).some((k) => k.startsWith("__reactProps")) ? resolve() : requestAnimationFrame(check);
      check();
    }),
  );
  await edit.click();
  await page.getByRole("button", { name: `Edit ${exercise.name} set 1` }).click();
  await page.getByLabel("Weight (kg)").fill("72.5");
  await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const [row] = await db.select({ weightKg: workoutSets.weightKg }).from(workoutSets).where(eq(workoutSets.id, set.id));
  expect(Number(row.weightKg)).toBe(72.5);
  const current = await db
    .select({ value: exercisePrs.value })
    .from(exercisePrs)
    .where(
      and(
        eq(exercisePrs.userId, user.id),
        eq(exercisePrs.exerciseId, exercise.id),
        eq(exercisePrs.prType, "weight"),
        isNull(exercisePrs.supersededAt),
      ),
    );
  expect(current.map((r) => Number(r.value))).toEqual([72.5]);

  await page.goto("/more/metrics?tab=records");
  await expect(page.getByRole("region", { name: "Latest PR" }).getByText(exercise.name)).toBeVisible();
  await expect(page.getByText("72.5 kg").first()).toBeVisible();
});
