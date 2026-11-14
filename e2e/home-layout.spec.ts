import { and, eq, isNull } from "drizzle-orm";
import type { Page } from "@playwright/test";
import { plannedSessions, programs, trainingCycleSlots, trainingCycles, users, workoutSessions } from "../src/db/schema";
import type { StoredHomeLayout } from "../src/lib/home/stored-layout";
import { e2eUser } from "./fixtures/env";
import { testDb } from "./fixtures/reset";
import { expect, test } from "./fixtures/test";

// Edit mode jiggles the widgets, and Playwright waits for an element to stop
// moving before it clicks. The jiggle has its own test, with motion on.
test.use({ contextOptions: { reducedMotion: "reduce" } });
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

const grid = (page: Page) => page.getByTestId("home-edit-grid");
const tile = (page: Page, id: string) => page.locator(`[data-edit-tile="${id}"] [data-control="tile"]`);
const sheet = (page: Page) => page.getByTestId("widget-sheet");
/** The widgets in the edit grid, in order. */
const tiles = (page: Page) =>
  page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>("[data-edit-tile]")).map((el) => el.dataset.editTile));

/** Tap a widget in the edit grid, press a button in its sheet, close the sheet. */
async function inSheet(page: Page, id: string, button: string) {
  await tile(page, id).click();
  await sheet(page).getByRole("button", { name: button, exact: true }).click();
  await sheet(page).getByRole("button", { name: "Close" }).click();
  await expect(sheet(page)).toBeHidden();
}

async function done(page: Page) {
  const settle = trackActions(page);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(grid(page)).toBeHidden();
  await settle();
}

test("E1: move, hide and resize persist; Today at S still starts; Reset restores the default", async ({ page }, testInfo) => {
  const { userId, progId } = await lifter(testInfo.parallelIndex);
  await page.goto("/");
  await page.getByRole("button", { name: "Edit home" }).click();
  await expect(grid(page)).toBeVisible();
  // The edit bar lies over the bottom nav: a tap there cannot leave and drop the draft.
  const navCovered = await page.evaluate(() => {
    const bar = document.querySelector("[data-testid=home-edit-bar]")!.getBoundingClientRect();
    return !!document.elementFromPoint(window.innerWidth / 4, bar.top + bar.height / 2)?.closest("[data-testid=home-edit-bar]");
  });
  expect(navCovered).toBe(true);

  await inSheet(page, "week", "Move up");
  await expect.poll(() => tiles(page)).toEqual(["title", "week", "today"]);
  await page.getByRole("button", { name: "Hide Week" }).click();
  await inSheet(page, "today", "Small");
  // Today holds the start buttons: it cannot be hidden.
  await expect(page.getByRole("button", { name: "Hide Today" })).toHaveCount(0);
  await tile(page, "today").click();
  await expect(sheet(page).getByRole("button", { name: "Hide" })).toHaveCount(0);
  await sheet(page).getByRole("button", { name: "Close" }).click();
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
  await page.getByRole("button", { name: "Edit home" }).click();
  page.once("dialog", (d) => void d.accept());
  const settle = trackActions(page);
  await page.getByRole("button", { name: "Reset" }).click();
  await expect(grid(page)).toBeHidden();
  await settle();
  await expect.poll(() => layoutOf(userId)).toBeNull();
  await page.reload();
  await expect(page.getByTestId("week-strip")).toBeVisible();
});

test("E2: without a cycle the pinned start bar stays after a layout change", async ({ page }, testInfo) => {
  const { userId } = await bareUser(testInfo.parallelIndex);
  await page.goto("/");
  await expect(page.getByTestId("start-bar")).toBeVisible();
  await page.getByRole("button", { name: "Edit home" }).click();
  await expect(page.getByTestId("start-bar")).toHaveCount(0);
  await inSheet(page, "today", "Medium");
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
  await page.getByRole("button", { name: "Edit home" }).click();
  await inSheet(page, "enduranceToday", "Move down");
  await expect(page.getByRole("button", { name: "Hide Endurance today" })).toHaveCount(0);
  await done(page);

  await page.reload();
  // React reveals streamed parts in batches after the load event; until then
  // they sit in hidden containers in the order they finished, not page order.
  await expect(page.getByTestId("endurance-today")).toBeVisible();
  await expect(page.getByTestId("week-strip")).toBeVisible();
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
  await page.getByRole("button", { name: "Edit home" }).click();
  await inSheet(page, "week", "Move up");

  await context.setOffline(true);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByTestId("home-save-error")).toHaveText("You're offline. Try again when connected.");
  expect(await tiles(page)).toEqual(["title", "week", "today"]);
  expect(await layoutOf(userId)).toBeNull();

  await context.setOffline(false);
  await done(page);
  await expect.poll(async () => (await layoutOf(userId))?.items.slice(1, 3).map((i) => i.id)).toEqual(["week", "today"]);
});

