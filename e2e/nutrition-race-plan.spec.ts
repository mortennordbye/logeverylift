import { and, eq, isNull } from "drizzle-orm";
import { athleteThresholds, exercises, fuelLogs, racePlans, seasonRaces, seasons, users, workoutSessions, workoutSets } from "../src/db/schema";
import { e2eUser } from "./fixtures/env";
import { testDb } from "./fixtures/reset";
import { expect, test } from "./fixtures/test";

/**
 * Nutrition and the race-day plan (docs/plans/nutrition-and-race-day.md, 6):
 * an endurance user logs fuel with a gut score for a two-hour ride logged in
 * the app (no Garmin), gut training picks it up, then the user opens the A
 * race's plan from Nutrition, edits it, and the timeline and the stored row
 * follow.
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

async function setup(parallelIndex: number) {
  const db = testDb();
  const user = await db.query.users.findFirst({ where: eq(users.email, e2eUser(parallelIndex).email) });
  const userId = user!.id;
  await db.update(users).set({ enduranceEnabled: true, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }).where(eq(users.id, userId));
  await db.insert(athleteThresholds).values({ userId, kind: "ftp", value: 250, measuredOn: today(), source: "manual" });
  const [bike] = await db
    .select({ id: exercises.id })
    .from(exercises)
    .where(and(eq(exercises.discipline, "bike"), isNull(exercises.userId)))
    .limit(1);
  const [session] = await db
    .insert(workoutSessions)
    .values({ userId, programId: null, date: today(), startTime: new Date(Date.now() - 3 * 3600_000), endTime: new Date(Date.now() - 3600_000), isCompleted: true })
    .returning({ id: workoutSessions.id });
  await db.insert(workoutSets).values({ sessionId: session.id, exerciseId: bike.id, setNumber: 1, actualReps: 0, weightKg: "0", restTimeSeconds: 0, durationSeconds: 7200, isCompleted: true });
  const year = Number(today().slice(0, 4)) + 1;
  const [season] = await db.insert(seasons).values({ userId, name: "Next season", startDate: today(), endDate: `${year}-12-31` }).returning({ id: seasons.id });
  const [race] = await db
    .insert(seasonRaces)
    .values({ seasonId: season.id, userId, name: "Summer half", raceDate: `${year}-08-20`, discipline: "triathlon", distance: "half", priority: "A" })
    .returning({ id: seasonRaces.id });
  return { userId, sessionId: session.id, raceId: race.id };
}

let hydrationErrors: string[] = [];
test.beforeEach(async ({ page }) => {
  hydrationErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && /Hydration|#418|#423|did not match/i.test(msg.text())) hydrationErrors.push(msg.text());
  });
});
test.afterEach(() => {
  expect(hydrationErrors, "hydration errors in the browser console").toEqual([]);
});

test("log fuel for an app session, then plan the A race", async ({ page }, testInfo) => {
  const { sessionId, raceId } = await setup(testInfo.parallelIndex);
  const db = testDb();

  await page.goto("/more/nutrition");
  await expect(page.getByTestId("nutrition-disclaimer")).toContainText("not medical advice");
  await expect(page.getByTestId("gut-training")).toContainText("No fueled session");

  // The two-hour ride from today, with no fuel yet.
  await page.getByRole("button", { name: /Workout.*2:00 h.*Add/ }).click();
  await page.getByLabel("Carbohydrate").fill("140");
  await page.getByRole("group", { name: "GI score" }).getByRole("button", { name: "2", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect(page.getByRole("button", { name: /Workout.*140 g · GI 2/ })).toBeVisible();
  await expect(page.getByTestId("gut-training")).toContainText("70 g/h");
  const [log] = await db.select().from(fuelLogs).where(eq(fuelLogs.workoutSessionId, sessionId));
  expect(log).toMatchObject({ carbsG: 140, giScore: 2, durationS: 7200, garminActivityId: null });

  // The race plan, from Nutrition.
  await page.getByRole("link", { name: /Summer half/ }).click();
  await expect(page).toHaveURL(new RegExp(`/races/${raceId}/plan$`));
  await expect(page.getByTestId("race-plan-safety")).toContainText("not medical advice");
  // A first half with FTP 250: IF 0.70-0.75, capped to 0.75 by the TSS cap at the assumed bike time.
  await expect(page.getByTestId("bike-pacing")).toContainText("W");

  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Start time").fill("08:00");
  await page.getByLabel("Bike", { exact: true }).fill("150");
  await page.getByLabel("Swim", { exact: true }).fill("40");
  await page.getByRole("button", { name: "Save plan" }).click();

  const timeline = page.getByTestId("race-timeline");
  await expect(timeline.getByRole("row").first()).toContainText("08:00");
  // Swim 40 min, then T1 (5 min default for a half): the bike starts at 08:45.
  await expect(timeline.getByRole("row").nth(2)).toContainText("08:45");
  await expect(page.getByTestId("bike-pacing")).toContainText("188-188 W");
  // Race fuel at 80 % of 70 g/h = 55 g/h on the bike, never lifted above that: 18 g per 20 minutes.
  await expect(page.getByTestId("fuel-schedule")).toContainText("18 g");
  await expect(page.getByTestId("fuel-totals")).toContainText("Bike in all");
  await expect(page.getByTestId("sodium-text")).toContainText("mg/h");

  const [row] = await db.select().from(racePlans).where(eq(racePlans.seasonRaceId, raceId));
  expect(row).toMatchObject({ version: 1, plan: { startTime: "08:00", bikeMinutes: 150, swimMinutes: 40, fuelIntervalMinutes: 20, caffeine: false } });
});
