import { and, eq, isNull } from "drizzle-orm";
import { athleteThresholds, plannedSessions, trainingCycles, users, workoutSessions, workouts } from "../src/db/schema";
import { e2eUser } from "./fixtures/env";
import { testDb } from "./fixtures/reset";
import { expect, test } from "./fixtures/test";

/**
 * The workout editor with no AI (docs/plans/bike-sessions.md, 5.3 and 7):
 * the tempo becomes 3 x 12 min for one session and Undo puts it back; then a
 * new library workout is built and planned on the calendar.
 */

const pad = (n: number) => String(n).padStart(2, "0");
function day(offset = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const MIN = 60;
const tempo = {
  v: 1,
  sport: "bike",
  name: "Tempo 2 x 15 min",
  steps: [
    { id: "s1", type: "warmup", end: { type: "time", seconds: 15 * MIN }, target: { metric: "power", anchor: "ftp", low: 60, high: 72 } },
    { id: "s2", type: "work", end: { type: "time", seconds: 15 * MIN }, target: { metric: "power", anchor: "ftp", low: 75, high: 80 } },
    { id: "s3", type: "recovery", end: { type: "time", seconds: 5 * MIN }, target: { metric: "power", anchor: "ftp", low: 50, high: 60 } },
    { id: "s4", type: "work", end: { type: "time", seconds: 15 * MIN }, target: { metric: "power", anchor: "ftp", low: 75, high: 80 } },
    { id: "s5", type: "cooldown", end: { type: "time", seconds: 15 * MIN }, target: { metric: "power", anchor: "ftp", low: 60, high: 72 } },
  ],
};

/** The worker's user with the endurance switch and FTP 180, a cycle from today, and the tempo tomorrow. */
async function setup(parallelIndex: number) {
  const db = testDb();
  const user = await db.query.users.findFirst({ where: eq(users.email, e2eUser(parallelIndex).email) });
  const userId = user!.id;
  await db.delete(workoutSessions).where(eq(workoutSessions.userId, userId));
  await db.delete(trainingCycles).where(eq(trainingCycles.userId, userId));
  await db.delete(workouts).where(eq(workouts.userId, userId));
  await db.delete(athleteThresholds).where(eq(athleteThresholds.userId, userId));
  await db.update(users).set({ enduranceEnabled: true, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }).where(eq(users.id, userId));
  await db.insert(athleteThresholds).values({ userId, kind: "ftp", value: 180, measuredOn: day(), source: "manual" });
  const [lib] = await db.insert(workouts).values({ userId, name: tempo.name, sport: "bike", workout: tempo }).returning({ id: workouts.id });
  const [cycle] = await db
    .insert(trainingCycles)
    .values({ userId, name: "Base block", durationWeeks: 4, status: "active", scheduleType: "day_of_week", startDate: day(), sessionsGeneratedAt: new Date() })
    .returning();
  const [row] = await db.insert(plannedSessions).values({ userId, cycleId: cycle.id, date: day(1), workout: tempo, workoutId: lib.id }).returning({ id: plannedSessions.id });
  return { userId, plannedId: row.id, cycleId: cycle.id };
}

const sessionName = async (id: number) => {
  const [row] = await testDb().select({ workout: plannedSessions.workout }).from(plannedSessions).where(eq(plannedSessions.id, id));
  return (row.workout as { name: string }).name;
};

test("the tempo becomes 3 x 12 min for this session, and Undo puts it back", async ({ page }, testInfo) => {
  const { plannedId } = await setup(testInfo.parallelIndex);
  await page.goto(`/planned/${plannedId}/edit`);
  await expect(page.getByLabel("Name")).toHaveValue("Tempo 2 x 15 min");

  // Out: both 15 min blocks and the easy step between them.
  for (const name of ["Work 15 min", "Recovery 5 min", "Work 15 min"]) {
    await page.getByRole("button", { name: `Options for ${name}` }).first().click();
    await page.getByRole("button", { name: "Delete step" }).click();
  }
  // In: a repeat of 12 min at 75-80 % FTP and 3 min easy, three times, before the cool-down.
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByTestId("add-sheet").getByRole("button", { name: "Repeat" }).click();
  await page.getByRole("button", { name: /Work 5 min\. Edit/ }).click();
  const sheet = page.getByTestId("step-sheet");
  await sheet.getByLabel("Minutes").fill("12");
  await sheet.getByRole("group", { name: "Main target: kind" }).getByRole("button", { name: "Power" }).click();
  await sheet.getByRole("group", { name: "Main target: unit" }).getByRole("button", { name: "% FTP" }).click();
  await sheet.getByLabel("Main target, low (% FTP)").fill("75");
  await sheet.getByLabel("Main target, high (% FTP)").fill("80");
  await expect(sheet.getByTestId("target-forms")).toHaveText("75-80 % FTP = 135-144 W, power Z3");
  await sheet.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: /Recovery 2 min\. Edit/ }).click();
  await page.getByTestId("step-sheet").getByLabel("Minutes").fill("3");
  await page.getByTestId("step-sheet").getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "More times" }).click();
  await expect(page.getByTestId("repeat-count")).toHaveText("3 x");
  await page.getByRole("button", { name: "Repeat options" }).click();
  await page.getByRole("button", { name: "Move up" }).click();
  await page.getByLabel("Name").fill("Tempo 3 x 12 min");
  await expect(page.getByTestId("editor-summary")).toContainText("1 h 15 min");

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByTestId("save-sheet").getByRole("button", { name: "This session" }).click();
  await expect(page.getByTestId("editor-saved")).toContainText("Saved for this session.");
  await expect.poll(() => sessionName(plannedId)).toBe("Tempo 3 x 12 min");
  const [saved] = await testDb().select({ workout: plannedSessions.workout }).from(plannedSessions).where(eq(plannedSessions.id, plannedId));
  const steps = (saved.workout as { steps: { type: string; count?: number }[] }).steps;
  expect(steps.map((s) => s.type)).toEqual(["warmup", "repeat", "cooldown"]);
  expect(steps[1].count).toBe(3);

  await page.getByTestId("editor-saved").getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText(/Undone/)).toBeVisible();
  await expect.poll(() => sessionName(plannedId)).toBe("Tempo 2 x 15 min");
});