test("the Edit home pencil sits in the title row; with the title hidden it moves to the end of the list", async ({ page }, testInfo) => {
  const { userId } = await lifter(testInfo.parallelIndex);
  await page.goto("/");
  const pencil = page.getByRole("button", { name: "Edit home" });
  await expect(pencil).toHaveCount(1);
  await expect(pencil).toBeInViewport();
  await expect(page.getByTestId("home-content").getByRole("button", { name: "Edit home" })).toHaveCount(0);

  await pencil.click();
  await page.getByRole("button", { name: "Hide Title" }).click();
  await done(page);
  await expect.poll(async () => (await layoutOf(userId))?.items.find((i) => i.id === "title")?.hidden).toBe(true);

  await page.reload();
  // The heading stays for screen readers; the pencil is now the last thing in the list.
  await expect(page.getByRole("heading", { name: "LogEveryLift" })).toBeAttached();
  const atEnd = page.getByTestId("home-content").getByRole("button", { name: "Edit home" });
  await expect(atEnd).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Edit home" })).toHaveCount(1);
  await atEnd.click();
  await expect(grid(page)).toBeVisible();
});

test("a long press on a widget enters edit mode; its release opens nothing", async ({ page }, testInfo) => {
  await lifter(testInfo.parallelIndex);
  await page.goto("/");
  const week = page.getByTestId("week-strip");
  await expect(week).toBeVisible();
  // Today with its plan can push Week below a short screen: press inside it.
  await week.evaluate((el) => el.scrollIntoView({ block: "center" }));
  const box = (await week.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // Held, not moved: edit mode comes on its own after about half a second.
  await expect(grid(page)).toBeVisible();
  await page.mouse.up();
  await expect(sheet(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
});

test("drag a widget in the grid; the order persists after a reload", async ({ page }, testInfo) => {
  const { userId } = await lifter(testInfo.parallelIndex);
  // dnd-kit swallows every click for 50 ms after a drop (the one the release
  // makes). The clock lets the test step past that instead of waiting.
  await page.clock.install();
  await page.goto("/");
  await page.getByRole("button", { name: "Edit home" }).click();
  await expect.poll(() => tiles(page)).toEqual(["title", "today", "week"]);

  // Today is taller than a short screen's room above Week: bring the seam
  // between them to the middle, so both are under the pointer.
  await tile(page, "week").evaluate((el) => el.scrollIntoView({ block: "center" }));
  const from = (await tile(page, "week").boundingBox())!;
  const to = (await tile(page, "today").boundingBox())!;
  // Press near Week's top edge: on a short screen the rest of it is below the fold.
  await page.mouse.move(from.x + from.width / 2, from.y + 40);
  await page.mouse.down();
  // Past the 8 px activation distance, then onto Today's lower part, in steps.
  await page.mouse.move(from.x + from.width / 2, from.y + 20, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height - 40, { steps: 15 });
  await expect.poll(() => tiles(page)).toEqual(["title", "week", "today"]);
  await page.mouse.up();
  await page.clock.runFor(100);
  await expect(sheet(page)).toHaveCount(0);
  expect(await tiles(page)).toEqual(["title", "week", "today"]);
  await done(page);
  await expect.poll(async () => (await layoutOf(userId))?.items.slice(0, 3).map((i) => i.id)).toEqual(["title", "week", "today"]);

  await page.reload();
  await expect(page.getByTestId("today-card")).toBeVisible();
  await expect(page.getByTestId("week-strip")).toBeVisible();
  const order = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("[data-testid]"))
      .map((el) => el.dataset.testid)
      .filter((id) => id === "week-strip" || id === "today-card"),
  );
  expect(order).toEqual(["week-strip", "today-card"]);
});

test("widgets jiggle in edit mode, and not with reduced motion", async ({ page }, testInfo) => {
  await lifter(testInfo.parallelIndex);
  const jiggle = () => page.locator('[data-edit-tile="week"] .home-jiggle').evaluate((el) => getComputedStyle(el).animationName);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await page.getByRole("button", { name: "Edit home" }).click();
  expect(await jiggle()).toBe("home-jiggle");
  // As the locked design: one swing each way per 0.28 s, alternating.
  const timing = await page
    .locator('[data-edit-tile="week"] .home-jiggle')
    .evaluate((el) => [getComputedStyle(el).animationDuration, getComputedStyle(el).animationDirection]);
  expect(timing[0]).toBe("0.28s");
  expect(["alternate", "alternate-reverse"]).toContain(timing[1]);
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Edit home" }).click();
  expect(await jiggle()).toBe("none");
});

/**
 * Touch, the way a phone does it: CDP Input.dispatchTouchEvent sends real touch
 * input, which Chromium turns into pointer events and, for a swipe, a scroll.
 * Playwright's WebKit only offers touchscreen.tap (no hold, no move), so these
 * run on Chromium only.
 */
async function touchscreen(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type: "touchStart" | "touchMove" | "touchEnd", x = 0, y = 0) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: Math.round(x), y: Math.round(y) }] });
  return {
    start: (x: number, y: number) => send("touchStart", x, y),
    /** Move in steps from (x0, y0) to (x1, y1), as a finger does. */
    async move(x0: number, y0: number, x1: number, y1: number, steps = 10) {
      for (let n = 1; n <= steps; n++) await send("touchMove", x0 + ((x1 - x0) * n) / steps, y0 + ((y1 - y0) * n) / steps);
    },
    end: () => send("touchEnd"),
  };
}

