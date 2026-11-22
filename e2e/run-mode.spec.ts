import { and, asc, eq, sql } from "drizzle-orm";
import type { Page } from "@playwright/test";
import { athleteThresholds, plannedSessions, programExercises, programSets, rideEvents, rides, trainingCycles, users, workoutSessions, workoutSets } from "../src/db/schema";
import { e2eUser } from "./fixtures/env";
import { testDb } from "./fixtures/reset";
import { insertStepProgram } from "./fixtures/step-program";
import { expect, test } from "./fixtures/test";
import { freezeClock, waitForLiveSession } from "./helpers";
import { runTestWorkout } from "../src/lib/utils/run-test";
import { paceText } from "../src/lib/utils/run-numbers";

/**
 * Run mode (docs/plans/run-logger.md, step 3, section 7 e2e 1 to 4): a run
 * runs inside the run exercise. On a treadmill the clock runs after a 5 s
 * count, belt taps save as one event per burst with an Undo, a reload
 * resumes, and each step saves its belt meters. Offline belt taps replay into
 * their own steps. Outdoors a distance rep ends by Lap behind the controls
 * lock. A ride of a brick hands over to its run.
 *
 * The clock, as in bike-ride.spec.ts: once the run runs, the page clock is
 * paused, and `advance` moves the stored run back in time by as much as it
 * runs the page clock forward.
 */

const pad = (n: number) => String(n).padStart(2, "0");
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Warm-up 1 min at 7.5 km/h and 1% incline, steady 2 min at 8.0 km/h. */
const treadmillRun = {
  v: 2,
  sport: "run",
  name: "Run mode e2e",
  steps: [
    { type: "warmup", end: { type: "time", seconds: 60 }, belt: 7.5, incline: 1 },
    { type: "work", end: { type: "time", seconds: 120 }, target: { metric: "hr", anchor: "lthr", zone: 2 }, belt: 8 },
  ],
};
/** Warm-up 8 s at 7.5 km/h, steady 1 min at 8.0 km/h: short enough to run on real time. */
const shortRun = {
  v: 2,
  sport: "run",
  name: "Short run e2e",
  steps: [
    { type: "warmup", end: { type: "time", seconds: 8 }, belt: 7.5 },
    { type: "work", end: { type: "time", seconds: 60 }, belt: 8 },
  ],
};
/** Steady 30 s, strides 2 × (20 s at 13 km/h, 40 s at 7 km/h), cool-down 30 s. */
const stridesRun = {
  v: 2,
  sport: "run",
  name: "Strides e2e",
  steps: [
    { type: "work", end: { type: "time", seconds: 30 }, belt: 8 },
    {
      type: "repeat",
      count: 2,
      steps: [
        { type: "work", end: { type: "time", seconds: 20 }, belt: 13 },
        { type: "recovery", end: { type: "time", seconds: 40 }, belt: 7 },
      ],
    },
    { type: "cooldown", end: { type: "time", seconds: 30 }, belt: 5.5 },
  ],
};
/** One 400 m rep at threshold pace (5:39 /km gives 2:16, a short rep that runs on effort outdoors, 4.2), then 1 min easy. */
const repRun = {
  v: 2,
  sport: "run",
  name: "Rep e2e",
  steps: [
    { type: "work", end: { type: "distance", meters: 400 }, target: { metric: "pace", anchor: "threshold_pace", low: 100, high: 100 } },
    { type: "recovery", end: { type: "time", seconds: 60 }, target: { metric: "rpe", anchor: "absolute", low: 2, high: 2 } },
  ],
};
const brickRide = {
  v: 2,
  sport: "bike",
  name: "Brick ride e2e",
  steps: [
    { type: "work", end: { type: "time", seconds: 600 }, target: { metric: "power", anchor: "ftp", low: 60, high: 70 } },
    { type: "cooldown", end: { type: "time", seconds: 300 }, target: { metric: "power", anchor: "ftp", low: 50, high: 55 } },
  ],
};

