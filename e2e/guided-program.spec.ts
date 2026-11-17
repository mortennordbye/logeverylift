import { and, asc, eq, isNull } from "drizzle-orm";
import { athleteThresholds, exercises, plannedSessions, programExercises, programSets, programs, trainingCycleSlots, trainingCycles, users, workoutSessions, workoutSets } from "../src/db/schema";
import { workoutToRows } from "../src/lib/utils/program-steps";
import type { Workout } from "../src/lib/utils/workout-steps";
import { e2eUser } from "./fixtures/env";
import { testDb } from "./fixtures/reset";
import { expect, test } from "./fixtures/test";

/**
 * The guided player on a program with structured steps
 * (docs/plans/one-program-model.md, step 3): today's planned session runs a
 * program whose ride is stored as program sets. The workout screen shows the
 * totals and "Start guided", the player runs the steps, and the results save
 * as one logged set per step, each with its status and a copy of its plan.
 */
test.use({ timezoneId: "Pacific/Kiritimati" });

const pad = (n: number) => String(n).padStart(2, "0");
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const ride: Workout = {
  v: 2,
  sport: "bike",
  name: "Steps ride",
  steps: [
    { type: "warmup", end: { type: "time", seconds: 5 }, target: { metric: "power", anchor: "ftp", low: 50, high: 70 } },
    { type: "work", end: { type: "time", seconds: 6 }, target: { metric: "power", anchor: "ftp", low: 88, high: 93 } },
    { type: "work", end: { type: "time", seconds: 600 }, target: { metric: "power", anchor: "ftp", low: 75, high: 80 } },
    { type: "cooldown", end: { type: "lap" } },
  ],
};

async function setup(parallelIndex: number) {
  const db = testDb();
  const user = await db.query.users.findFirst({ where: eq(users.email, e2eUser(parallelIndex).email) });
  const userId = user!.id;
  await db.delete(workoutSessions).where(eq(workoutSessions.userId, userId));
  await db.delete(trainingCycles).where(eq(trainingCycles.userId, userId));
  await db.delete(athleteThresholds).where(eq(athleteThresholds.userId, userId));
  await db.update(users).set({ enduranceEnabled: true, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }).where(eq(users.id, userId));
  await db.insert(athleteThresholds).values({ userId, kind: "ftp", value: 250, measuredOn: today(), source: "manual" });
  const [bike] = await db.select({ id: exercises.id }).from(exercises).where(and(eq(exercises.discipline, "bike"), isNull(exercises.userId))).orderBy(asc(exercises.id)).limit(1);
  const [program] = await db.insert(programs).values({ userId, name: "Steps ride" }).returning();
  const [pe] = await db.insert(programExercises).values({ programId: program.id, exerciseId: bike.id, orderIndex: 0, progressionAdvance: "manual" }).returning();
  await db.insert(programSets).values(workoutToRows(ride).map((r) => ({ ...r, programExerciseId: pe.id, restTimeSeconds: 0 })));
  const [cycle] = await db
    .insert(trainingCycles)
    .values({ userId, name: "Tri block", durationWeeks: 4, status: "active", startDate: today(), sessionsGeneratedAt: new Date() })
    .returning();
  const [row] = await db.insert(plannedSessions).values({ userId, cycleId: cycle.id, date: today(), programId: program.id }).returning({ id: plannedSessions.id });
  return { userId, plannedId: row.id, programId: program.id };
}

let hydrationErrors: string[] = [];
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: { request: async () => ({ release: async () => undefined }) },
    });
  });
  hydrationErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && /Hydration|#418|#423|did not match/i.test(msg.text())) hydrationErrors.push(msg.text());
  });
});
test.afterEach(() => {
  expect(hydrationErrors, "hydration errors in the browser console").toEqual([]);
});

test("a program with steps: the workout screen starts the player, and each step logs as a set", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const { userId, plannedId, programId } = await setup(testInfo.parallelIndex);

  await page.goto(`/programs/${programId}/workout`);
  const entry = page.getByTestId("guided-entry").first();
  // The cool-down ends on the lap button, so the load counts what it can.
  await expect(entry).toContainText("load at least");
  // The workout screen opens its session in the background. Wait for it before the
  // fake clock goes in: a session opened after it would start on 1 January 1970, the
  // save would not find it as today's, and the day would hold two sessions.
  await expect.poll(async () => (await testDb().select().from(workoutSessions).where(eq(workoutSessions.userId, userId))).length).toBe(1);
  await page.clock.install();
  await entry.getByRole("link", { name: "Start guided" }).click();
  await expect(page).toHaveURL(new RegExp(`/planned/${plannedId}/play`));

  await expect(page.getByTestId("player-ready")).toBeVisible();
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByTestId("player-step-count")).toHaveText("Step 1 of 4");
  await expect(page.getByTestId("player-target")).toHaveText("125-175 W");
  await page.clock.runFor(5_500);
  await expect(page.getByTestId("player-step-count")).toHaveText("Step 2 of 4");
  await page.clock.runFor(6_500);
  await expect(page.getByTestId("player-step-count")).toHaveText("Step 3 of 4");
  await page.getByRole("button", { name: "Skip" }).click();
  await page.getByRole("button", { name: "Lap" }).click();

  await expect(page).toHaveURL(new RegExp(`/planned/${plannedId}/results`));
  await expect(page.getByTestId("result-step")).toHaveCount(4);
  await page.getByRole("button", { name: "7", exact: true }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(new RegExp(`/planned/${plannedId}$`));

  const db = testDb();
  await expect
    .poll(async () => (await db.select().from(workoutSessions).where(eq(workoutSessions.userId, userId))).map((s) => [s.plannedSessionId, s.programId, s.isCompleted]))
    .toEqual([[plannedId, programId, true]]);
  const [session] = await db.select().from(workoutSessions).where(eq(workoutSessions.userId, userId));
  const sets = await db.select().from(workoutSets).where(eq(workoutSets.sessionId, session.id)).orderBy(asc(workoutSets.setNumber));
  expect(sets.map((s) => s.stepStatus)).toEqual(["done", "done", "skipped", "done"]);
  expect(sets.every((s) => s.plannedStep != null)).toBe(true);
  expect(sets[0].rpe).toBe(7);

  await page.goto("/week");
  const week = page.getByTestId("week-session").filter({ hasText: "Steps ride" });
  await expect(week).toContainText("done 00:1");
});

test("home: Start Today's Workout asks guided or by hand on a day with steps", async ({ page }, testInfo) => {
  const { plannedId, programId } = await setup(testInfo.parallelIndex);
  // Today's slot runs the program, so the Today card starts it.
  const db = testDb();
  const [ps] = await db.select().from(plannedSessions).where(eq(plannedSessions.id, plannedId));
  const dow = ((new Date(`${today()}T12:00:00`).getDay() + 6) % 7) + 1;
  await db.insert(trainingCycleSlots).values({ trainingCycleId: ps.cycleId, daySlot: 1, dayOfWeek: dow, programId });
  await db.update(plannedSessions).set({ slotId: null }).where(eq(plannedSessions.id, plannedId));

  await page.goto("/");
  await page.getByTestId("today-card").getByRole("button", { name: /Start Today's Workout/ }).click();
  const sheet = page.getByTestId("start-choice");
  await expect(sheet.getByRole("link", { name: /^Log by hand/ })).toHaveAttribute("href", `/programs/${programId}/workout`);
  await sheet.getByRole("link", { name: /^Guided/ }).click();
  await expect(page).toHaveURL(new RegExp(`/planned/${plannedId}/play`));
  await expect(page.getByTestId("player-ready")).toBeVisible();
});
