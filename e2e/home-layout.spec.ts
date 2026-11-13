import { and, eq, isNull } from "drizzle-orm";
import type { Page } from "@playwright/test";
import { plannedSessions, programs, trainingCycleSlots, trainingCycles, users, workoutSessions } from "../src/db/schema";
import type { StoredHomeLayout } from "../src/lib/home/stored-layout";
import { e2eUser } from "./fixtures/env";
import { testDb } from "./fixtures/reset";
import { expect, test } from "./fixtures/test";
import { dismissReadinessSheet, trackActions } from "./helpers";

/**
 * Editing the home screen (docs/home-widgets-audit.md, section 7, E1 to E4):
 * the layout persists, and every start entry stays reachable whatever the
 * layout. Each test builds its own cycle around today.
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

async function bareUser(parallelIndex: number) {
  const db = testDb();
  const user = await db.query.users.findFirst({ where: eq(users.email, e2eUser(parallelIndex).email) });
  const userId = user!.id;
  await db.delete(workoutSessions).where(eq(workoutSessions.userId, userId));
  await db.update(trainingCycles).set({ status: "completed" }).where(eq(trainingCycles.userId, userId));
  await db.update(users).set({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }).where(eq(users.id, userId));
  const progs = await db
    .select({ id: programs.id })
    .from(programs)
    .where(and(eq(programs.userId, userId), isNull(programs.deletedAt)))
    .orderBy(programs.id);
  return { userId, progId: progs[0].id };
}

/** A weekday cycle with a program today. */
async function lifter(parallelIndex: number) {
  const s = await bareUser(parallelIndex);
  const [cycle] = await testDb()
    .insert(trainingCycles)
    .values({ userId: s.userId, name: "Home edit", durationWeeks: 4, status: "active", startDate: dayStr(0) })
    .returning();
  await testDb().insert(trainingCycleSlots).values({ trainingCycleId: cycle.id, dayOfWeek: dow(0), programId: s.progId });
  return s;
}

const layoutOf = async (userId: string) =>
  (await testDb().select({ l: users.homeLayout }).from(users).where(eq(users.id, userId)))[0].l as StoredHomeLayout | null;

const editRows = (page: Page) => page.getByTestId("edit-row");

async function done(page: Page) {
  const settle = trackActions(page);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByTestId("home-edit-list")).toBeHidden();
  await settle();
}

test("E1: move, hide and resize persist; Today at S still starts; Reset restores the default", async ({ page }, testInfo) => {
  const { userId, progId } = await lifter(testInfo.parallelIndex);
  await page.goto("/");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByTestId("home-edit-list")).toBeVisible();

  await page.getByRole("button", { name: "Move Week up" }).click();
  await expect(editRows(page).nth(1)).toHaveAttribute("data-edit-row", "week");
  await page.getByRole("button", { name: "Hide Week" }).click();
  await page.getByLabel("Size of Today").selectOption("s");
  // Today holds the start buttons: it cannot be hidden.
  await expect(page.getByRole("button", { name: "Hide Today" })).toHaveCount(0);
  await done(page);

  await expect.poll(async () => (await layoutOf(userId))?.items.slice(0, 3)).toEqual([
    { id: "title", size: "m", hidden: false },
    { id: "week", size: "l", hidden: true },
    { id: "today", size: "s", hidden: false },
  ]);

  await page.reload();
  await expect(page.getByTestId("today-card")).toBeVisible();
  await expect(page.getByTestId("week-strip")).toHaveCount(0);
  const start = page.getByTestId("today-card").getByRole("link", { name: "Start Today's Workout" });
  await expect(start).toHaveAttribute("href", `/programs/${progId}/workout`);
  await start.click();
  await expect(page).toHaveURL(new RegExp(`/programs/${progId}/workout`));
  await expect(page.locator('a[href*="/exercises/"]').first()).toBeVisible({ timeout: 10_000 });
  await dismissReadinessSheet(page);

  await page.goto("/");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  page.once("dialog", (d) => void d.accept());
  const settle = trackActions(page);
  await page.getByRole("button", { name: "Reset" }).click();
  await expect(page.getByTestId("home-edit-list")).toBeHidden();
  await settle();
  await expect.poll(() => layoutOf(userId)).toBeNull();
  await page.reload();
  await expect(page.getByTestId("week-strip")).toBeVisible();
});

test("E2: without a cycle the pinned start bar stays after a layout change", async ({ page }, testInfo) => {
  const { userId } = await bareUser(testInfo.parallelIndex);
  await page.goto("/");
  await expect(page.getByTestId("start-bar")).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByTestId("start-bar")).toHaveCount(0);
  await page.getByLabel("Size of Today").selectOption("m");
  await page.getByRole("button", { name: "Hide Week" }).click();
  await done(page);
  await expect.poll(async () => (await layoutOf(userId)) !== null).toBe(true);

  await page.reload();
  await expect(page.getByTestId("start-bar")).toBeInViewport();
  await expect(page.getByTestId("start-bar").getByRole("link", { name: "Start a Workout" })).toHaveAttribute("href", "/new-workout");
});

test("E3: Endurance today below Week still starts the guided player", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request: async () => ({ release: async () => undefined }) } });
  });
  const { userId } = await bareUser(testInfo.parallelIndex);
  const db = testDb();
  await db.update(users).set({ enduranceEnabled: true }).where(eq(users.id, userId));
  const [cycle] = await db
    .insert(trainingCycles)
    .values({ userId, name: "Run block", durationWeeks: 4, status: "active", startDate: dayStr(0), sessionsGeneratedAt: new Date() })
    .returning();
  const workout = { v: 1, sport: "run", name: "Tempo", steps: [{ type: "work", end: { type: "time", seconds: 600 } }] };
  const [row] = await db.insert(plannedSessions).values({ userId, cycleId: cycle.id, date: dayStr(0), label: "Tempo", workout }).returning({ id: plannedSessions.id });

  await page.goto("/");
  await expect(page.getByTestId("endurance-today")).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("button", { name: "Move Endurance today down" }).click();
  await expect(page.getByRole("button", { name: "Hide Endurance today" })).toHaveCount(0);
  await done(page);

  await page.reload();
  const order = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("[data-testid]"))
      .map((el) => el.dataset.testid)
      .filter((id) => id === "week-strip" || id === "endurance-today"),
  );
  expect(order).toEqual(["week-strip", "endurance-today"]);
  const go = page.getByTestId("endurance-today").getByRole("link", { name: "Start guided" });
  await expect(go).toHaveAttribute("href", `/planned/${row.id}/play`);
  await go.click();
  await expect(page).toHaveURL(new RegExp(`/planned/${row.id}/play`));
});

test("E4: offline, Done keeps the draft and says so; back online it saves", async ({ page, context }, testInfo) => {
  const { userId } = await lifter(testInfo.parallelIndex);
  await page.goto("/");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("button", { name: "Move Week up" }).click();

  await context.setOffline(true);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByTestId("home-save-error")).toHaveText("You're offline. Try again when connected.");
  await expect(editRows(page).nth(1)).toHaveAttribute("data-edit-row", "week");
  expect(await layoutOf(userId)).toBeNull();

  await context.setOffline(false);
  await done(page);
  await expect.poll(async () => (await layoutOf(userId))?.items.slice(1, 3).map((i) => i.id)).toEqual(["week", "today"]);
});
