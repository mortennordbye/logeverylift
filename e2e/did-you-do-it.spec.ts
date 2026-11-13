import { and, eq } from "drizzle-orm";
import { illnessPeriods, plannedSessions, trainingCycles, users, workoutSessions } from "../src/db/schema";
import { RETURN_RULE } from "../src/lib/utils/session-compliance";
import { e2eUser } from "./fixtures/env";
import { testDb } from "./fixtures/reset";
import { expect, test } from "./fixtures/test";

/**
 * "Did you do it?" on the home screen (docs/plans/workouts-and-compliance.md,
 * 6.5 to 6.7 and 7): an endurance user answers a past run, a missed key
 * session moves to its suggested day, and a sick period pauses the prompt
 * until "I'm better". Each test builds its own cycle around today, so the
 * result does not depend on the day the suite runs.
 */

const pad = (n: number) => String(n).padStart(2, "0");
function dayStr(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** As the app shows a day: "Thu 14 Nov". */
const shortDay = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

const runWorkout = (name: string, minutes: number) => ({
  v: 1,
  sport: "run",
  name,
  steps: [{ type: "work", end: { type: "time", seconds: minutes * 60 } }],
});

type Row = { date: string; name: string; minutes: number; priority?: "key" | "support"; status?: "planned" | "missed" };

/** The user with no history and one weekday cycle holding only `rows`, run sessions with a workout. */
async function enduranceUser(parallelIndex: number, rows: Row[], endurance = true) {
  const db = testDb();
  const user = await db.query.users.findFirst({ where: eq(users.email, e2eUser(parallelIndex).email) });
  const userId = user!.id;
  await db.delete(workoutSessions).where(eq(workoutSessions.userId, userId));
  await db.delete(trainingCycles).where(eq(trainingCycles.userId, userId));
  await db
    .update(users)
    .set({ enduranceEnabled: endurance, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })
    .where(eq(users.id, userId));
  const [cycle] = await db
    .insert(trainingCycles)
    .values({ userId, name: "Run block", durationWeeks: 4, status: "active", startDate: dayStr(-7), sessionsGeneratedAt: new Date() })
    .returning();
  const ids: number[] = [];
  for (const r of rows) {
    const [row] = await db
      .insert(plannedSessions)
      .values({
        userId,
        cycleId: cycle.id,
        date: r.date,
        label: r.name,
        workout: runWorkout(r.name, r.minutes),
        priority: r.priority ?? null,
        status: r.status ?? "planned",
        statusOn: r.status === "missed" ? dayStr(0) : null,
      })
      .returning({ id: plannedSessions.id });
    ids.push(row.id);
  }
  return { userId, ids };
}

const plannedRow = async (id: number) => (await testDb().select().from(plannedSessions).where(eq(plannedSessions.id, id)))[0];

test("a lifter sees no prompt; an endurance user answers Yes with 45 minutes", async ({ page }, testInfo) => {
  const s = await enduranceUser(testInfo.parallelIndex, [{ date: dayStr(-1), name: "Easy run", minutes: 40 }], false);
  await page.goto("/");
  await expect(page.getByText("Run block")).toBeVisible();
  await expect(page.getByTestId("did-you-do-it")).toBeHidden();

  await testDb().update(users).set({ enduranceEnabled: true }).where(eq(users.id, s.userId));
  await page.goto("/");
  const row = page.getByTestId("unconfirmed-session");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Easy run");
  await expect(row).toContainText(shortDay(dayStr(-1)));

  await page.getByRole("button", { name: "Yes, I did Easy run" }).click();
  const sheet = page.getByTestId("confirm-done-sheet");
  await sheet.getByLabel("Time").fill("45");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("did-you-do-it")).toBeHidden();

  await expect
    .poll(async () =>
      (await testDb().select().from(workoutSessions).where(eq(workoutSessions.userId, s.userId))).map((w) => [w.plannedSessionId, w.isCompleted, w.date]),
    )
    .toEqual([[s.ids[0], true, dayStr(-1)]]);
});

test("a missed key session moves to its suggested day; a missed easy one gets no suggestion", async ({ page }, testInfo) => {
  const s = await enduranceUser(testInfo.parallelIndex, [
    { date: dayStr(0), name: "Long run", minutes: 100, priority: "key", status: "missed" },
    { date: dayStr(-1), name: "Easy run", minutes: 30, priority: "support" },
  ]);
  const [keyId, easyId] = s.ids;
  await page.goto("/");

  // The easy run is still to answer; Missed stores it and suggests nothing.
  await page.getByRole("button", { name: "I missed Easy run" }).click();
  await expect.poll(async () => (await plannedRow(easyId)).status).toBe("missed");
  await expect(page.getByTestId("unconfirmed-session")).toHaveCount(0);

  const missed = page.getByTestId("missed-key-session");
  await expect(missed).toHaveCount(1);
  await expect(missed).toContainText("Long run");
  await expect(page.getByTestId("missed-key")).not.toContainText("Easy run");

  // The suggestion is the next day in the same week; on a Sunday there is none.
  const sunday = new Date().getDay() === 0;
  if (sunday) {
    await expect(missed).toContainText("No free day this week. Skip it and go on.");
    return;
  }
  await missed.getByRole("button", { name: `Move to ${shortDay(dayStr(1))}` }).click();
  await expect.poll(async () => {
    const r = await plannedRow(keyId);
    return [r.date, r.status];
  }).toEqual([dayStr(1), "planned"]);
  await expect(page.getByTestId("missed-key-session")).toHaveCount(0);
});

test("a sick period from yesterday: no prompt, the banner shows, and I'm better ends it", async ({ page }, testInfo) => {
  const s = await enduranceUser(testInfo.parallelIndex, [{ date: dayStr(-1), name: "Easy run", minutes: 40 }]);
  const [period] = await testDb().insert(illnessPeriods).values({ userId: s.userId, startedOn: dayStr(-1) }).returning({ id: illnessPeriods.id });

  await page.goto("/");
  const banner = page.getByTestId("sick-banner");
  await expect(banner).toContainText(`Sick since ${shortDay(dayStr(-1))}. Sessions are paused.`);
  await expect(page.getByTestId("did-you-do-it")).toBeHidden();

  await banner.getByRole("button", { name: "I'm better" }).click();
  await banner.getByRole("button", { name: "Yesterday" }).click();
  await expect
    .poll(async () => (await testDb().select().from(illnessPeriods).where(and(eq(illnessPeriods.id, period.id), eq(illnessPeriods.userId, s.userId))))[0].endedOn)
    .toBe(dayStr(-1));

  // Back after it: the first line of the return rule, and all of it under More.
  const back = page.getByTestId("return-banner");
  await expect(back).toContainText(RETURN_RULE[0].text);
  await expect(back).not.toContainText(RETURN_RULE[1].text);
  await back.getByRole("button", { name: "More" }).click();
  await expect(back).toContainText(RETURN_RULE[1].text);
  // Sessions in the sick days stay out of the prompt.
  await expect(page.getByTestId("did-you-do-it")).toBeHidden();
});
