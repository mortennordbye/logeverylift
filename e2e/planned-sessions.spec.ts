import { and, asc, eq, isNull } from "drizzle-orm";
import { planRevisions, plannedSessions, programs, trainingCycleSlots, trainingCycles, users, workoutSessions } from "../src/db/schema";
import { e2eUser } from "./fixtures/env";
import { testDb } from "./fixtures/reset";
import { expect, test } from "./fixtures/test";
import { dismissReadinessSheet, trackActions } from "./helpers";

/**
 * Dated sessions in the app (docs/plans/sessions.md, 8.2): two sessions on
 * one day, each started and logged on its own, and a session moved and one
 * skipped from the calendar. Each test builds a cycle around today, so the
 * result does not depend on the day the suite runs.
 */

const pad = (n: number) => String(n).padStart(2, "0");
function dayStr(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function dow(offset: number): number {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.getDay() === 0 ? 7 : d.getDay();
}

/** Clear the seeded cycle and history; a cycle with two sessions today. */
async function twoToday(parallelIndex: number) {
  const db = testDb();
  const user = await db.query.users.findFirst({ where: eq(users.email, e2eUser(parallelIndex).email) });
  const userId = user!.id;
  await db.delete(workoutSessions).where(eq(workoutSessions.userId, userId));
  await db.update(trainingCycles).set({ status: "completed" }).where(eq(trainingCycles.userId, userId));
  await db.update(users).set({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }).where(eq(users.id, userId));
  const progs = await db
    .select({ id: programs.id, name: programs.name })
    .from(programs)
    .where(and(eq(programs.userId, userId), isNull(programs.deletedAt)))
    .orderBy(programs.id);
  const [cycle] = await db
    .insert(trainingCycles)
    .values({ userId, name: "Two a day", durationWeeks: 4, status: "active", startDate: dayStr(-3) })
    .returning();
  await db.insert(trainingCycleSlots).values([
    { trainingCycleId: cycle.id, dayOfWeek: dow(0), daySlot: 1, programId: progs[0].id },
    { trainingCycleId: cycle.id, dayOfWeek: dow(0), daySlot: 2, programId: progs[1].id },
  ]);
  return { userId, cycleId: cycle.id, first: progs[0], second: progs[1] };
}

const todayRows = (cycleId: number) =>
  testDb()
    .select()
    .from(plannedSessions)
    .where(and(eq(plannedSessions.cycleId, cycleId), eq(plannedSessions.date, dayStr(0)), isNull(plannedSessions.deletedAt)))
    .orderBy(asc(plannedSessions.position));

test("two sessions today: each starts and logs on its own", async ({ page }, testInfo) => {
  const s = await twoToday(testInfo.parallelIndex);

  await page.goto("/");
  await expect(page.getByText("2 sessions today")).toBeVisible();
  await expect(page.getByTestId("today-session")).toHaveCount(2);
  const [firstRow] = await todayRows(s.cycleId);
  const start = page.getByRole("link", { name: `Start ${s.first.name}` });
  await expect(start).toHaveAttribute("href", `/programs/${s.first.id}/workout?planned=${firstRow.id}`);

  const settle = trackActions(page);
  await start.click();
  await expect(page.locator('a[href*="/exercises/"]').first()).toBeVisible({ timeout: 10_000 });
  await dismissReadinessSheet(page);
  const exercise = page.getByTestId("exercise-row").first();
  const name = await exercise.getByRole("paragraph").first().innerText();
  await page.getByRole("button", { name: `Mark ${name} as done`, exact: true }).click();
  await expect(page.getByRole("button", { name: `Mark ${name} as not done`, exact: true })).toBeVisible();
  await settle();
  await page.getByRole("button", { name: "Finished", exact: true }).click();
  await page.getByRole("button", { name: "Yes, finish", exact: true }).click();
  await expect(page).toHaveURL(/\/workout\/finish/);
  await page.getByRole("button", { name: "Save Workout" }).click();
  await page.getByRole("button", { name: "Yes, save", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await settle();

  const logged = await testDb().select().from(workoutSessions).where(eq(workoutSessions.userId, s.userId));
  expect(logged.map((w) => [w.programId, w.plannedSessionId, w.isCompleted])).toEqual([[s.first.id, firstRow.id, true]]);

  await page.goto("/");
  await expect(page.getByRole("link", { name: `Do again ${s.first.name}` })).toBeVisible();
  await expect(page.getByRole("link", { name: `Start ${s.second.name}` })).toBeVisible();
});

test("move one session and skip the other from the calendar", async ({ page }, testInfo) => {
  const s = await twoToday(testInfo.parallelIndex);
  // The first read makes the dated sessions.
  await page.goto("/");
  await expect(page.getByText("2 sessions today")).toBeVisible();
  const [first, second] = await todayRows(s.cycleId);

  await page.goto("/more/calendar");
  await page.getByTestId(`day-${dayStr(0)}`).click();
  await expect(page.getByTestId("planned-session")).toHaveCount(2);

  const settle = trackActions(page);
  await page.getByRole("button", { name: `Move ${s.first.name}` }).click();
  await page.getByLabel(`New day for ${s.first.name}`).fill(dayStr(2));
  await page.getByRole("button", { name: "Save" }).click();
  await settle();
  await expect.poll(async () => (await testDb().select().from(plannedSessions).where(eq(plannedSessions.id, first.id)))[0].date).toBe(dayStr(2));

  await page.getByRole("button", { name: `Skip ${s.second.name}` }).click();
  await settle();
  await expect.poll(async () => (await testDb().select().from(plannedSessions).where(eq(plannedSessions.id, second.id)))[0].status).toBe("skipped");

  const revs = await testDb()
    .select({ objectId: planRevisions.objectId, action: planRevisions.action, writer: planRevisions.writer })
    .from(planRevisions)
    .where(and(eq(planRevisions.userId, s.userId), eq(planRevisions.objectType, "planned_session")))
    .orderBy(asc(planRevisions.id));
  expect(revs.filter((r) => r.action === "update")).toEqual([
    { objectId: first.id, action: "update", writer: "user" },
    { objectId: second.id, action: "update", writer: "user" },
  ]);

  // The moved one is gone from today; the skipped one is still today's
  // program on the card, as "I skipped it" leaves it (review 1).
  await page.goto("/");
  await expect(page.getByText("2 sessions today")).toBeHidden();
  await expect(page.getByRole("link", { name: "Start Today's Workout" })).toHaveAttribute("href", `/programs/${s.second.id}/workout`);
});
