import { and, asc, eq, sql } from "drizzle-orm";
import type { Page } from "@playwright/test";
import { athleteThresholds, plannedSessions, programExercises, programSets, rideEvents, rides, trainingCycles, users, workoutSessions, workoutSets } from "../src/db/schema";
import { e2eUser } from "./fixtures/env";
import { testDb } from "./fixtures/reset";
import { insertStepProgram } from "./fixtures/step-program";
import { expect, test } from "./fixtures/test";

/**
 * Ride mode (docs/plans/bike-ride-logger.md, step 3): a ride runs inside the
 * bike exercise, each step saves when it ends, the controls save their
 * status, time and offset, a reload resumes, an offline phone sends later,
 * and the week counts a finished ride but not a key session ended early.
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

async function setup(parallelIndex: number, priority: "key" | "support" = "support") {
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
  const programId = await insertStepProgram(db, userId, workout);
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
  await page.clock.runFor(seconds * 1000);
}

/** Open the program's bike exercise, wait for its workout, and start the ride indoors. */
async function startRide(page: Page, s: { userId: string; programId: number; peId: number }, opts: { open?: boolean } = {}) {
  if (opts.open !== false) await page.goto(`/programs/${s.programId}/workout/exercises/${s.peId}`);
  // A streamed copy of the page can sit hidden for a moment: look at the visible one.
  await expect(page.getByTestId("bike-exercise").filter({ visible: true })).toBeVisible();
  if ((await page.getByTestId("ride-mode").filter({ visible: true }).textContent()) === "Outdoor") await page.getByRole("button", { name: "Change to Indoor trainer" }).click();
  await expect.poll(async () => (await testDb().select().from(workoutSessions).where(eq(workoutSessions.userId, s.userId))).length).toBe(1);
  await page.getByRole("button", { name: "Start ride" }).click();
  await expect(page.getByTestId("ride-screen")).toBeVisible();
  await expect(page.getByTestId("ride-header")).toContainText("Indoor · step 1 of 5");
  await freeze(page);
}

const header = (page: Page) => page.getByTestId("ride-header");

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
  const [session] = await db.select().from(workoutSessions).where(eq(workoutSessions.userId, userId));
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

  // The ride is done: the workout finishes and the bike screen says so.
  await expect(page.getByTestId("ride-done-line")).toHaveText("Ride done");
  await expect(page).toHaveURL(new RegExp(`/exercises/${s.peId}$`));
  await expect.poll(async () => (await savedSteps(s.userId)).map((r) => [r.programSetId, r.stepStatus, r.durationSeconds])).toEqual([
    [s.setIds[0], "done", 60],
    [s.setIds[1], "done", 120],
    [s.setIds[2], "done", 30],
    [s.setIds[3], "done", 120],
    [s.setIds[4], "done", 60],
  ]);
  const [session] = await testDb().select().from(workoutSessions).where(eq(workoutSessions.userId, s.userId));
  expect([session.isCompleted, session.endedEarly, session.plannedSessionId]).toEqual([true, false, s.plannedId]);
  const [ride] = await testDb().select().from(rides).where(eq(rides.userId, s.userId));
  expect(ride.status).toBe("finished");

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

  await expect(page.getByTestId("ride-done-line")).toHaveText("Ride ended early");
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
  const [session] = await testDb().select().from(workoutSessions).where(eq(workoutSessions.userId, s.userId));
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
  await expect(page.getByTestId("ride-clock")).toHaveText(/^1:(0\d|10)$/);

  await page.clock.resume();
  await page.reload();
  // Opened without a tap: sound and the wake lock need one, so it asks.
  await expect(page.getByTestId("ride-prompt")).toBeVisible();
  await expect(page.getByTestId("ride-clock")).toHaveText(/^1:(0\d|10)$/);
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(page.getByTestId("ride-screen")).toBeVisible();
  await expect(header(page)).toContainText("step 2 of 5");
  await expect(page.getByTestId("ride-clock")).toHaveText(/^1:(0\d|10)$/);
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
});