async function userOf(parallelIndex: number) {
  const db = testDb();
  const user = await db.query.users.findFirst({ where: eq(users.email, e2eUser(parallelIndex).email) });
  const userId = user!.id;
  await db.delete(workoutSessions).where(eq(workoutSessions.userId, userId));
  await db.delete(trainingCycles).where(eq(trainingCycles.userId, userId));
  await db.delete(athleteThresholds).where(eq(athleteThresholds.userId, userId));
  await db.update(users).set({ enduranceEnabled: true, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }).where(eq(users.id, userId));
  await db.insert(athleteThresholds).values([
    { userId, kind: "run_threshold_pace", value: 1000 / 339, measuredOn: today(), source: "manual" },
    { userId, kind: "lthr_run", value: 180, measuredOn: today(), source: "manual" },
    { userId, kind: "ftp", value: 200, measuredOn: today(), source: "manual" },
  ]);
  return userId;
}

async function program(userId: string, workout: unknown) {
  const db = testDb();
  const programId = await insertStepProgram(db, userId, workout);
  const [pe] = await db.select({ id: programExercises.id }).from(programExercises).where(eq(programExercises.programId, programId));
  const setIds = (await db.select({ id: programSets.id }).from(programSets).where(eq(programSets.programExerciseId, pe.id)).orderBy(asc(programSets.setNumber))).map((r) => r.id);
  return { userId, programId, peId: pe.id, setIds };
}

test.beforeEach(async ({ page }) => {
  // Headless browsers give no wake lock; the stub lets the app ask for one.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request: async () => ({ release: async () => undefined }) } });
  });
  await page.clock.install({ time: Date.now() });
});

/** When the run's clock started by the test's count, and how far `advance` has moved it, per user. */
const startTap = new Map<string, number>();
const shifted = new Map<string, number>();

/** `seconds` pass: the stored rides move back by that much and the page clock runs it forward. */
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

const visible = (page: Page, id: string) => page.getByTestId(id).filter({ visible: true });

/**
 * Open the run exercise, wait for its workout, choose the mode and start the
 * run. On a treadmill the 5 s count runs first: `realTime` waits it out on the
 * real clock and leaves the page clock running, else the clock stops and
 * `advance` moves past it.
 */
async function startRun(page: Page, s: { userId: string; programId: number; peId: number }, mode: "Treadmill" | "Outdoor", opts: { open?: boolean; realTime?: boolean } = {}) {
  if (opts.open !== false) await page.goto(`/programs/${s.programId}/workout/exercises/${s.peId}`);
  await expect(visible(page, "run-exercise")).toBeVisible();
  if ((await visible(page, "run-mode").textContent()) !== mode) {
    await page.getByRole("button", { name: "Change" }).click();
    await page.getByTestId("run-mode-sheet").getByRole("button", { name: mode }).click();
  }
  await expect(visible(page, "run-mode")).toHaveText(mode);
  await expect.poll(async () => (await testDb().select().from(workoutSessions).where(eq(workoutSessions.userId, s.userId))).length).toBeGreaterThan(0);
  await waitForLiveSession(page);
  await page.getByRole("button", { name: "Start run" }).click();
  if (mode === "Treadmill" && opts.realTime) {
    const count = page.getByTestId("run-count");
    await expect(count).toBeVisible();
    await expect(count).toHaveCount(0, { timeout: 10_000 });
  } else if (mode === "Treadmill") {
    const count = page.getByTestId("run-count");
    await expect(count).toBeVisible();
    await freezeClock(page);
    startTap.set(s.userId, Date.now() + 5000);
    shifted.set(s.userId, 0);
    // A second past the count: the phone's clock offset can be a few hundred ms behind the server's.
    await advance(page, s.userId, 6);
    await expect(count).toHaveCount(0);
  } else {
    await freezeClock(page);
    startTap.set(s.userId, Date.now());
    shifted.set(s.userId, 0);
  }
  await expect(page.getByTestId("ride-screen")).toBeVisible();
}