/** Every widget a lifter can have, visible, so the home is taller than the screen. */
async function tallHome(userId: string) {
  const items = [
    { id: "title", size: "m", hidden: false },
    { id: "today", size: "l", hidden: false },
    { id: "cycle", size: "m", hidden: false },
    { id: "weeklyGoal", size: "m", hidden: false },
    { id: "recentPrs", size: "l", hidden: false },
    { id: "friendsActivity", size: "l", hidden: false },
    { id: "week", size: "l", hidden: false },
  ] as const;
  await testDb()
    .update(users)
    .set({ homeLayout: { v: 1, updatedAt: new Date().toISOString(), items: [...items] } })
    .where(eq(users.id, userId));
}

test("touch: a swipe on a widget scrolls and does not enter edit mode; a hold does", async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== "chromium", "Touch hold and move need CDP; Playwright's WebKit has only touchscreen.tap");
  const { userId } = await lifter(testInfo.parallelIndex);
  await tallHome(userId);
  // The long-press timer runs on this clock, so "held long enough" and "not
  // held long enough" are exact, not waits.
  await page.clock.install();
  await page.goto("/");
  const content = page.getByTestId("home-content");
  const scrollTop = () => content.evaluate((el) => el.scrollTop);
  await expect.poll(() => content.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  const finger = await touchscreen(page);

  const today = (await page.getByTestId("today-card").boundingBox())!;
  const x = today.x + today.width / 2;
  const y = today.y + today.height / 2;
  await finger.start(x, y);
  await finger.move(x, y, x, y - 250);
  await finger.end();
  await expect.poll(scrollTop).toBeGreaterThan(0);
  await page.clock.runFor(1000);
  await expect(grid(page)).toHaveCount(0);

  const widget = page.locator("[data-widget]").filter({ has: page.getByTestId("week-strip") });
  await widget.scrollIntoViewIfNeeded();
  const box = (await widget.boundingBox())!;
  await finger.start(box.x + box.width / 2, box.y + 30);
  await page.clock.runFor(600);
  await expect(grid(page)).toBeVisible();
  await finger.end();
  await expect(sheet(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
});

test("touch: hold a widget in the edit grid, then drag it; the order persists", async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== "chromium", "Touch hold and move need CDP; Playwright's WebKit has only touchscreen.tap");
  const { userId } = await lifter(testInfo.parallelIndex);
  await page.clock.install();
  await page.goto("/");
  await page.getByRole("button", { name: "Edit home" }).click();
  await expect.poll(() => tiles(page)).toEqual(["title", "today", "week"]);
  const finger = await touchscreen(page);

  // As in the mouse drag: bring the seam between Today and Week to the middle.
  await tile(page, "week").evaluate((el) => el.scrollIntoView({ block: "center" }));
  const from = (await tile(page, "week").boundingBox())!;
  const to = (await tile(page, "today").boundingBox())!;
  const x = from.x + from.width / 2;
  await finger.start(x, from.y + 40);
  // dnd-kit's TouchSensor picks the widget up after a 180 ms hold.
  await page.clock.runFor(250);
  await finger.move(x, from.y + 40, to.x + to.width / 2, to.y + to.height - 40, 15);
  await expect.poll(() => tiles(page)).toEqual(["title", "week", "today"]);
  await finger.end();
  await page.clock.runFor(100);
  await expect(sheet(page)).toHaveCount(0);
  await done(page);
  await expect.poll(async () => (await layoutOf(userId))?.items.slice(0, 3).map((i) => i.id)).toEqual(["title", "week", "today"]);
});

test("keyboard: Space picks a widget up, ArrowUp moves it, Space drops it, and it is announced", async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== "chromium", "Keyboard reorder runs on Chromium (desktop and Android keyboards); the iPhone has no Space key");
  const { userId } = await lifter(testInfo.parallelIndex);
  await page.goto("/");
  await page.getByRole("button", { name: "Edit home" }).click();
  await expect.poll(() => tiles(page)).toEqual(["title", "today", "week"]);

  await tile(page, "week").focus();
  await page.keyboard.press("Space");
  // dnd-kit's KeyboardSensor starts listening for the arrow keys in a
  // setTimeout(0) after the pick-up. A timer queued now runs after it.
  await page.evaluate(() => new Promise((r) => setTimeout(r)));
  // dnd-kit's own live region; the pick-up is followed at once by where it is.
  const live = page.locator('[id^="DndLiveRegion-"]');
  await expect(live).toHaveText("Week is at position 2 of 2.");
  await page.keyboard.press("ArrowUp");
  await expect.poll(() => tiles(page)).toEqual(["title", "week", "today"]);
  await expect(live).toHaveText("Week is at position 1 of 2.");
  await page.keyboard.press("Space");
  await expect(live).toHaveText("Week moved to position 1 of 2.");
  await expect(tile(page, "week")).toBeFocused();
  await done(page);
  await expect.poll(async () => (await layoutOf(userId))?.items.slice(0, 3).map((i) => i.id)).toEqual(["title", "week", "today"]);
});
