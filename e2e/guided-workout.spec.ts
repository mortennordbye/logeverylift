import { asc, eq } from "drizzle-orm";
import { athleteThresholds, plannedSessions, trainingCycles, users, workoutSessions, workoutSets } from "../src/db/schema";
import type { Workout } from "../src/lib/utils/workout-steps";
import { e2eUser } from "./fixtures/env";
import { testDb } from "./fixtures/reset";
import { insertStepProgram } from "./fixtures/step-program";
import { expect, test } from "./fixtures/test";

/**
 * The guided player and the pool view (docs/plans/endurance-app.md, 3-5): an
 * endurance user starts today's run from home, the steps change on their own,
 * pause, resume, skip and lap work, the results save as a logged session
 * linked to the plan, and the week view shows it done. A swim opens the pool
 * view and its send-off clock. Each session runs a program with steps
 * (docs/plans/one-program-model.md); e2e/guided-program.spec.ts starts one
 * from the workout screen instead.
 *
 * The browser runs in a far time zone (UTC+14), unlike the server and the
 * user's setting, so a date or number formatted differently on the server and
 * in the browser fails the spec as a hydration error.
 */
test.use({ timezoneId: "Pacific/Kiritimati" });

const pad = (n: number) => String(n).padStart(2, "0");
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const run: Workout = {
  v: 2,
  sport: "run",
  name: "Quick run",
  steps: [
    { type: "warmup", end: { type: "time", seconds: 5 }, target: { metric: "hr", anchor: "absolute", low: 125, high: 145 } },
    { type: "work", end: { type: "time", seconds: 6 }, target: { metric: "hr", anchor: "absolute", low: 150, high: 160 } },
    { type: "work", end: { type: "time", seconds: 600 }, target: { metric: "hr", anchor: "absolute", low: 140, high: 150 } },
    { type: "cooldown", end: { type: "lap" } },
  ],
};
const swim: Workout = {
  v: 2,
  sport: "swim",
  name: "Pool set",
  poolLengthM: 25,
  steps: [
    { type: "warmup", end: { type: "distance", meters: 200 } },
    { type: "repeat", count: 2, steps: [{ type: "work", end: { type: "distance", meters: 100 }, sendOffSeconds: 20, target: { metric: "pace", anchor: "css", offsetLow: 2, offsetHigh: 5 } }] },
  ],
};

/** The worker's user with the endurance switch, FTP and CSS, and one session today running a program with `workout`'s steps. */
async function setup(parallelIndex: number, workout: Workout) {
  const db = testDb();
  const user = await db.query.users.findFirst({ where: eq(users.email, e2eUser(parallelIndex).email) });
  const userId = user!.id;
  await db.delete(workoutSessions).where(eq(workoutSessions.userId, userId));
  await db.delete(trainingCycles).where(eq(trainingCycles.userId, userId));
  await db.delete(athleteThresholds).where(eq(athleteThresholds.userId, userId));
  await db.update(users).set({ enduranceEnabled: true, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }).where(eq(users.id, userId));
  await db.insert(athleteThresholds).values([
    { userId, kind: "ftp", value: 250, measuredOn: today(), source: "manual" },
    { userId, kind: "swim_css", value: 100 / 105, measuredOn: today(), source: "manual" },
  ]);
  const [cycle] = await db
    .insert(trainingCycles)
    .values({ userId, name: "Tri block", durationWeeks: 4, status: "active", startDate: today(), sessionsGeneratedAt: new Date() })
    .returning();
  const programId = await insertStepProgram(db, userId, workout);
  const [row] = await db.insert(plannedSessions).values({ userId, cycleId: cycle.id, date: today(), programId }).returning({ id: plannedSessions.id });
  return { userId, plannedId: row.id };
}

test.beforeEach(async ({ page }) => {
  // Audio and the wake lock are stubbed: headless browsers give neither reliably (brief, section 10).
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: { request: async () => ({ release: async () => undefined }) },
    });
  });
  // A hydration mismatch is a console error, not a page error: collect it and fail after the spec.
  hydrationErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && /Hydration|#418|#423|did not match/i.test(msg.text())) hydrationErrors.push(msg.text());
  });
});

let hydrationErrors: string[] = [];
test.afterEach(() => {
  expect(hydrationErrors, "hydration errors in the browser console").toEqual([]);
});