/** The step clock shows the seconds left to `stepEndS` (seconds into the run) as the server counts them now, within 2 s. */
async function expectClock(page: Page, userId: string, stepEndS: number) {
  await expect
    .poll(async () => {
      const text = (await page.getByTestId("ride-clock").textContent()) ?? "";
      const [m, sec] = text.split(":").map(Number);
      const run = (Date.now() - startTap.get(userId)!) / 1000 + (shifted.get(userId) ?? 0);
      return Math.abs(m * 60 + sec - (stepEndS - run));
    })
    .toBeLessThanOrEqual(2);
}

async function hold(page: Page, name: string) {
  const button = page.getByRole("button", { name });
  const box = (await button.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.clock.runFor(700);
  await page.mouse.up();
}

async function savedSteps(userId: string) {
  const db = testDb();
  const [session] = await db.select().from(workoutSessions).where(eq(workoutSessions.userId, userId)).orderBy(asc(workoutSessions.id));
  if (!session) return [];
  return db.select().from(workoutSets).where(eq(workoutSets.sessionId, session.id)).orderBy(asc(workoutSets.setNumber));
}

async function beltEvents(userId: string) {
  const db = testDb();
  const [ride] = await db.select().from(rides).where(and(eq(rides.userId, userId), eq(rides.sport, "run")));
  return db.select().from(rideEvents).where(and(eq(rideEvents.rideId, ride.id), eq(rideEvents.kind, "belt"))).orderBy(asc(rideEvents.seq));
}

test("1: a treadmill run counts in, saves belt taps with an Undo, resumes after a reload and saves each step with its belt", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const s = await program(await userOf(testInfo.parallelIndex), treadmillRun);
  await page.goto(`/programs/${s.programId}/workout/exercises/${s.peId}`);
  await expect(visible(page, "run-exercise")).toBeVisible();
  // The count says the first belt before the clock runs.
  await startRun(page, s, "Treadmill", { open: false });
  await expect(page.getByTestId("ride-header")).toContainText("Treadmill · step 1 of 2");
  await expect(page.getByTestId("ride-step-title")).toHaveText("Warm-up");
  await expect(page.getByTestId("run-belt")).toHaveText("7.5");
  await expect(page.getByTestId("run-incline")).toHaveText("Incline 1%");

  // 20 s in: two taps are one burst, sent as one event of 8.5 km/h.
  await advance(page, s.userId, 20);
  await page.getByRole("button", { name: "Belt up 0.5 km/h" }).click();
  await page.getByRole("button", { name: "Belt up 0.5 km/h" }).click();
  await expect(page.getByTestId("ride-toast")).toHaveText("Belt 8.5 km/hUndo");
  await expect(page.getByTestId("run-belt")).toHaveText("8.5");
  await expect(page.getByTestId("run-plan-belt")).toContainText("Plan 7.5");
  await advance(page, s.userId, 2.1);
  await expect.poll(async () => (await beltEvents(s.userId)).map((e) => e.value)).toEqual([85]);
  // One more tap, then Undo: the belt goes back to the value from before that burst.
  await advance(page, s.userId, 5);
  await page.getByRole("button", { name: "Belt up 0.5 km/h" }).click();
  await advance(page, s.userId, 2.1);
  await expect.poll(async () => (await beltEvents(s.userId)).map((e) => e.value)).toEqual([85, 90]);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => (await beltEvents(s.userId)).map((e) => e.value)).toEqual([85, 90, 85]);
  await expect(page.getByTestId("run-belt")).toHaveText("8.5");

  // The warm-up ends and saves its meters from the belt: 20 s at 7.5 and 40 s at about 8.5 km/h.
  await advance(page, s.userId, 31);
  await expect(page.getByTestId("ride-step-title")).toHaveText("Steady");
  await expect(page.getByTestId("run-belt")).toHaveText("8.0");
  await expect.poll(async () => (await savedSteps(s.userId)).length).toBe(1);
  const [warm] = await savedSteps(s.userId);
  expect([warm.programSetId, warm.stepStatus, warm.durationSeconds, warm.inclinePercent, warm.sources]).toEqual([
    s.setIds[0],
    "done",
    60,
    1,
    { durationSeconds: "clock", distanceMeters: "belt", avgSpeed: "belt" },
  ]);
  expect(warm.distanceMeters).toBeGreaterThanOrEqual(130);
  expect(warm.distanceMeters).toBeLessThanOrEqual(140);
  expect(warm.avgSpeed).toBeCloseTo(warm.distanceMeters! / 60, 2);

  // A reload mid-step resumes at the right second.
  await advance(page, s.userId, 30);
  await page.clock.resume();
  await expectClock(page, s.userId, 180);
  await page.reload();
  await expect(page.getByTestId("ride-prompt")).toBeVisible();
  await expect(page.getByTestId("ride-prompt")).toContainText("Run running");
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(page.getByTestId("ride-header")).toContainText("step 2 of 2");
  await expectClock(page, s.userId, 180);

  // The run screen offers Resume while the run runs, and Resume opens run mode.
  await page.goto(`/programs/${s.programId}/workout/exercises/${s.peId}`);
  await expect(visible(page, "run-running")).toHaveText("Run running");
  await page.getByRole("link", { name: "Resume" }).click();
  await expect(page.getByTestId("ride-screen")).toBeVisible();
  await expect(page.getByTestId("ride-step-title")).toHaveText("Steady");

  // The run ends: the steady step saves 2 min at 8.0 km/h, and the results table opens (R12), with no Start run.
  await freezeClock(page);
  await advance(page, s.userId, 95);
  await page.clock.resume();
  await expect(visible(page, "run-results")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start run" })).toHaveCount(0);
  await expect.poll(async () => (await savedSteps(s.userId)).map((r) => [r.programSetId, r.stepStatus, r.durationSeconds, r.distanceMeters])).toEqual([
    [s.setIds[0], "done", 60, warm.distanceMeters],
    [s.setIds[1], "done", 120, 267],
  ]);
  // The table shows each step's belt; the runner sets the steady one to 8.2 km/h and gives the effort.
  await expect(page.getByTestId("result-belt-2")).toHaveText("8.0km/h");
  await page.getByRole("button", { name: "Belt up 0.1 km/h step 2" }).click();
  await page.getByRole("button", { name: "Belt up 0.1 km/h step 2" }).click();
  await page.getByRole("group", { name: "Effort of the run" }).getByRole("button", { name: "5" }).click();
  await page.getByTestId("results-done").click();

  // The summary: the steady step saved its typed belt, and the distance names its sources.
  await expect(visible(page, "run-summary-screen")).toContainText("Run done");
  await expect.poll(async () => (await savedSteps(s.userId)).map((r) => [r.distanceMeters, r.rpe, r.sources?.distanceMeters])).toEqual([
    [warm.distanceMeters, 5, "belt"],
    [273, 5, "typed"],
  ]);
  await expect(page.getByTestId("tile-Time")).toContainText("3:00");
  await expect(page.getByTestId("summary-distance-source")).toHaveText("Distance from the belt and typed numbers");
  await expect(page.getByTestId("summary-row").nth(1)).toContainText("8.2");
  await page.reload();
  await expect(visible(page, "run-summary-screen")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start run" })).toHaveCount(0);
});

test("1c: a run ended early shows its results, then the summary asks why, and Run again starts a new run on the same workout", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const s = await program(await userOf(testInfo.parallelIndex), treadmillRun);
  await startRun(page, s, "Treadmill");
  // End in the warm-up: an end on the last step is a finished run (as for a ride).
  await advance(page, s.userId, 30);
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByTestId("ride-paused")).toBeVisible();
  await page.clock.resume();
  await page.getByRole("button", { name: "End run" }).click();

  await expect(visible(page, "run-results")).toBeVisible();
  await expect(page.getByTestId("result-time-1")).toHaveText(/^0:3\d$/);
  await expect(page.getByTestId("result-time-2")).toHaveText("Not run");
  await page.getByTestId("results-done").click();
  await expect(visible(page, "run-summary-screen")).toContainText("Run ended early");
  await expect(page.getByTestId("run-kept")).toHaveText("Step 1 is saved");
  await page.getByRole("button", { name: "Time" }).click();
  await expect.poll(async () => (await testDb().select().from(rides).where(eq(rides.userId, s.userId)))[0]?.endReason).toBe("time");

  await page.getByTestId("summary-run-again").click();
  await expect(page.getByTestId("run-count")).toBeVisible();
  const all = await testDb().select().from(rides).where(eq(rides.userId, s.userId)).orderBy(asc(rides.id));
  expect(all.map((r) => [r.status, r.sessionId])).toEqual([
    ["ended_early", all[0].sessionId],
    ["running", all[0].sessionId],
  ]);
});

