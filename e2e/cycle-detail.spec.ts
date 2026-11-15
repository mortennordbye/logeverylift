import { and, asc, eq, isNull } from "drizzle-orm";
import { planRevisions, plannedSessions, programs, trainingCycleSlots, trainingCycles, users, workoutSessions } from "../src/db/schema";
import { e2eUser } from "./fixtures/env";
import { testDb } from "./fixtures/reset";
import { expect, test } from "./fixtures/test";
import { trackActions } from "./helpers";

/**
 * The cycle detail (docs/plans/plan-tab-redesign.md, P2): open a dated
 * session from its week and move it to another day, then skip it. The cycle
 * starts today, so the result does not depend on the day the suite runs.
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
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Mon 16 Nov", as the app writes a day. */
function label(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Clear the seeded cycles and history; a two-week cycle from today with one session tomorrow. */
async function cycleFromToday(parallelIndex: number) {
  const db = testDb();
  const user = await db.query.users.findFirst({ where: eq(users.email, e2eUser(parallelIndex).email) });
  const userId = user!.id;
  await db.delete(workoutSessions).where(eq(workoutSessions.userId, userId));
  await db.update(trainingCycles).set({ status: "completed" }).where(eq(trainingCycles.userId, userId));
  await db.update(users).set({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }).where(eq(users.id, userId));
  const [program] = await db
    .select({ id: programs.id, name: programs.name })
    .from(programs)
    .where(and(eq(programs.userId, userId), isNull(programs.deletedAt)))
    .orderBy(programs.id)
    .limit(1);
  const [cycle] = await db
    .insert(trainingCycles)
    .values({ userId, name: "Detail block", durationWeeks: 2, status: "active", startDate: dayStr(0) })
    .returning();
  await db.insert(trainingCycleSlots).values({ trainingCycleId: cycle.id, dayOfWeek: dow(1), programId: program.id });
  return { userId, cycleId: cycle.id, program };
}

const sessionsOf = (cycleId: number) =>
  testDb()
    .select()
    .from(plannedSessions)
    .where(and(eq(plannedSessions.cycleId, cycleId), isNull(plannedSessions.deletedAt)))
    .orderBy(asc(plannedSessions.date));

test("open a dated session on the cycle detail, move it to another day, then skip it", async ({ page }, testInfo) => {
  const s = await cycleFromToday(testInfo.parallelIndex);

  await page.goto(`/cycles/${s.cycleId}`);
  await expect(page.getByText("Week 1 of 2")).toBeVisible();
  const [tomorrow] = await sessionsOf(s.cycleId);
  expect(tomorrow.date).toBe(dayStr(1));

  const settle = trackActions(page);
  await page.getByRole("button", { name: new RegExp(`^${label(dayStr(1))}: ${esc(s.program.name)}`) }).click();
  const sheet = page.getByTestId("session-sheet");
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: "Move to another day" }).click();
  // Today's chip is open; a day in the past is not.
  await expect(sheet.getByRole("button", { name: label(dayStr(0)) })).toBeEnabled();
  await sheet.getByRole("button", { name: label(dayStr(3)) }).click();
  await sheet.getByRole("button", { name: `Move to ${label(dayStr(3))}` }).click();
  await settle();
  await expect(sheet).toBeHidden();
  await expect.poll(async () => (await testDb().select().from(plannedSessions).where(eq(plannedSessions.id, tomorrow.id)))[0].date).toBe(dayStr(3));

  // The week shows it on its new day.
  const moved = page.getByRole("button", { name: new RegExp(`^${label(dayStr(3))}: ${esc(s.program.name)}`) });
  await expect(moved).toBeVisible();
  // A muted mark says where it came from, and the day it left says where it went.
  await expect(moved).toContainText(`Moved from ${label(dayStr(1)).slice(0, 3)}`);
  await expect(page.getByTestId("week-row").filter({ hasText: `Moved to ${label(dayStr(3)).slice(0, 3)}` })).toBeVisible();
  await moved.click();
  await expect(sheet.getByRole("button", { name: /Back to the template/ })).toBeVisible();
  await sheet.getByRole("button", { name: "Skip this session" }).click();
  await settle();
  await expect.poll(async () => (await testDb().select().from(plannedSessions).where(eq(plannedSessions.id, tomorrow.id)))[0].status).toBe("skipped");
  await expect(page.getByRole("button", { name: new RegExp(`^${label(dayStr(3))}: ${esc(s.program.name)}, Skipped`) })).toBeVisible();

  const revs = await testDb()
    .select({ action: planRevisions.action, writer: planRevisions.writer })
    .from(planRevisions)
    .where(and(eq(planRevisions.userId, s.userId), eq(planRevisions.objectType, "planned_session"), eq(planRevisions.objectId, tomorrow.id)))
    .orderBy(asc(planRevisions.id));
  expect(revs.filter((r) => r.action === "update")).toEqual([
    { action: "update", writer: "user" },
    { action: "update", writer: "user" },
  ]);
});
