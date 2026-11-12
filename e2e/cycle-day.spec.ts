import { and, eq, isNull } from "drizzle-orm";
import { dismissedMakeups, programs, trainingCycleSlots, trainingCycles, users, workoutSessions } from "../src/db/schema";
import { e2eUser } from "./fixtures/env";
import { testDb } from "./fixtures/reset";
import { expect, test } from "./fixtures/test";
import { dismissReadinessSheet, trackActions } from "./helpers";

/**
 * Characterization spec for package C2 (docs/plans/sessions.md, 8.1, C12):
 * the home card, the missed list, Make up and Decline, and the rotation
 * overdue badge, as a lifter sees them today. It passes on main before the
 * session model changes. Its assertions must not change after it.
 *
 * Each test replaces the seeded cycle with one built around today's weekday,
 * and clears the seeded history, so the result does not depend on the day the
 * suite runs.
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

type Setup = { userId: string; progs: { id: number; name: string }[] };

/** Clear the seeded cycle and history; return the two seeded programs. */
async function setup(parallelIndex: number): Promise<Setup> {
  const db = testDb();
  const user = await db.query.users.findFirst({ where: eq(users.email, e2eUser(parallelIndex).email) });
  const userId = user!.id;
  await db.delete(workoutSessions).where(eq(workoutSessions.userId, userId));
  await db.update(trainingCycles).set({ status: "completed" }).where(eq(trainingCycles.userId, userId));
  // The server's today follows the user's zone; use the zone this spec computes dates in.
  await db
    .update(users)
    .set({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })
    .where(eq(users.id, userId));
  const progs = await db
    .select({ id: programs.id, name: programs.name })
    .from(programs)
    .where(and(eq(programs.userId, userId), isNull(programs.deletedAt)))
    .orderBy(programs.id);
  expect(progs.length).toBeGreaterThanOrEqual(2);
  return { userId, progs: progs.slice(0, 2) };
}

/** An active weekday cycle: today P0, yesterday P1, two days ago P0 again. */
async function weekdayCycle({ userId, progs }: Setup) {
  const db = testDb();
  const [cycle] = await db
    .insert(trainingCycles)
    .values({ userId, name: "C2 weekday", durationWeeks: 4, status: "active", startDate: dayStr(-3) })
    .returning();
  await db.insert(trainingCycleSlots).values([
    { trainingCycleId: cycle.id, dayOfWeek: dow(0), programId: progs[0].id },
    { trainingCycleId: cycle.id, dayOfWeek: dow(-1), programId: progs[1].id },
    { trainingCycleId: cycle.id, dayOfWeek: dow(-2), programId: progs[0].id },
  ]);
}

const missedRow = (page: import("@playwright/test").Page, name: string) =>
  page.locator("li").filter({ hasText: name }).filter({ has: page.getByRole("link", { name: "Make up" }) });

test("today's workout, the missed list, and a make-up that clears its day", async ({ page }, testInfo) => {
  const s = await setup(testInfo.parallelIndex);
  await weekdayCycle(s);

  await page.goto("/");
  await expect(page.getByText("C2 weekday")).toBeVisible();
  await expect(page.getByText(s.progs[0].name, { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Start Today's Workout" })).toHaveAttribute(
    "href",
    `/programs/${s.progs[0].id}/workout`,
  );
  await expect(page.getByText("Missed this week")).toBeVisible();
  await expect(missedRow(page, s.progs[1].name)).toBeVisible();
  await expect(missedRow(page, s.progs[0].name)).toBeVisible();
  await expect(page.getByRole("link", { name: "Make up" })).toHaveCount(2);

  // Make up yesterday's workout.
  const makeUp = missedRow(page, s.progs[1].name).getByRole("link", { name: "Make up" });
  await expect(makeUp).toHaveAttribute("href", `/programs/${s.progs[1].id}/workout?makeup=${dayStr(-1)}`);
  const settle = trackActions(page);
  await makeUp.click();
  await expect(page.locator('a[href*="/exercises/"]').first()).toBeVisible({ timeout: 10_000 });
  await dismissReadinessSheet(page);
  const first = page.getByTestId("exercise-row").first();
  const name = await first.getByRole("paragraph").first().innerText();
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

  const sessions = await testDb().select().from(workoutSessions).where(eq(workoutSessions.userId, s.userId));
  expect(sessions.map((r) => [r.programId, r.intendedDate, r.date, r.isCompleted])).toEqual([
    [s.progs[1].id, dayStr(-1), dayStr(0), true],
  ]);

  // Yesterday leaves the list; the day before stays. A make-up done today
  // also counts as today's workout.
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Make up" })).toHaveCount(1);
  await expect(missedRow(page, s.progs[0].name)).toBeVisible();
  await expect(page.getByText("Done", { exact: true })).toBeVisible();
});

test("Decline hides a missed day and records it", async ({ page }, testInfo) => {
  const s = await setup(testInfo.parallelIndex);
  await weekdayCycle(s);

  await page.goto("/");
  const row = missedRow(page, s.progs[0].name);
  await expect(row).toBeVisible();
  const settle = trackActions(page);
  await row.getByRole("button", { name: "Decline" }).click();
  await expect(row).toBeHidden();
  await settle();
  await expect(missedRow(page, s.progs[1].name)).toBeVisible();

  const rows = await testDb().select().from(dismissedMakeups).where(eq(dismissedMakeups.userId, s.userId));
  expect(rows.map((r) => r.date)).toEqual([dayStr(-2)]);

  await page.reload();
  await expect(page.getByRole("link", { name: "Make up" })).toHaveCount(1);
});

test("a rotation cycle waits on a missed slot and shows how overdue it is", async ({ page }, testInfo) => {
  const s = await setup(testInfo.parallelIndex);
  const db = testDb();
  const [cycle] = await db
    .insert(trainingCycles)
    .values({ userId: s.userId, name: "C2 rotation", durationWeeks: 4, status: "active", startDate: dayStr(-2), scheduleType: "rotation" })
    .returning();
  await db.insert(trainingCycleSlots).values([
    { trainingCycleId: cycle.id, orderIndex: 1, programId: s.progs[0].id },
    { trainingCycleId: cycle.id, orderIndex: 2, programId: s.progs[1].id },
  ]);

  await page.goto("/");
  await expect(page.getByText("C2 rotation")).toBeVisible();
  await expect(page.getByText("2 days overdue")).toBeVisible();
  await expect(page.getByRole("link", { name: "Start Today's Workout" })).toHaveAttribute(
    "href",
    `/programs/${s.progs[0].id}/workout`,
  );
  await expect(page.getByText("Missed this week")).toBeHidden();
});