test("1b: a strides block cues the belt, counts its reps, and hold to skip skips the rest of it", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const s = await program(await userOf(testInfo.parallelIndex), stridesRun);
  await startRun(page, s, "Treadmill");
  // 10 s before the first stride: the cue to speed up.
  await advance(page, s.userId, 21);
  await expect(page.getByTestId("run-cue")).toHaveText("Speed up to 13.0 km/h");
  await advance(page, s.userId, 10);
  await expect(page.getByTestId("ride-header")).toContainText("Treadmill · step 2 of 3");
  await expect(page.getByTestId("ride-step-title")).toHaveText("Stride 1 of 2");
  await expect(page.getByTestId("run-dots")).toHaveAttribute("aria-label", "Stride 1 of 2, 0 done");
  await expect(page.getByTestId("run-belt")).toHaveText("13.0");
  await advance(page, s.userId, 21);
  await expect(page.getByTestId("ride-step-title")).toHaveText("Easy");
  await expect(page.getByTestId("run-belt")).toHaveText("7.0");
  await hold(page, "Hold to skip the strides");
  await expect(page.getByTestId("ride-toast")).toHaveText("Strides skippedUndo");
  await expect(page.getByTestId("ride-step-title")).toHaveText("Cool-down");
  await expect.poll(async () => (await savedSteps(s.userId)).map((r) => [r.programSetId, r.stepStatus])).toEqual([
    [s.setIds[0], "done"],
    [s.setIds[1], "done"],
    [s.setIds[2], "skipped"],
    [s.setIds[3], "skipped"],
    [s.setIds[4], "skipped"],
  ]);
});

