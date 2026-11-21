import { and, eq } from "drizzle-orm";
import { athleteThresholds, programExercises, rides, users, workoutSessions } from "../src/db/schema";
import { e2eUser } from "./fixtures/env";
import { testDb } from "./fixtures/reset";
import { insertStepProgram } from "./fixtures/step-program";
import { expect, test } from "./fixtures/test";

/**
 * The run exercise screen (docs/plans/run-logger.md, step 2): for an
 * endurance user the run exercise of a workout shows the run, with its steps,
 * the belt on a treadmill, the mode and Start run. Every other user keeps the
 * set list.
 */

/** "2 Base · Run" of the mockups: 75 min. */
const run = {
  v: 2,
  sport: "run",
  name: "Run screen run",
  steps: [
    { type: "warmup", end: { type: "time", seconds: 600 }, target: { metric: "hr", anchor: "lthr", zone: 1 }, belt: 7.5, incline: 1 },
    { type: "work", end: { type: "time", seconds: 3000 }, target: { metric: "hr", anchor: "lthr", zone: 2 } },
    {
      type: "repeat",
      count: 6,
      steps: [
        { type: "work", end: { type: "time", seconds: 30 }, target: { metric: "rpe", anchor: "absolute", low: 9, high: 9 }, belt: 13 },
        { type: "recovery", end: { type: "time", seconds: 90 }, target: { metric: "rpe", anchor: "absolute", low: 2, high: 3 }, belt: 7 },
      ],
    },
    { type: "cooldown", end: { type: "time", seconds: 180 }, target: { metric: "rpe", anchor: "absolute", low: 1, high: 2 } },
  ],
};

async function setup(parallelIndex: number, endurance: boolean, thresholds = true) {
  const db = testDb();
  const user = await db.query.users.findFirst({ where: eq(users.email, e2eUser(parallelIndex).email) });
  const userId = user!.id;
  await db.delete(workoutSessions).where(eq(workoutSessions.userId, userId));
  await db.delete(athleteThresholds).where(eq(athleteThresholds.userId, userId));
  await db.update(users).set({ enduranceEnabled: endurance }).where(eq(users.id, userId));
  const measuredOn = new Date().toISOString().slice(0, 10);
  if (thresholds) {
    await db.insert(athleteThresholds).values([
      { userId, kind: "run_threshold_pace", value: 1000 / 339, measuredOn, source: "manual" },
      { userId, kind: "lthr_run", value: 180, measuredOn, source: "manual" },
    ]);
  } else {
    await db.insert(athleteThresholds).values({ userId, kind: "lthr_run", value: 180, measuredOn, source: "manual" });
  }
  const programId = await insertStepProgram(db, userId, run);
  const [pe] = await db.select({ id: programExercises.id }).from(programExercises).where(eq(programExercises.programId, programId));
  return { userId, programId, peId: pe.id };
}

