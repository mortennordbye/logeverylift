import { and, eq, isNull } from "drizzle-orm";
import type { Page } from "@playwright/test";
import { plannedSessions, programs, trainingCycleSlots, trainingCycles, users, workoutSessions } from "../src/db/schema";
import { e2eUser } from "./fixtures/env";
import { testDb } from "./fixtures/reset";
import { expect, test } from "./fixtures/test";

/**
 * Characterization spec for the home widgets build (docs/home-widgets-audit.md,
 * 6.2, T1): the order of the parts of the home screen for each user type, as
 * the page renders them before the widget system. It was written and run
 * green against the old page. It must pass unchanged after the rewrite: a
 * user who never edits their home sees the same parts in the same order.
 *
 * It checks order, not that every part is in view: the old home clipped
 * content past the screen, the new one scrolls.
 */

/** Every part the order is checked over, by its data-testid. */
const PARTS = [
  "home-title",
  "today-card",
  "cycle-setup",
  "endurance-today",
  "did-you-do-it",
  "missed-key",
  "missed-week",
  "week-strip",
  "rotation-strip",
  "start-bar",
];

/** The parts on the page, in document order. */
async function order(page: Page): Promise<string[]> {
  return page.evaluate(
    (ids) =>
      Array.from(document.querySelectorAll<HTMLElement>("[data-testid]"))
        .map((el) => el.dataset.testid ?? "")
        .filter((id) => ids.includes(id)),
    PARTS,
  );
}

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

/** The worker's user with no history and no live cycle; returns two seeded programs. */
async function bareUser(parallelIndex: number) {
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

test("lifter, weekday cycle with a missed day", async ({ page }, testInfo) => {
  const { userId, progs } = await bareUser(testInfo.parallelIndex);
  const db = testDb();
  const [cycle] = await db
    .insert(trainingCycles)
    .values({ userId, name: "Home weekday", durationWeeks: 4, status: "active", startDate: dayStr(-3) })
    .returning();
  await db.insert(trainingCycleSlots).values([
    { trainingCycleId: cycle.id, dayOfWeek: dow(0), programId: progs[0].id },
    { trainingCycleId: cycle.id, dayOfWeek: dow(-1), programId: progs[1].id },
    { trainingCycleId: cycle.id, dayOfWeek: dow(-2), programId: progs[0].id },
  ]);

  await page.goto("/");
  await expect(page.getByTestId("missed-week")).toBeVisible();
  await expect(page.getByRole("link", { name: "Start Today's Workout" })).toBeVisible();
  expect(await order(page)).toEqual(["home-title", "today-card", "missed-week", "week-strip"]);
});

test("lifter, rotation cycle", async ({ page }, testInfo) => {
  const { userId, progs } = await bareUser(testInfo.parallelIndex);
  const db = testDb();
  const [cycle] = await db
    .insert(trainingCycles)
    .values({ userId, name: "Home rotation", durationWeeks: 4, status: "active", startDate: dayStr(0), scheduleType: "rotation" })
    .returning();
  await db.insert(trainingCycleSlots).values([
    { trainingCycleId: cycle.id, orderIndex: 1, programId: progs[0].id },
    { trainingCycleId: cycle.id, orderIndex: 2, programId: progs[1].id },
  ]);

  await page.goto("/");
  await expect(page.getByTestId("rotation-strip")).toBeVisible();
  await expect(page.getByRole("link", { name: "Start Today's Workout" })).toBeVisible();
  expect(await order(page)).toEqual(["home-title", "today-card", "rotation-strip"]);
});

test("no cycle: the setup prompt, the week, and the pinned start bar", async ({ page }, testInfo) => {
  await bareUser(testInfo.parallelIndex);

  await page.goto("/");
  await expect(page.getByTestId("cycle-setup")).toBeVisible();
  // A part React has not placed yet sits in a hidden container at the end of
  // the document, so wait for it before reading the order.
  await expect(page.getByTestId("week-strip")).toBeVisible();
  // Pinned above the nav: in view without scrolling.
  await expect(page.getByTestId("start-bar")).toBeInViewport();
  await expect(page.getByTestId("start-bar").getByRole("link", { name: "Start a Workout" })).toHaveAttribute("href", "/new-workout");
  expect(await order(page)).toEqual(["home-title", "cycle-setup", "week-strip", "start-bar"]);
});

test("endurance, weekday cycle with a session today and one to confirm", async ({ page }, testInfo) => {
  const { userId } = await bareUser(testInfo.parallelIndex);
  const db = testDb();
  await db.update(users).set({ enduranceEnabled: true }).where(eq(users.id, userId));
  const [cycle] = await db
    .insert(trainingCycles)
    .values({ userId, name: "Home run block", durationWeeks: 4, status: "active", startDate: dayStr(-7), sessionsGeneratedAt: new Date() })
    .returning();
  const run = (name: string, minutes: number) => ({
    v: 1,
    sport: "run",
    name,
    steps: [{ type: "work", end: { type: "time", seconds: minutes * 60 } }],
  });
  await db.insert(plannedSessions).values([
    { userId, cycleId: cycle.id, date: dayStr(0), label: "Tempo run", workout: run("Tempo run", 40) },
    { userId, cycleId: cycle.id, date: dayStr(-1), label: "Easy run", workout: run("Easy run", 30) },
  ]);

  await page.goto("/");
  await expect(page.getByTestId("endurance-today")).toBeVisible();
  await expect(page.getByTestId("did-you-do-it")).toBeVisible();
  expect(await order(page)).toEqual(["home-title", "today-card", "endurance-today", "did-you-do-it", "week-strip"]);
});