test("2: offline belt taps replay and land in the steps they were tapped in", async ({ page, context }, testInfo) => {
  test.setTimeout(90_000);
  const s = await program(await userOf(testInfo.parallelIndex), shortRun);
  // On real time from the start: the stored run is never moved, so the page
  // and the server count the run alike, and a queued tap's time means the
  // same to both. (Moved by `advance` and then offline, the page never reads
  // the moved run: its taps replay seconds off, and one past the server's
  // now is placed at the server's now, maybe back in the warm-up.)
  await startRun(page, s, "Treadmill", { realTime: true });
  await context.setOffline(true);
  await page.getByRole("button", { name: "Belt up 0.5 km/h" }).click();
  await expect.poll(() => page.evaluate(() => JSON.stringify(Object.values(JSON.parse(localStorage.getItem("rideEventQueue") ?? "{}")).flat().length))).toBe("1");
  await expect(page.getByTestId("ride-header")).toContainText("Saved on this phone");
  // The warm-up ends offline; a tap in the steady step.
  await expect(page.getByTestId("ride-step-title")).toHaveText("Work", { timeout: 15_000 });
  await page.getByRole("button", { name: "Belt down 0.5 km/h" }).click();
  await expect.poll(() => page.evaluate(() => JSON.stringify(Object.values(JSON.parse(localStorage.getItem("rideEventQueue") ?? "{}")).flat().length))).toBe("2");
  expect(await beltEvents(s.userId)).toEqual([]);

  await context.setOffline(false);
  await expect.poll(async () => (await beltEvents(s.userId)).map((e) => e.value)).toEqual([80, 75]);
  const [ride] = await testDb().select().from(rides).where(eq(rides.userId, s.userId));
  const [one, two] = await beltEvents(s.userId);
  // Each lands in its own step: the first in the warm-up, the second after it.
  expect(one.at.getTime() - ride.startedAt.getTime()).toBeLessThan(8_000);
  // A step starts at its first millisecond: a tap there is in it.
  expect(two.at.getTime() - ride.startedAt.getTime()).toBeGreaterThanOrEqual(8_000);
  const keys = (ride.plan as { steps: { key: string }[] }).steps.map((p) => p.key);
  expect([one.stepKey, two.stepKey]).toEqual([keys[0], keys[1]]);
  // The warm-up's meters count the offline tap: 8 s at 7.5 km/h is 17 m, at 8.0 km/h 18 m.
  await expect.poll(async () => (await savedSteps(s.userId)).map((r) => [r.programSetId, r.stepStatus]).slice(0, 1)).toEqual([[s.setIds[0], "done"]]);
  const [warm] = await savedSteps(s.userId);
  const t = (one.at.getTime() - ride.startedAt.getTime()) / 1000;
  expect(warm.distanceMeters).toBe(Math.round((t * 75 + (8 - t) * 80) / 36));
  await expect(page.getByTestId("ride-header")).not.toContainText("Saved on this phone");
});