test("an endurance user's run exercise shows the run, changes mode and surface, starts the run and offers Resume", async ({ page }, testInfo) => {
  const { userId, programId, peId } = await setup(testInfo.parallelIndex, true);
  await page.goto(`/programs/${programId}/workout`);
  // The workout layout opens the session in the background; Start run needs it.
  const db = testDb();
  await expect.poll(async () => (await db.select().from(workoutSessions).where(eq(workoutSessions.userId, userId))).length).toBe(1);
  // The run ring opens the run exercise, as the bike ring does.
  await page.getByRole("link", { name: /^Open / }).click();
  await expect(page).toHaveURL(new RegExp(`/workout/exercises/${peId}$`));

  const screen = page.getByTestId("run-exercise").filter({ visible: true });
  await expect(screen).toBeVisible();
  await expect(page.getByTestId("run-step")).toHaveCount(4);

  // The mode it opens in depends on the month when there are no runs (R4); start on the treadmill.
  if ((await page.getByTestId("run-mode").filter({ visible: true }).textContent()) === "Outdoor") {
    await page.getByRole("button", { name: "Change" }).click();
    await page.getByTestId("run-mode-sheet").getByRole("button", { name: "Treadmill" }).click();
  }
  await expect(page.getByTestId("run-mode")).toHaveText("Treadmill");
  await expect(page.getByTestId("run-summary")).toHaveText("75 min · load about 70 · threshold 5:39 /km");
  await expect(page.getByTestId("ride-profile")).toBeVisible();
  await expect(page.getByTestId("run-stats")).toContainText("10.1");
  await expect(page.getByTestId("run-step-detail")).toHaveText(["Belt 7.5 km/h · incline 1%", "HR under 162 · start 8.2 km/h", "30 s · 13.0 km/h · 1:30 easy between", "Walk 5.5 km/h"]);
  await expect(page.getByTestId("step-alerts")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Log by hand" })).toHaveAttribute("href", `/programs/${programId}/workout/exercises/${peId}?hand=1`);

  // Change opens a sheet with both modes; Outdoor adds the surface choice and the alerts-off row (4.6).
  await page.getByRole("button", { name: "Change" }).click();
  await page.getByTestId("run-mode-sheet").getByRole("button", { name: "Outdoor" }).click();
  await expect(page.getByTestId("run-mode")).toHaveText("Outdoor");
  await expect(page.getByTestId("run-step-detail")).toHaveText(["HR under 153", "HR under 162", "30 s · Fast and relaxed · 1:30 easy between", "Effort 1-2"]);
  await expect(page.getByTestId("step-alerts")).toContainText("Keep the screen on for beeps, or follow your watch");
  await page.getByRole("button", { name: "Trail or snow" }).click();
  await expect(page.getByRole("button", { name: "Trail or snow" })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Start run" }).click();
  await expect(page).toHaveURL(new RegExp(`/exercises/${peId}\\?ride=1$`));
  const [started] = await db.select().from(rides).where(and(eq(rides.userId, userId), eq(rides.programExerciseId, peId)));
  expect(started).toMatchObject({ sport: "run", mode: "outdoor", surface: "trail", status: "running" });

  // While the run runs the screen offers Resume, not Start run, Change or Log by hand (4.3).
  await page.goto(`/programs/${programId}/workout/exercises/${peId}`);
  await expect(page.getByTestId("run-running").filter({ visible: true })).toHaveText("Run running");
  await expect(page.getByRole("link", { name: "Resume" })).toHaveAttribute("href", `/programs/${programId}/workout/exercises/${peId}?ride=1`);
  await expect(page.getByRole("button", { name: "Start run" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Change" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Log by hand" })).toHaveCount(0);
  // The last run's mode is the default next time (R4).
  await expect(page.getByTestId("run-mode").filter({ visible: true })).toHaveText("Outdoor");

  // ?hand=1 while the run runs: the run screen with Resume, not the set list.
  await page.goto(`/programs/${programId}/workout/exercises/${peId}?hand=1`);
  await expect(page.getByRole("link", { name: "Resume" })).toBeVisible();
});

test("with no threshold pace the treadmill run asks for it, and Log by hand opens the set list", async ({ page }, testInfo) => {
  const { programId, peId } = await setup(testInfo.parallelIndex, true, false);
  await page.goto(`/programs/${programId}/workout/exercises/${peId}`);
  // A streamed copy of the page can sit hidden for a moment: look in the visible one.
  const screen = page.getByTestId("run-exercise").filter({ visible: true });
  await expect(screen).toBeVisible();
  if ((await screen.getByTestId("run-mode").textContent()) === "Outdoor") {
    await screen.getByRole("button", { name: "Change" }).click();
    await page.getByTestId("run-mode-sheet").getByRole("button", { name: "Treadmill" }).click();
  }
  await expect(screen.getByTestId("no-threshold-pace")).toContainText("Set your threshold pace to see belt speeds");
  await expect(screen.getByRole("link", { name: "Set pace" })).toHaveAttribute("href", "/more/account/training-numbers");
  await expect(screen.getByTestId("run-step-detail").nth(1)).toHaveText("HR under 162 · set the belt by feel");
  await expect(screen.getByTestId("run-summary")).toHaveText("75 min · load about 70 · LTHR 180");

  await screen.getByRole("link", { name: "Log by hand" }).click();
  await expect(page).toHaveURL(new RegExp(`/exercises/${peId}\\?hand=1$`));
  await expect(page.getByRole("button", { name: "Progression settings" })).toBeVisible();
  await expect(page.getByTestId("run-exercise")).toHaveCount(0);
});

test("a user without endurance features keeps the set list on a run exercise", async ({ page }, testInfo) => {
  const { programId, peId } = await setup(testInfo.parallelIndex, false);
  await page.goto(`/programs/${programId}/workout/exercises/${peId}`);
  await expect(page.getByRole("button", { name: "Progression settings" })).toBeVisible();
  await expect(page.getByTestId("run-exercise")).toHaveCount(0);
});
