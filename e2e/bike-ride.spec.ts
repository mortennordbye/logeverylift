import { and, asc, eq, sql } from "drizzle-orm";
import type { Page } from "@playwright/test";
import { athleteThresholds, plannedSessions, programExercises, programSets, rideEvents, rides, trainingCycles, users, workoutSessions, workoutSets } from "../src/db/schema";
import { e2eUser } from "./fixtures/env";
import { testDb } from "./fixtures/reset";
import { insertStepProgram } from "./fixtures/step-program";
import { ftpTestWorkout } from "../src/lib/utils/ftp-tests";
import { expect, test } from "./fixtures/test";

/**
 * Ride mode (docs/plans/bike-ride-logger.md, steps 3 and 4): a ride runs
 * inside the bike exercise, each step saves when it ends, the controls save
 * their status, time and offset, a reload resumes, an offline phone sends
 * later, and the week counts a finished ride but not a key session ended
 * early. After the ride, the results table saves typed numbers and the
 * summary shows them; "Log by hand" saves a ride without ride mode.
 *
 * The clock: server time is the ride's clock, and the server's clock cannot
 * be faked. So once the ride runs, the page clock is paused (no timer runs by
 * itself), and `advance` moves the stored ride back in time by as much as it
 * runs the page clock forward. Both then agree the ride is that much older.
 * Page changes need the clock to run (the page transition animates), so it
 * resumes before them.
 */

const pad = (n: number) => String(n).padStart(2, "0");
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const ftp = (low: number, high: number) => ({ metric: "power", anchor: "ftp", low, high });
const workout = {
  v: 2,
  sport: "bike",
  name: "Ride mode e2e",
  steps: [
    { type: "warmup", end: { type: "time", seconds: 60 }, target: ftp(50, 60) },
    { type: "work", end: { type: "time", seconds: 120 }, target: ftp(75, 81), cadence: { low: 85, high: 95 } },
    { type: "recovery", end: { type: "time", seconds: 30 }, target: { metric: "power", anchor: "ftp", zone: 1 } },
    { type: "work", end: { type: "time", seconds: 120 }, target: ftp(75, 81) },
    { type: "cooldown", end: { type: "time", seconds: 60 }, target: ftp(50, 60) },
  ],
};

async function setup(parallelIndex: number, priority: "key" | "support" = "support", steps: unknown = workout) {
  const db = testDb();
  const user = await db.query.users.findFirst({ where: eq(users.email, e2eUser(parallelIndex).email) });
  const userId = user!.id;
  await db.delete(workoutSessions).where(eq(workoutSessions.userId, userId));
  await db.delete(trainingCycles).where(eq(trainingCycles.userId, userId));
  await db.delete(athleteThresholds).where(eq(athleteThresholds.userId, userId));
  await db.update(users).set({ enduranceEnabled: true, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }).where(eq(users.id, userId));
  await db.insert(athleteThresholds).values([
    { userId, kind: "ftp", value: 180, measuredOn: today(), source: "manual" },
    { userId, kind: "lthr_bike", value: 171, measuredOn: today(), source: "manual" },
  ]);
  const programId = await insertStepProgram(db, userId, steps);
  const [pe] = await db.select({ id: programExercises.id }).from(programExercises).where(eq(programExercises.programId, programId));
  const setIds = (await db.select({ id: programSets.id }).from(programSets).where(eq(programSets.programExerciseId, pe.id)).orderBy(asc(programSets.setNumber))).map((r) => r.id);
  const [cycle] = await db
    .insert(trainingCycles)
    .values({ userId, name: "Bike block", durationWeeks: 4, status: "active", startDate: today(), sessionsGeneratedAt: new Date() })
    .returning();
  const [row] = await db.insert(plannedSessions).values({ userId, cycleId: cycle.id, date: today(), programId, priority }).returning({ id: plannedSessions.id });
  return { userId, programId, peId: pe.id, setIds, plannedId: row.id };
}

test.beforeEach(async ({ page }) => {
  // Headless browsers give no wake lock; the stub lets the app ask for one.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request: async () => ({ release: async () => undefined }) } });
  });
  // The clock goes in before the first page, at the real time.
  await page.clock.install({ time: Date.now() });
});

/** When the test tapped Start ride, and how far `advance` has moved the ride, per user. */
const startTap = new Map<string, number>();
const shifted = new Map<string, number>();

/** Stop the page clock: from now on only `advance` and `runFor` move it. */
async function freeze(page: Page) {
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 50);
}

