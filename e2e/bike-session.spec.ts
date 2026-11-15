import { eq } from "drizzle-orm";
import { athleteThresholds, garminDays, plannedSessions, trainingCycles, users, workoutSessions } from "../src/db/schema";
import { HR_ZONES_SNAPSHOT, TEMPO_WORKOUT } from "../src/__tests__/fixtures/bike-sessions";
import { e2eUser } from "./fixtures/env";
import { testDb } from "./fixtures/reset";
import { expect, test } from "./fixtures/test";

/**
 * The tempo ride before the ride, at 390 px (docs/plans/bike-sessions.md, 5.1
 * and 5.2, done when of S3): the Today card shows the ride instead of Rest
 * Day, and the session page shows watts, % FTP, HR in bpm with the Garmin
 * zone, and cadence, with no note to read.
 */

const pad = (n: number) => String(n).padStart(2, "0");
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function setup(parallelIndex: number) {
  const db = testDb();
  const user = await db.query.users.findFirst({ where: eq(users.email, e2eUser(parallelIndex).email) });
  const userId = user!.id;
  await db.delete(workoutSessions).where(eq(workoutSessions.userId, userId));
  await db.delete(trainingCycles).where(eq(trainingCycles.userId, userId));
  await db.delete(athleteThresholds).where(eq(athleteThresholds.userId, userId));
  await db.delete(garminDays).where(eq(garminDays.userId, userId));
  await db.update(users).set({ enduranceEnabled: true, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }).where(eq(users.id, userId));
  await db.insert(athleteThresholds).values([
    { userId, kind: "ftp", value: 180, measuredOn: today(), source: "manual" },
    { userId, kind: "lthr_bike", value: 175, measuredOn: today(), source: "manual" },
  ]);
  await db.insert(garminDays).values({ userId, calendarDate: today(), kind: "hr_zones", data: HR_ZONES_SNAPSHOT });
  const [cycle] = await db
    .insert(trainingCycles)
    .values({ userId, name: "General: aerobic base + strength", durationWeeks: 4, status: "active", startDate: today(), sessionsGeneratedAt: new Date() })
    .returning();
  const [row] = await db.insert(plannedSessions).values({ userId, cycleId: cycle.id, date: today(), workout: TEMPO_WORKOUT }).returning({ id: plannedSessions.id });
  return { plannedId: row.id };
}

test("the tempo ride on the Today card and the session page at 390 px", async ({ page }, testInfo) => {
  const { plannedId } = await setup(testInfo.parallelIndex);
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/");
  const card = page.getByTestId("today-card");
  await expect(card).toContainText("Tempo 2 x 15 min");
  await expect(card).not.toContainText("Rest Day");
  await expect(card.getByTestId("bike-totals")).toContainText("65 min");
  await expect(card.getByTestId("bike-lines")).toContainText("135-144 W");
  await expect(card.getByRole("link", { name: "Start guided" })).toHaveAttribute("href", `/planned/${plannedId}/play`);
  await card.getByRole("link", { name: "Details" }).click();

  await expect(page).toHaveURL(new RegExp(`/planned/${plannedId}$`));
  await expect(page.getByTestId("planned-name")).toHaveText("Tempo 2 x 15 min");
  await expect(page.getByTestId("profile-chart")).toBeVisible();
  await expect(page.getByTestId("coach-note")).toContainText("talk in short sentences");

  const work = page.getByTestId("step-card").nth(1);
  await expect(work.getByTestId("step-target")).toHaveText("135-144 W");
  await expect(work.getByTestId("step-power-sub")).toHaveText("75-80 % FTP · power Z3");
  await expect(work).toContainText("141-160 bpm · Garmin Z3");
  await expect(work).toContainText("85-95 rpm");
  await expect(page.getByTestId("step-card").first()).toContainText("under 140 bpm · Garmin Z2");

  await expect(page.getByTestId("your-numbers")).toContainText("Garmin cycling zones");
  await expect(page.getByTestId("record-box")).toContainText("Press Lap at each step change: 4 times.");
  await expect(page.getByRole("link", { name: "Start guided" })).toHaveAttribute("href", `/planned/${plannedId}/play`);

  // Nothing wider than the phone.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