test("3: outdoors a 400 m rep shows its estimate and ends by Lap, behind the controls lock", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const s = await program(await userOf(testInfo.parallelIndex), repRun);
  await startRun(page, s, "Outdoor");
  await expect(page.getByTestId("ride-header")).toContainText("Outdoor · step 1 of 2");
  await expect(page.getByTestId("run-target-value")).toHaveText("Hard");
  await expect(page.getByTestId("run-distance")).toHaveText("400 m · about 2:16");

  // 90 s in, with no tap for 10 s: the controls are locked.
  await advance(page, s.userId, 90);
  await expect(page.getByTestId("run-lock")).toBeVisible();
  await hold(page, "Hold to unlock the controls");
  await expect(page.getByTestId("run-lock")).toHaveCount(0);
  await page.getByRole("button", { name: "Lap" }).click();
  await expect(page.getByTestId("ride-step-title")).toHaveText("Easy");
  await expect.poll(async () => (await savedSteps(s.userId)).map((r) => [r.programSetId, r.stepStatus])).toEqual([[s.setIds[0], "done"]]);
  const [rep] = await savedSteps(s.userId);
  expect(rep.durationSeconds).toBeGreaterThanOrEqual(90);
  expect(rep.durationSeconds).toBeLessThan(100);
  expect(rep.distanceMeters).toBeNull();
});

