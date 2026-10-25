import { exercises, programExercises, programs, users, workoutSessions, workoutSets } from "../src/db/schema";
import { eq, isNull } from "drizzle-orm";
import { e2eUser } from "./fixtures/env";
import { testDb } from "./fixtures/reset";
import { expect, test } from "./fixtures/test";

/**
 * Data that was stored but never shown: a failed set, the day a make-up stood
 * in for, and the setup notes on a program exercise.
 */

async function userId(workerIndex: number): Promise<string> {
  const [user] = await testDb()
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, e2eUser(workerIndex).email));
  return user.id;
}

test("history shows a failed set and what a make-up stood in for", async ({ page }, testInfo) => {
  const db = testDb();
  const uid = await userId(testInfo.parallelIndex);
  const [exercise] = await db.select({ id: exercises.id }).from(exercises).where(isNull(exercises.userId)).limit(1);
  const startTime = new Date();
  const [session] = await db
    .insert(workoutSessions)
    .values({
      userId: uid,
      date: startTime.toISOString().slice(0, 10),
      startTime,
      endTime: new Date(startTime.getTime() + 45 * 60_000),
      isCompleted: true,
      // A Monday, so the label is checkable without depending on today.
      intendedDate: "2026-05-04",
    })
    .returning({ id: workoutSessions.id });
  await db.insert(workoutSets).values([
    { sessionId: session.id, exerciseId: exercise.id, setNumber: 1, actualReps: 8, weightKg: "60", restTimeSeconds: 90, isCompleted: true },
    { sessionId: session.id, exerciseId: exercise.id, setNumber: 2, actualReps: 3, weightKg: "60", restTimeSeconds: 90, isCompleted: true, isFailed: true },
  ]);

  await page.goto("/history");
  const row = page.locator(`a[href="/history/${session.id}"]`);
  await expect(row.getByText("Make-up for Monday, May 4")).toBeVisible();

  await row.click();
  await expect(page).toHaveURL(new RegExp(`/history/${session.id}$`));
  await expect(page.getByText("Failed", { exact: true })).toHaveCount(1);
});

test("program exercise notes save on the program and show in the workout", async ({ page }, testInfo) => {
  const uid = await userId(testInfo.parallelIndex);
  const [slot] = await testDb()
    .select({ id: programExercises.id, programId: programExercises.programId })
    .from(programExercises)
    .innerJoin(programs, eq(programs.id, programExercises.programId))
    .where(eq(programs.userId, uid))
    .limit(1);

  await page.goto(`/programs/${slot.programId}/exercises/${slot.id}`);
  const notes = page.getByRole("textbox", { name: "Setup notes" });
  // Text typed before hydration is reset to React's state and its onBlur never
  // runs (WebKit got there first). React tags hydrated nodes with its props.
  await notes.evaluate((el) =>
    new Promise<void>((resolve) => {
      const check = () =>
        Object.keys(el).some((k) => k.startsWith("__reactProps")) ? resolve() : requestAnimationFrame(check);
      check();
    }),
  );
  await notes.fill("Seat 4, feet high");
  await notes.blur();

  await expect
    .poll(async () => {
      const [row] = await testDb()
        .select({ notes: programExercises.notes })
        .from(programExercises)
        .where(eq(programExercises.id, slot.id));
      return row.notes;
    })
    .toBe("Seat 4, feet high");

  await page.goto(`/programs/${slot.programId}/workout/exercises/${slot.id}`);
  await expect(page.getByText("Seat 4, feet high")).toBeVisible();
});