/**
 * `seconds` pass: the stored ride moves back by that much and the page clock
 * runs it forward. Online, the taps already made reach the server first, so
 * they move back with the ride.
 */
async function advance(page: Page, userId: string, seconds: number) {
  if (await page.evaluate(() => navigator.onLine)) {
    await expect.poll(() => page.evaluate(() => localStorage.getItem("rideEventQueue"))).toBeNull();
  }
  const db = testDb();
  const shift = sql`${seconds} * interval '1 second'`;
  const mine = db.select({ id: rides.id }).from(rides).where(eq(rides.userId, userId));
  await db
    .update(rides)
    .set({ startedAt: sql`${rides.startedAt} - ${shift}`, endedAt: sql`${rides.endedAt} - ${shift}`, heartbeatAt: sql`${rides.heartbeatAt} - ${shift}` })
    .where(eq(rides.userId, userId));
  await db
    .update(rideEvents)
    .set({ at: sql`${rideEvents.at} - ${shift}`, clientAt: sql`${rideEvents.clientAt} - ${shift}` })
    .where(sql`${rideEvents.rideId} in ${mine}`);
  shifted.set(userId, (shifted.get(userId) ?? 0) + seconds);
  await page.clock.runFor(seconds * 1000);
}

/** Open the program's bike exercise, wait for its workout, and start the ride indoors. */
async function startRide(page: Page, s: { userId: string; programId: number; peId: number }, opts: { open?: boolean; steps?: number } = {}) {
  if (opts.open !== false) await page.goto(`/programs/${s.programId}/workout/exercises/${s.peId}`);
  // A streamed copy of the page can sit hidden for a moment: look at the visible one.
  await expect(page.getByTestId("bike-exercise").filter({ visible: true })).toBeVisible();
  if ((await page.getByTestId("ride-mode").filter({ visible: true }).textContent()) === "Outdoor") await page.getByRole("button", { name: "Change to Indoor trainer" }).click();
  await expect.poll(async () => (await testDb().select().from(workoutSessions).where(eq(workoutSessions.userId, s.userId))).length).toBe(1);
  startTap.set(s.userId, Date.now());
  shifted.set(s.userId, 0);
  await page.getByRole("button", { name: "Start ride" }).click();
  await expect(page.getByTestId("ride-screen")).toBeVisible();
  await expect(page.getByTestId("ride-header")).toContainText(`Indoor · step 1 of ${opts.steps ?? 5}`);
  await freeze(page);
}

const header = (page: Page) => page.getByTestId("ride-header");

/**
 * The step clock shows the seconds left to `stepEndS` (seconds into the ride)
 * as the server counts them now, within a second or two: the stored ride
 * gives the start, and real time runs on.
 */
async function expectClock(page: Page, userId: string, stepEndS: number) {
  await expect
    .poll(async () => {
      const text = (await page.getByTestId("ride-clock").textContent()) ?? "";
      const [m, sec] = text.split(":").map(Number);
      const ridden = (Date.now() - startTap.get(userId)!) / 1000 + (shifted.get(userId) ?? 0);
      return Math.abs(m * 60 + sec - (stepEndS - ridden));
    })
    .toBeLessThanOrEqual(2);
}