test("4: the ride of a brick that ended early hands over to its run, which shows T2 and links to the ride", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const userId = await userOf(testInfo.parallelIndex);
  const b = await program(userId, brickRide);
  const r = await program(userId, treadmillRun);
  const db = testDb();
  const [cycle] = await db.insert(trainingCycles).values({ userId, name: "Brick block", durationWeeks: 4, status: "active", startDate: today(), sessionsGeneratedAt: new Date() }).returning();
  const [parent] = await db.insert(plannedSessions).values({ userId, cycleId: cycle.id, date: today(), programId: b.programId, position: 1 }).returning();
  await db.insert(plannedSessions).values({ userId, cycleId: cycle.id, date: today(), programId: r.programId, position: 2, brickParentId: parent.id });

  // The ride: start indoors, pause after 30 s and end it early.
  await page.goto(`/programs/${b.programId}/workout/exercises/${b.peId}`);
  await expect(visible(page, "bike-exercise")).toBeVisible();
  if ((await visible(page, "ride-mode").textContent()) === "Outdoor") await page.getByRole("button", { name: "Change to Indoor trainer" }).click();
  await waitForLiveSession(page);
  await page.getByRole("button", { name: "Start ride" }).click();
  await expect(page.getByTestId("ride-screen")).toBeVisible();
  await freezeClock(page);
  shifted.set(userId, 0);
  await advance(page, userId, 30);
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByTestId("ride-paused")).toBeVisible();
  await page.clock.resume();
  await page.getByRole("button", { name: "End ride" }).click();

  // The ride's done screen hands over: Start run is the primary, the ride's numbers wait.
  await expect(visible(page, "brick-ride-done")).toBeVisible();
  await expect(visible(page, "brick-ride-done")).toContainText("Ride numbers later");
  await page.getByRole("link", { name: "Start run" }).click();
  await expect(visible(page, "run-exercise")).toBeVisible();
  // The ended ride is not a page to go back to: Back on the run reads Workout, as on every run screen.
  await expect(visible(page, "back-link")).toHaveText("Workout");
  await expect(visible(page, "run-t2")).toContainText(/T2 \d+:\d\d/);
  await startRun(page, { userId, programId: r.programId, peId: r.peId }, "Treadmill", { open: false });
  // A brick run's first 10 min run on effort with short quick steps (4.2).
  await expect(page.getByTestId("run-second")).toContainText("Short quick steps");
  const [ride] = await db.select().from(rides).where(and(eq(rides.userId, userId), eq(rides.sport, "bike")));
  const [run] = await db.select().from(rides).where(and(eq(rides.userId, userId), eq(rides.sport, "run")));
  expect(ride.status).toBe("ended_early");
  expect(run.brickRideId).toBe(ride.id);
});