test("a new library workout is built and planned on the calendar", async ({ page }, testInfo) => {
  const { userId, cycleId } = await setup(testInfo.parallelIndex);
  await page.goto("/more/workouts");
  await page.getByRole("link", { name: "New workout" }).click();
  await page.getByLabel("Name").fill("Sweet spot block");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByTestId("add-sheet").getByRole("button", { name: "Sweet spot 3 x 12 min" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByTestId("save-sheet").getByRole("button", { name: "Save to the library" }).click();
  await expect(page.getByTestId("editor-saved")).toContainText("Saved as a new library workout.");
  await expect
    .poll(async () => (await testDb().select().from(workouts).where(and(eq(workouts.userId, userId), eq(workouts.name, "Sweet spot block"), isNull(workouts.deletedAt)))).length)
    .toBe(1);

  await page.goto("/more/calendar");
  const target = day();
  await page.getByTestId(`day-${target}`).click();
  await page.getByRole("button", { name: "Add session" }).click();
  await page.getByTestId("add-session").getByRole("button", { name: /Sweet spot block/ }).click();
  await expect(page.getByTestId("add-session")).toBeHidden();
  await expect
    .poll(async () => {
      const rows = await testDb()
        .select({ workout: plannedSessions.workout, workoutId: plannedSessions.workoutId })
        .from(plannedSessions)
        .where(and(eq(plannedSessions.cycleId, cycleId), eq(plannedSessions.date, target), isNull(plannedSessions.deletedAt)));
      return rows.map((r) => (r.workout as { name: string } | null)?.name);
    })
    .toContain("Sweet spot block");
});