async function holdToSkip(page: Page, step: number) {
  const button = page.getByRole("button", { name: `Hold to skip step ${step}` });
  const box = (await button.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.clock.runFor(700);
  await page.mouse.up();
}

async function savedSteps(userId: string) {
  const db = testDb();
  // The first workout: opening the exercise again after it finished starts a new, empty one.
  const [session] = await db.select().from(workoutSessions).where(eq(workoutSessions.userId, userId)).orderBy(asc(workoutSessions.id));
  if (!session) return [];
  return db.select().from(workoutSets).where(eq(workoutSets.sessionId, session.id)).orderBy(asc(workoutSets.setNumber));
}

test("D14: the play address of a bike program opens its bike exercise; a 5-step ride saves 5 steps and the week counts it", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const s = await setup(testInfo.parallelIndex, "key");

  await page.goto(`/planned/${s.plannedId}/play`);
  await expect(page).toHaveURL(new RegExp(`/programs/${s.programId}/workout/exercises/${s.peId}\\?ride=1&planned=${s.plannedId}$`));
  await expect(page.getByTestId("bike-exercise").filter({ visible: true })).toBeVisible();
  await expect.poll(async () => (await testDb().select().from(workoutSessions).where(eq(workoutSessions.userId, s.userId))).map((w) => w.plannedSessionId)).toEqual([s.plannedId]);
  await startRide(page, s, { open: false });

  await expect(page.getByTestId("ride-step-title")).toHaveText("Warm-up");
  await expect(page.getByTestId("ride-target-value")).toHaveText("90-108");
  for (const [seconds, title, n] of [
    [60, "Work", 2],
    [120, "Easy", 3],
    [30, "Work", 4],
    [120, "Cool-down", 5],
  ] as const) {
    await advance(page, s.userId, seconds);
    await expect(header(page)).toContainText(`step ${n} of 5`);
    await expect(page.getByTestId("ride-step-title")).toHaveText(title);
  }
  await advance(page, s.userId, 60);
  await page.clock.resume();

  // The ride is done: the workout finishes and the results table opens.
  await expect(page.getByTestId("ride-results")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/exercises/${s.peId}\\?results=1$`));
  await expect.poll(async () => (await savedSteps(s.userId)).map((r) => [r.programSetId, r.stepStatus, r.durationSeconds])).toEqual([
    [s.setIds[0], "done", 60],
    [s.setIds[1], "done", 120],
    [s.setIds[2], "done", 30],
    [s.setIds[3], "done", 120],
    [s.setIds[4], "done", 60],
  ]);
  const [session] = await testDb().select().from(workoutSessions).where(eq(workoutSessions.userId, s.userId)).orderBy(asc(workoutSessions.id));
  expect([session.isCompleted, session.endedEarly, session.plannedSessionId]).toEqual([true, false, s.plannedId]);
  const [ride] = await testDb().select().from(rides).where(eq(rides.userId, s.userId));
  expect(ride.status).toBe("finished");

  // Step 4: the results table. Indoors no distance, speed or climbing.
  await expect(page.getByTestId("result-time-2")).toHaveText("2:00");
  await page.getByRole("button", { name: "More numbers · max HR, cadence" }).click();
  await expect(page.getByLabel("Cadence step 2")).toBeVisible();
  await expect(page.getByText(/Distance|km\/h|Climbing/)).toHaveCount(0);
  for (const [n, w] of [[1, "100"], [2, "140"], [3, "80"], [4, "140"], [5, "100"]] as const) await page.getByLabel(`Avg W step ${n}`).fill(w);
  await page.getByLabel("Avg HR step 2").fill("150");
  await page.getByRole("group", { name: "Effort of the ride" }).getByRole("button", { name: "6", exact: true }).click();
  await page.getByRole("button", { name: "Done" }).click();

  // The summary: avg 123 W, estimated load 5 (marked est.), 48 kJ, zones by step average.
  const summary = page.getByTestId("ride-summary-screen");
  await expect(summary).toBeVisible();
  await expect(page.getByTestId("summary-line")).toContainText("Done");
  await expect(page.getByTestId("tile-Time")).toHaveText("Time6:30");
  await expect(page.getByTestId("tile-Avg W")).toHaveText("Avg W123");
  await expect(page.getByTestId("tile-Load")).toHaveText("Load5est.");
  await expect(page.getByTestId("tile-kJ")).toHaveText("kJ48");
  await expect(page.getByTestId("tile-Effort")).toHaveText("Effort6");
  await expect(page.getByTestId("tile-NP")).toHaveCount(0);
  await expect(page.getByTestId("summary-zones")).toContainText("Z1 1Z2 2Z3 4 min");
  await expect(page.getByTestId("summary-row").nth(1)).toHaveText("Work135-146140 W");
  await expect
    .poll(async () => (await savedSteps(s.userId)).map((r) => [r.avgPower, r.rpe, r.sources?.avgPower, r.sources?.durationSeconds]))
    .toEqual([
      [100, 6, "typed", "clock"],
      [140, 6, "typed", "clock"],
      [80, 6, "typed", "clock"],
      [140, 6, "typed", "clock"],
      [100, 6, "typed", "clock"],
    ]);
  expect((await savedSteps(s.userId))[1].avgHr).toBe(150);

  await page.goto("/week");
  const week = page.getByTestId("week-session").filter({ hasText: "Ride mode e2e" });
  await expect(week).toContainText("done 06:30");
  await expect(week).toContainText("key");
});

test("skip, undo, +1 min, ±5 W, pause and End ride save the right status, time and offset", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const s = await setup(testInfo.parallelIndex, "key");
  await startRide(page, s);

  // Step 1: +5, +5, −5 W leaves +5 W; +1 min and its undo, then +1 min for good.
  await page.getByRole("button", { name: "Target up 5 W" }).click();
  await page.getByRole("button", { name: "Target up 5 W" }).click();
  await page.getByRole("button", { name: "Target down 5 W" }).click();
  await expect(page.getByTestId("ride-toast")).toHaveText("Target 95-113 WUndo");
  await expect(page.getByTestId("ride-target-value")).toHaveText("95-113");
  await page.getByRole("button", { name: "Add 1 min" }).click();
  await expect(page.getByTestId("ride-toast")).toHaveText("+1 minUndo");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByTestId("ride-toast")).toHaveCount(0);
  await page.getByRole("button", { name: "Add 1 min" }).click();
  await page.clock.runFor(5_000);
  await expect(page.getByTestId("ride-toast")).toHaveCount(0);
  await advance(page, s.userId, 60);
  await expect(page.getByTestId("ride-step-title")).toHaveText("Warm-up");
  await advance(page, s.userId, 60);
  await expect(page.getByTestId("ride-step-title")).toHaveText("Work");

  // Step 2: a skip taken back, then a skip for good.
  await advance(page, s.userId, 10);
  await holdToSkip(page, 2);
  await expect(page.getByTestId("ride-toast")).toHaveText("SkippedUndo");
  await expect(page.getByTestId("ride-step-title")).toHaveText("Easy");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByTestId("ride-step-title")).toHaveText("Work");
  await holdToSkip(page, 2);
  await expect(page.getByTestId("ride-step-title")).toHaveText("Easy");

  // Step 3: 10 s, then pause, and End ride from the paused screen.
  await advance(page, s.userId, 10);
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByTestId("ride-paused")).toBeVisible();
  await advance(page, s.userId, 120);
  await expect(page.getByText("Paused 2 min")).toBeVisible();
  await expect(page.getByTestId("ride-kept")).toHaveText("Steps 1 and 3 are saved. Ending now keeps them.");
  await page.clock.resume();
  await page.getByRole("button", { name: "End ride" }).click();

  await expect(page.getByTestId("ride-results")).toBeVisible();
  await expect(page.getByTestId("result-time-2")).toHaveText("Skipped");
  await expect(page.getByTestId("result-time-4")).toHaveText("Not ridden");
  // Later leaves the table unsaved; the exercise then shows the summary, ended early, plan only.
  await page.getByRole("link", { name: "Later" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto(`/programs/${s.programId}/workout/exercises/${s.peId}`);
  // A streamed copy of the page can sit hidden for a moment: look at the visible one.
  const visible = (id: string) => page.getByTestId(id).filter({ visible: true });
  await expect(visible("summary-line")).toContainText("Ended early");
  await expect(visible("summary-plan-only")).toContainText("Plan only · no ride numbers");
  await expect(visible("summary-row").nth(1)).toContainText("Skipped");
  await expect(visible("summary-row").nth(3)).toContainText("Not ridden");
  await expect
    .poll(async () => (await savedSteps(s.userId)).map((r) => [r.programSetId, r.stepStatus, r.isCompleted, r.targetOffsetW, r.extendedSeconds]))
    .toEqual([
      [s.setIds[0], "done", true, 5, 60],
      [s.setIds[1], "skipped", false, 0, 0],
      [s.setIds[2], "partial", true, 0, 0],
    ]);
  const steps = await savedSteps(s.userId);
  // Real seconds pass between the taps too, so the times allow a few.
  expect(steps[0].durationSeconds).toBe(120);
  expect(steps[1].durationSeconds).toBeGreaterThanOrEqual(10);
  expect(steps[1].durationSeconds).toBeLessThan(25);
  expect(steps[2].durationSeconds).toBeGreaterThanOrEqual(10);
  expect(steps[2].durationSeconds).toBeLessThan(25);
  expect(steps.every((r) => r.sources?.durationSeconds === "clock")).toBe(true);
  const [session] = await testDb().select().from(workoutSessions).where(eq(workoutSessions.userId, s.userId)).orderBy(asc(workoutSessions.id));
  expect([session.isCompleted, session.endedEarly]).toEqual([true, true]);

  // A key session ended early is not done.
  await page.goto("/week");
  const week = page.getByTestId("week-session").filter({ hasText: "Ride mode e2e" });
  await expect(week).toContainText("key");
  await expect(week).toContainText("planned");
  await expect(week).not.toContainText("done");
});

test("a reload mid-ride resumes at the right second", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const s = await setup(testInfo.parallelIndex);
  await startRide(page, s);
  await advance(page, s.userId, 60 + 50);
  await expect(page.getByTestId("ride-step-title")).toHaveText("Work");
  // The clock runs again, so the screen follows real time as the server does.
  await page.clock.resume();
  await expectClock(page, s.userId, 180);

  await page.reload();
  // Opened without a tap: sound and the wake lock need one, so it asks.
  await expect(page.getByTestId("ride-prompt")).toBeVisible();
  await expectClock(page, s.userId, 180);
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(page.getByTestId("ride-screen")).toBeVisible();
  await expect(header(page)).toContainText("step 2 of 5");
  await expectClock(page, s.userId, 180);
  await expect.poll(async () => (await savedSteps(s.userId)).map((r) => [r.programSetId, r.stepStatus, r.durationSeconds])).toEqual([[s.setIds[0], "done", 60]]);
});

test("offline: taps and ended steps wait on the phone and send when it is online again", async ({ page, context }, testInfo) => {
  test.setTimeout(60_000);
  const s = await setup(testInfo.parallelIndex);
  await startRide(page, s);
  await advance(page, s.userId, 30);

  await context.setOffline(true);
  // The warm-up ends while offline; then +5 W and a skip on step 2.
  await advance(page, s.userId, 35);
  await expect(page.getByTestId("ride-step-title")).toHaveText("Work");
  await page.getByRole("button", { name: "Target up 5 W" }).click();
  await expect(page.getByTestId("ride-target-value")).toHaveText("140-151");
  await holdToSkip(page, 2);
  await expect(page.getByTestId("ride-step-title")).toHaveText("Easy");
  await expect(header(page)).toContainText("Saved on this phone");
  // Nothing reached the server.
  const db = testDb();
  const [ride] = await db.select().from(rides).where(eq(rides.userId, s.userId));
  expect((await db.select().from(rideEvents).where(eq(rideEvents.rideId, ride.id))).map((e) => e.kind)).toEqual(["start"]);
  expect(await savedSteps(s.userId)).toEqual([]);

  await context.setOffline(false);
  await expect.poll(async () => (await db.select().from(rideEvents).where(eq(rideEvents.rideId, ride.id)).orderBy(asc(rideEvents.seq))).map((e) => e.kind)).toEqual(["start", "nudge", "skip"]);
  await expect
    .poll(async () => (await savedSteps(s.userId)).map((r) => [r.programSetId, r.stepStatus, r.durationSeconds === 60 || r.stepStatus === "skipped", r.targetOffsetW]))
    .toEqual([
      [s.setIds[0], "done", true, 0],
      [s.setIds[1], "skipped", true, 5],
    ]);
  await expect(header(page)).not.toContainText("Saved on this phone");
  // The server agrees with the phone: step 3 runs.
  await expect.poll(async () => (await db.select().from(rides).where(and(eq(rides.id, ride.id), eq(rides.status, "running")))).length).toBe(1);
  await expect(page.getByTestId("ride-step-title")).toHaveText("Easy");

  // Offline again: a pause waits while heartbeat ticks pass, and is stored at
  // the time it was tapped, not at the replay or a heartbeat.
  await context.setOffline(true);
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByTestId("ride-paused")).toBeVisible();
  await page.clock.runFor(12_000);
  await context.setOffline(false);
  await expect.poll(async () => (await db.select().from(rideEvents).where(and(eq(rideEvents.rideId, ride.id), eq(rideEvents.kind, "pause")))).length).toBe(1);
  const [pause] = await db.select().from(rideEvents).where(and(eq(rideEvents.rideId, ride.id), eq(rideEvents.kind, "pause")));
  expect(Math.abs(pause.at.getTime() - pause.clientAt!.getTime())).toBeLessThan(1000);
});

test("Log by hand: the results table with no ride saves each step with its typed time, watts and effort", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const s = await setup(testInfo.parallelIndex);
  await page.goto(`/programs/${s.programId}/workout/exercises/${s.peId}`);
  await expect(page.getByTestId("bike-exercise").filter({ visible: true })).toBeVisible();
  if ((await page.getByTestId("ride-mode").filter({ visible: true }).textContent()) === "Indoor trainer") await page.getByRole("button", { name: "Change to Outdoor" }).click();
  await expect.poll(async () => (await testDb().select().from(workoutSessions).where(eq(workoutSessions.userId, s.userId))).length).toBe(1);
  await page.getByRole("link", { name: "Log by hand" }).click();
  await expect(page.getByTestId("ride-results")).toBeVisible();
  await expect(page.getByLabel("Time step 1")).toHaveValue("1:00");

  // Outdoors: distance, speed and climbing under More numbers.
  await page.getByRole("button", { name: /^More numbers/ }).click();
  await page.getByLabel("Distance km step 2").fill("1.5");
  await page.getByLabel("Time step 2").fill("2:30");
  await page.getByLabel("Avg W step 2").fill("150");
  await page.getByLabel("Time step 5").fill("");
  await page.getByRole("group", { name: "Effort of the ride" }).getByRole("button", { name: "5", exact: true }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page).toHaveURL(new RegExp(`/programs/${s.programId}/workout$`));

  await expect
    .poll(async () => (await savedSteps(s.userId)).map((r) => [r.programSetId, r.stepStatus, r.durationSeconds, r.rpe, r.sources?.durationSeconds]))
    .toEqual([
      [s.setIds[0], "done", 60, 5, "typed"],
      [s.setIds[1], "done", 150, 5, "typed"],
      [s.setIds[2], "done", 30, 5, "typed"],
      [s.setIds[3], "done", 120, 5, "typed"],
    ]);
  const step2 = (await savedSteps(s.userId))[1];
  expect([step2.avgPower, step2.distanceMeters, step2.sources]).toEqual([150, 1500, { durationSeconds: "typed", avgPower: "typed", distanceMeters: "typed" }]);
  // No ride was started.
  expect(await testDb().select().from(rides).where(eq(rides.userId, s.userId))).toEqual([]);
});

test("FTP ramp test: Lap ends the test, typed watts give the new FTP, Save stores it and the bike screen shows the new watts", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const s = await setup(testInfo.parallelIndex, "support", { ...ftpTestWorkout("ramp"), name: "FTP ramp e2e" });
  await startRide(page, s, { steps: 22 });

  // The 1 min steps start after the 10 min warm-up: 100, 120, 140 W, each with Lap and its line.
  await advance(page, s.userId, 600);
  await expect(header(page)).toContainText("step 2 of 22");
  await expect(page.getByTestId("ride-target-value")).toHaveText("100");
  await expect(page.getByText("Tap Lap when you cannot hold the watts")).toBeVisible();
  await advance(page, s.userId, 60);
  await advance(page, s.userId, 60);
  await expect(header(page)).toContainText("step 4 of 22");
  await advance(page, s.userId, 60);
  await expect(page.getByTestId("ride-target-value")).toHaveText("160");
  await advance(page, s.userId, 20);
  await page.clock.resume();
  await page.getByRole("button", { name: "Lap" }).click();

  // Lap ended the test as finished, the step it ended partial.
  await expect(page.getByTestId("ride-results")).toBeVisible();
  const [ride] = await testDb().select().from(rides).where(eq(rides.userId, s.userId));
  expect(ride.status).toBe("finished");
  await expect.poll(async () => (await savedSteps(s.userId)).map((r) => r.stepStatus)).toEqual(["done", "done", "done", "done", "partial"]);

  // The best minute: the 140 W step, ridden at 248 W.
  await page.getByLabel("Avg W step 4").fill("248");
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByTestId("ride-summary-screen")).toBeVisible();
  const line = page.getByTestId("summary-ftp");
  await expect(line).toHaveText("New FTP 186 WSave");
  await line.getByRole("button", { name: "Save" }).click();
  await expect(line).toHaveText("New FTP 186 WSaved");
  const rows = await testDb().select().from(athleteThresholds).where(and(eq(athleteThresholds.userId, s.userId), eq(athleteThresholds.kind, "ftp"), eq(athleteThresholds.source, "test")));
  expect(rows.map((r) => [r.value, r.protocol, r.measuredOn, r.testData])).toEqual([[186, "ftp_ramp", today(), { best1MinPower: 248 }]]);

  // Another bike program in % FTP now shows the new watts: 50-60% of 186 W.
  const other = await insertStepProgram(testDb(), s.userId, workout);
  const [pe] = await testDb().select({ id: programExercises.id }).from(programExercises).where(eq(programExercises.programId, other));
  await page.goto(`/programs/${other}/workout/exercises/${pe.id}`);
  await expect(page.getByTestId("ride-summary").filter({ visible: true })).toContainText("FTP 186 W");
  await expect(page.getByTestId("ride-step-target").filter({ visible: true }).first()).toContainText("93-112");
});
