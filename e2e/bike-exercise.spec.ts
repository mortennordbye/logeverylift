import { and, eq } from "drizzle-orm";
import { athleteThresholds, programExercises, rides, users, workoutSessions } from "../src/db/schema";
import { e2eUser } from "./fixtures/env";
import { testDb } from "./fixtures/reset";
import { insertStepProgram } from "./fixtures/step-program";
import { expect, test } from "./fixtures/test";

/**
 * The bike exercise screen (docs/plans/bike-ride-logger.md, step 2): for an
 * endurance user the bike exercise of a workout shows the ride, with its
 * steps, the mode and Start ride. Every other user keeps the set list.
 */

const ride = {
  v: 2,
  sport: "bike",
  name: "Bike screen ride",
  steps: [
    { type: "warmup", end: { type: "time", seconds: 900 }, ramp: { anchor: "ftp", from: 55, to: 75 } },
    {
      type: "repeat",
      count: 2,
      steps: [
        { type: "work", end: { type: "time", seconds: 900 }, target: { metric: "power", anchor: "ftp", low: 75, high: 81 }, cadence: { low: 85, high: 95 }, note: "Talk in short sentences" },
        { type: "recovery", end: { type: "time", seconds: 300 }, target: { metric: "power", anchor: "ftp", zone: 1 } },
      ],
    },
    { type: "work", end: { type: "time", seconds: 900 }, target: { metric: "power", anchor: "ftp", low: 56, high: 75 } },
  ],
};

async function setup(parallelIndex: number, endurance: boolean) {
  const db = testDb();
  const user = await db.query.users.findFirst({ where: eq(users.email, e2eUser(parallelIndex).email) });
  const userId = user!.id;
  await db.delete(workoutSessions).where(eq(workoutSessions.userId, userId));
  await db.delete(athleteThresholds).where(eq(athleteThresholds.userId, userId));
  await db.update(users).set({ enduranceEnabled: endurance }).where(eq(users.id, userId));
  const measuredOn = new Date().toISOString().slice(0, 10);
  await db.insert(athleteThresholds).values([
    { userId, kind: "ftp", value: 180, measuredOn, source: "manual" },
    { userId, kind: "lthr_bike", value: 171, measuredOn, source: "manual" },
  ]);
  const programId = await insertStepProgram(db, userId, ride);
  const [pe] = await db.select({ id: programExercises.id }).from(programExercises).where(eq(programExercises.programId, programId));
  return { userId, programId, peId: pe.id };
}

test("an endurance user's bike exercise shows the ride, switches mode and starts the ride", async ({ page }, testInfo) => {
  const { userId, programId, peId } = await setup(testInfo.parallelIndex, true);
  await page.goto(`/programs/${programId}/workout/exercises/${peId}`);

  const screen = page.getByTestId("bike-exercise");
  await expect(screen).toBeVisible();
  await expect(page.getByTestId("ride-step")).toHaveCount(5);

  // The mode it opens in depends on the month (D6); switch to the other one and back.
  const first = (await page.getByTestId("ride-mode").textContent())!;
  const other = first === "Outdoor" ? "Indoor trainer" : "Outdoor";
  await page.getByRole("button", { name: `Change to ${other}` }).click();
  await expect(page.getByTestId("ride-mode")).toHaveText(other);
  await page.getByRole("button", { name: `Change to ${first}` }).click();
  await expect(page.getByTestId("ride-mode")).toHaveText(first);

  if (first === "Outdoor") await page.getByRole("button", { name: "Change to Indoor trainer" }).click();
  await expect(page.getByTestId("ride-summary")).toHaveText("65 min · load about 55 · FTP 180 W");
  await expect(page.getByTestId("ride-profile")).toBeVisible();
  await expect(page.getByTestId("ride-step-target")).toHaveText(["99 to 135 W", "135-146 W", "under 97 W", "135-146 W", "101-135 W"]);
  await expect(page.getByTestId("ride-step").nth(1)).toContainText("Work · 1 of 2");
  await expect(page.getByTestId("ride-step").nth(1)).toContainText("Talk in short sentences");

  await page.getByRole("button", { name: "Change to Outdoor" }).click();
  await expect(page.getByTestId("ride-profile")).toHaveCount(0);
  await expect(page.getByTestId("ride-step-target")).toHaveText(["HR under 139", "HR 154-159", "Effort 2", "HR 154-159", "HR 139-152"]);

  // The workout layout opens the session in the background; Start ride needs it.
  const db = testDb();
  await expect.poll(async () => (await db.select().from(workoutSessions).where(eq(workoutSessions.userId, userId))).length).toBe(1);
  await page.getByRole("button", { name: "Start ride" }).click();
  await expect(page).toHaveURL(new RegExp(`/exercises/${peId}\\?ride=1$`));
  const [started] = await db.select().from(rides).where(and(eq(rides.userId, userId), eq(rides.programExerciseId, peId)));
  expect(started.mode).toBe("outdoor");
  expect(started.status).toBe("running");

  // The last ride's mode is the default next time (D6).
  await page.goto(`/programs/${programId}/workout/exercises/${peId}`);
  await expect(page.getByTestId("ride-mode")).toHaveText("Outdoor");

  // Log by hand keeps today's set list.
  await page.getByRole("link", { name: "Log by hand" }).click();
  await expect(page).toHaveURL(new RegExp(`/exercises/${peId}\\?hand=1$`));
  await expect(page.getByTestId("bike-exercise")).toHaveCount(0);
  await expect(page.getByTestId("edit-steps")).toBeVisible();
});

test("a user without endurance features keeps the set list on a bike exercise", async ({ page }, testInfo) => {
  const { programId, peId } = await setup(testInfo.parallelIndex, false);
  await page.goto(`/programs/${programId}/workout/exercises/${peId}`);
  await expect(page.getByRole("button", { name: "Progression settings" })).toBeVisible();
  await expect(page.getByTestId("bike-exercise")).toHaveCount(0);
});