test("a guided run from home: steps change on time, pause, skip, lap, results saved and linked", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const { userId, plannedId } = await setup(testInfo.parallelIndex, run);

  // Playwright's clock: time still flows, and runFor jumps ahead with no sleep.
  await page.clock.install();
  await page.goto("/");
  // Today's session starts from the Today card, which asks how (docs/plans/one-program-model.md, home merge).
  await page.getByTestId("today-card").getByRole("button", { name: /Start Today's Workout/ }).click();
  await page.getByTestId("start-choice").getByRole("link", { name: /^Guided/ }).click();

  await expect(page.getByTestId("player-ready")).toBeVisible();
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByTestId("player-step-count")).toHaveText("Step 1 of 4");
  await expect(page.getByTestId("player-target")).toHaveText("125-145 bpm");

  // The 5 s warm-up ends by itself.
  await page.clock.runFor(5_500);
  await expect(page.getByTestId("player-step-count")).toHaveText("Step 2 of 4");
  await expect(page.getByTestId("player-target")).toHaveText("150-160 bpm");

  await page.getByRole("button", { name: "Pause" }).click();
  const frozen = await page.getByTestId("player-time").textContent();
  await page.clock.runFor(60_000);
  await expect(page.getByTestId("player-time")).toHaveText(frozen!);
  await expect(page.getByTestId("player-step-count")).toHaveText("Step 2 of 4");
  await page.getByRole("button", { name: "Resume" }).click();

  // The 6 s work step ends by itself; skip the long one.
  await page.clock.runFor(6_500);
  await expect(page.getByTestId("player-step-count")).toHaveText("Step 3 of 4");
  await page.getByRole("button", { name: "Skip" }).click();
  await expect(page.getByTestId("player-step-count")).toHaveText("Step 4 of 4");
  await page.getByRole("button", { name: "Lap" }).click();

  await expect(page).toHaveURL(new RegExp(`/planned/${plannedId}/results`));
  await expect(page.getByTestId("result-step")).toHaveCount(4);
  await page.getByRole("button", { name: "7", exact: true }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(new RegExp(`/planned/${plannedId}$`));

  const db = testDb();
  await expect
    .poll(async () => (await db.select().from(workoutSessions).where(eq(workoutSessions.userId, userId))).map((s) => [s.plannedSessionId, s.isCompleted, s.source]))
    .toEqual([[plannedId, true, "app"]]);
  const [session] = await db.select().from(workoutSessions).where(eq(workoutSessions.userId, userId));
  expect(session.clientKey).not.toBeNull(); // a player save
  const sets = await db.select().from(workoutSets).where(eq(workoutSets.sessionId, session.id)).orderBy(asc(workoutSets.setNumber));
  expect(sets.map((s) => s.stepStatus)).toEqual(["done", "done", "skipped", "done"]);

  await page.goto("/week");
  await expect(page.getByTestId("load-card")).toBeVisible();
  // Done and linked, with the logged time. The lap step leaves the plan's time open, so the band is "done".
  const week = page.getByTestId("week-session").filter({ hasText: "Quick run" });
  await expect(week).toContainText("done 00:1");
  await expect(week).not.toContainText("planned");
});

test("a swim opens the pool view with the target per 100 m and the send-off clock", async ({ page }, testInfo) => {
  const { plannedId } = await setup(testInfo.parallelIndex, swim);
  await page.goto("/");
  await page.getByTestId("today-card").getByRole("button", { name: /Start Today's Workout/ }).click();
  await page.getByTestId("start-choice").getByRole("link", { name: /^Pool view/ }).click();

  await expect(page.getByTestId("pool-view")).toBeVisible();
  await expect(page.getByTestId("pool-block-count")).toHaveText("Block 1 of 2");
  await page.getByTestId("pool-block").click();
  await expect(page.getByTestId("pool-block-count")).toHaveText("Block 2 of 2");
  await expect(page.getByTestId("pool-target")).toHaveText("1:47-1:50/100m");

  await page.getByRole("link", { name: "Start send-off clock" }).click();
  await expect(page).toHaveURL(new RegExp(`/planned/${plannedId}/play`));
  await page.getByRole("button", { name: "Start", exact: true }).click();
  // The warm-up is a distance step: it waits for Lap. Then each rep counts down to its send-off.
  await page.getByRole("button", { name: "Lap" }).click();
  await expect(page.getByTestId("player-step-type")).toHaveText("Work · Rep 1 of 2");
  await expect(page.getByText("to the next send-off")).toBeVisible();
});