test("8: the treadmill run test carries the raised belt into the 20 min, Save stores LTHR and pace, and the run screen shows the new belt speeds", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const userId = await userOf(testInfo.parallelIndex);
  const db = testDb();
  // Threshold pace 5:20 /km and LTHR 180 before the test.
  await db.delete(athleteThresholds).where(eq(athleteThresholds.userId, userId));
  await db.insert(athleteThresholds).values([
    { userId, kind: "run_threshold_pace", value: 1000 / 320, measuredOn: "2026-01-05", source: "manual" },
    { userId, kind: "lthr_run", value: 180, measuredOn: "2026-01-05", source: "manual" },
  ]);
  const s = await program(userId, { ...runTestWorkout("treadmill"), name: "Run test e2e" });
  await page.goto(`/programs/${s.programId}/workout/exercises/${s.peId}`);
  await expect(visible(page, "run-test-checks")).toHaveText("No hard session in the last 48 hoursStop for chest pain, dizziness or unusual breathlessness");
  await startRun(page, s, "Treadmill", { open: false });

  // After the 15 min warm-up the test starts at 10.0 km/h; the runner raises it to 11.5.
  await advance(page, s.userId, 900);
  await expect(page.getByTestId("ride-header")).toContainText("step 8 of 10");
  await expect(page.getByTestId("run-belt")).toHaveText("10.0");
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Belt up 0.5 km/h" }).click();
  await expect(page.getByTestId("run-belt")).toHaveText("11.5");
  await advance(page, s.userId, 2.1);
  await expect.poll(async () => (await beltEvents(s.userId)).map((e) => e.value)).toEqual([115]);

  // The 20 min keeps the belt the first 10 min ended on.
  await advance(page, s.userId, 598);
  await expect(page.getByTestId("ride-header")).toContainText("step 9 of 10");
  await expect(page.getByTestId("run-belt")).toHaveText("11.5");
  await advance(page, s.userId, 1200);
  await expect(page.getByTestId("ride-header")).toContainText("step 10 of 10");
  await advance(page, s.userId, 600);
  await page.clock.resume();

  // The results: the 20 min heart rate and the effort.
  await expect(visible(page, "run-results")).toBeVisible();
  await expect.poll(async () => (await savedSteps(s.userId)).length).toBe(10);
  await page.getByTestId("result-avgHr-9").fill("176");
  await page.getByRole("group", { name: "Effort of the run" }).getByRole("button", { name: "9" }).click();
  await page.getByTestId("results-done").click();

  // New threshold pace from the whole 30 min (about 11.5 km/h, from the belt meters of the two test steps) and LTHR from the 20 min.
  await expect(visible(page, "run-summary-screen")).toContainText("Run done");
  const testSteps = (await savedSteps(s.userId)).slice(7, 9);
  expect(testSteps.map((r) => [r.durationSeconds, r.sources?.distanceMeters])).toEqual([
    [600, "belt"],
    [1200, "belt"],
  ]);
  const meters30 = testSteps[0].distanceMeters! + testSteps[1].distanceMeters!;
  expect(testSteps[1].distanceMeters).toBe(Math.round((1200 * 11.5) / 3.6));
  // Cut to the whole second, as every run pace is (paceText).
  const pace = paceText(1000 / (meters30 / 1800));
  expect(["5:13 /km", "5:14 /km"]).toContain(pace);
  const line = page.getByTestId("summary-threshold");
  await expect(line).toHaveText(`New threshold pace ${pace} · LTHR 176Save`);
  await line.getByRole("button", { name: "Save" }).click();
  await expect(line).toHaveText(`New threshold pace ${pace} · LTHR 176Saved`);
  // Measured on the day the run started, in the runner's time zone.
  const [ran] = await db.select({ startedAt: rides.startedAt }).from(rides).where(and(eq(rides.userId, userId), eq(rides.sport, "run")));
  const runDay = `${ran.startedAt.getFullYear()}-${pad(ran.startedAt.getMonth() + 1)}-${pad(ran.startedAt.getDate())}`;
  const saved = await db.select().from(athleteThresholds).where(and(eq(athleteThresholds.userId, userId), eq(athleteThresholds.source, "test")));
  expect(saved.map((r) => [r.kind, r.protocol, r.measuredOn]).sort()).toEqual([
    ["lthr_run", "run_30min", runDay],
    ["run_threshold_pace", "run_30min", runDay],
  ]);
  expect(saved.find((r) => r.kind === "lthr_run")!.testData).toEqual({ avgHrLast20: 176 });
  expect(saved.find((r) => r.kind === "run_threshold_pace")!.testData).toEqual({ distance30Meters: meters30 });

  // Another run at 130% of threshold speed now shows the new belt: 15.0 km/h, not 14.5.
  const other = await program(userId, {
    v: 2,
    sport: "run",
    name: "Fast e2e",
    steps: [{ type: "work", end: { type: "time", seconds: 600 }, target: { metric: "pace", anchor: "threshold_pace", low: 130, high: 130 } }],
  });
  await page.goto(`/programs/${other.programId}/workout/exercises/${other.peId}`);
  await expect(visible(page, "run-exercise")).toBeVisible();
  if ((await visible(page, "run-mode").textContent()) !== "Treadmill") {
    await page.getByRole("button", { name: "Change" }).click();
    await page.getByTestId("run-mode-sheet").getByRole("button", { name: "Treadmill" }).click();
  }
  await expect(visible(page, "run-summary")).toContainText(`threshold ${pace}`);
  await expect(visible(page, "run-step-detail").first()).toHaveText("Belt 15.0 km/h");
});

test("R16: the play address of a run-only program opens its run exercise", async ({ page }, testInfo) => {
  const userId = await userOf(testInfo.parallelIndex);
  const r = await program(userId, treadmillRun);
  const db = testDb();
  const [cycle] = await db.insert(trainingCycles).values({ userId, name: "Run block", durationWeeks: 4, status: "active", startDate: today(), sessionsGeneratedAt: new Date() }).returning();
  const [planned] = await db.insert(plannedSessions).values({ userId, cycleId: cycle.id, date: today(), programId: r.programId }).returning();
  await page.goto(`/planned/${planned.id}/play`);
  await expect(page).toHaveURL(new RegExp(`/programs/${r.programId}/workout/exercises/${r.peId}\\?ride=1&planned=${planned.id}$`));
  // No run runs yet: the run screen, ready to start.
  await expect(visible(page, "run-exercise")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start run" })).toBeVisible();
});
