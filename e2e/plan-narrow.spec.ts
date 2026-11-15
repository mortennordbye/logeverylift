import type { Locator, Page } from "@playwright/test";
import { and, eq, isNull } from "drizzle-orm";
import { programs, seasons, trainingCycleSlots, trainingCycles, users } from "../src/db/schema";
import { e2eUser } from "./fixtures/env";
import { testDb } from "./fixtures/reset";
import { expect, test } from "./fixtures/test";

/**
 * The Plan screens on a 320 x 568 phone (round 6 capture): a date never
 * breaks over two lines, the hero label breaks only between its parts, and a
 * session sheet scrolls as a whole with every action reachable, no list
 * scrolling inside it with a row cut in half.
 */

test.use({ viewport: { width: 320, height: 568 } });

const pad = (n: number) => String(n).padStart(2, "0");
function dayStr(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const dow = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.getDay() === 0 ? 7 : d.getDay();
};

/** An endurance account with a running weekday cycle that has a session today, as phase 1 of a season. */
async function plan(parallelIndex: number) {
  const db = testDb();
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, e2eUser(parallelIndex).email));
  const userId = user.id;
  await db
    .update(users)
    .set({ enduranceEnabled: true, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })
    .where(eq(users.id, userId));
  await db.update(trainingCycles).set({ status: "completed" }).where(eq(trainingCycles.userId, userId));
  const [program] = await db
    .select({ id: programs.id, name: programs.name })
    .from(programs)
    .where(and(eq(programs.userId, userId), isNull(programs.deletedAt)))
    .orderBy(programs.id)
    .limit(1);
  const [season] = await db
    .insert(seasons)
    .values({ userId, name: "Jevnaker Half 2027", startDate: dayStr(0), endDate: dayStr(0 + 7 * 7 + 15 * 7 + 116 - 1) })
    .returning();
  const phase = (name: string, order: number, weeks: number, days: number | null, phaseType: "general" | "base" | "build") => ({
    userId,
    name,
    durationWeeks: weeks,
    durationDays: days,
    seasonId: season.id,
    phaseOrder: order,
    phaseType,
  });
  const [first] = await db
    .insert(trainingCycles)
    .values({ ...phase("Aerobic base + strength", 1, 7, null, "general"), status: "active", startDate: dayStr(0) })
    .returning();
  await db.insert(trainingCycles).values([phase("Longer ride and run", 2, 15, null, "base"), phase("Swim, intervals, bricks", 3, 17, 116, "build")]);
  await db.insert(trainingCycleSlots).values({ trainingCycleId: first.id, dayOfWeek: dow(0), daySlot: 1, programId: program.id });
  return { cycleId: first.id, seasonId: season.id, program };
}

const DATES = /(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[  ])?\d{1,2}[  ](?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b(?:[  ]\d{4})?/g;
/** "week 3 of 6", "90 days", "15 wk": a count and its word (J3-09, J7-09, J8-06). */
const COUNTS = /\b(?:[Ww]eek[  ]\d+[  ]of[  ]\d+|\d+[  ](?:days?|weeks?|wk))\b/g;

/** Every match of `re` in `root` that is drawn over more than one line. */
function splitText(root: Locator, re: RegExp): Promise<string[]> {
  return root.evaluate(
    (el, { source, flags }) => {
      const pattern = new RegExp(source, flags);
      const split: string[] = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        for (const m of node.data.matchAll(pattern)) {
          const range = document.createRange();
          range.setStart(node, m.index!);
          range.setEnd(node, m.index! + m[0].length);
          const lines = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
          if (lines.size > 1) split.push(m[0]);
        }
      }
      return split;
    },
    { source: re.source, flags: re.flags },
  );
}

/** Every date in `root` ("16 Nov", "Mon 14 Dec", "5 Sep 2027") that is drawn over more than one line. */
const splitDates = (root: Locator) => splitText(root, DATES);

/**
 * Places in `root` where a line could break inside a count or before a "·"
 * separator: an ordinary space there instead of a no-break one. Which line
 * breaks happen depends on the text and the font, so this checks that none
 * can (J3-09, J4-17, J7-02, J7-09, J8-06).
 */
function breakableJoins(root: Locator): Promise<string[]> {
  return root.evaluate((el) => {
    const re = /\b[Ww]eek \d+|\d+ of \d+|\d+ (?:days?|weeks?|wk)\b|\S ·/g;
    const found: string[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const parent = node.parentElement!;
      if (parent.closest("script, style, template") || getComputedStyle(parent).whiteSpace === "nowrap") continue;
      for (const m of node.data.matchAll(re)) found.push(`${m[0]} in "${node.data.slice(0, 50)}"`);
    }
    return found;
  });
}

/** Names in `root` matched by `selector` whose text is cut (ellipsis or clipped lines). */
function cutNames(root: Locator, selector: string): Promise<string[]> {
  return root.evaluate(
    (el, sel) => [...el.querySelectorAll<HTMLElement>(sel)].filter((n) => n.scrollHeight > n.clientHeight + 1 || n.scrollWidth > n.clientWidth + 1).map((n) => n.textContent!),
    selector,
  );
}

/** Elements inside `sheet` (not the sheet) that clip their own content: a list that scrolls inside. */
function clippedInside(sheet: Locator): Promise<string[]> {
  return sheet.evaluate((root) =>
    [...root.querySelectorAll("*")]
      .filter((el) => {
        const style = getComputedStyle(el);
        return style.overflowY !== "visible" && el.scrollHeight > el.clientHeight + 1;
      })
      .map((el) => el.textContent!.slice(0, 40)),
  );
}

/** `target` is fully inside the visible part of `sheet` once scrolled to. */
async function reachable(page: Page, sheet: Locator, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const t = (await target.boundingBox())!;
  const s = (await sheet.boundingBox())!;
  const view = page.viewportSize()!;
  expect(t.y, "top inside the sheet").toBeGreaterThanOrEqual(Math.max(s.y, 0) - 1);
  expect(t.y + t.height, "bottom inside the sheet and the screen").toBeLessThanOrEqual(Math.min(s.y + s.height, view.height) + 1);
}

test("at 320 px no date breaks over two lines on the Plan list, a season and a cycle", async ({ page }, testInfo) => {
  const { cycleId, seasonId } = await plan(testInfo.parallelIndex);

  await page.goto("/cycles");
  const hero = page.getByTestId("plan-hero");
  await expect(hero).toBeVisible();
  // The hero label breaks between its parts only: each part is on one line.
  const partLines = await page
    .getByTestId("hero-label")
    .locator(":scope > span")
    .evaluateAll((parts) => parts.map((p) => new Set([...p.getClientRects()].map((r) => Math.round(r.top))).size));
  expect(partLines.length).toBeGreaterThan(1);
  expect(partLines.every((n) => n === 1)).toBe(true);
  await expect(page.getByTestId("season-card")).toBeVisible();
  expect(await splitDates(page.locator("body"))).toEqual([]);

  await page.goto(`/seasons/${seasonId}`);
  await expect(page.getByTestId("phase-row")).toHaveCount(3);
  expect(await splitDates(page.locator("body"))).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("season-320.png") });

  await page.goto(`/cycles/${cycleId}`);
  await expect(page.getByTestId("cycle-week")).toBeVisible();
  expect(await splitDates(page.locator("body"))).toEqual([]);
});

test("at 320 px today's session sheet scrolls as a whole and every action is reachable", async ({ page }, testInfo) => {
  const { cycleId, program } = await plan(testInfo.parallelIndex);

  await page.goto(`/cycles/${cycleId}`);
  await page.getByTestId("week-row").filter({ hasText: program.name }).first().click();
  const sheet = page.getByTestId("session-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("link", { name: "Start workout" })).toBeVisible();
  // The exercise list and the action list are drawn whole; only the sheet scrolls.
  expect(await clippedInside(sheet)).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("session-sheet-320.png") });

  await reachable(page, sheet, sheet.getByRole("button", { name: "Skip this session" }));
  await reachable(page, sheet, sheet.getByRole("button", { name: "Label and note" }));
  await reachable(page, sheet, sheet.getByRole("button", { name: "Close" }));
});

test("at 320 px counts stay whole, no line can start with a dot, and long names wrap instead of being cut", async ({ page }, testInfo) => {
  const { cycleId, seasonId } = await plan(testInfo.parallelIndex);
  const db = testDb();
  await db.update(seasons).set({ name: "Jevnaker Half Full Distance 2027" }).where(eq(seasons.id, seasonId));
  await db.update(trainingCycles).set({ name: "Longer ride and run with bricks" }).where(and(eq(trainingCycles.seasonId, seasonId), eq(trainingCycles.phaseOrder, 2)));

  await page.goto("/cycles");
  const card = page.getByTestId("season-card");
  await expect(card).toBeVisible();
  // Names wrap to a second line where there is room (J4-20, J6-01).
  await expect(card.getByTestId("season-name")).toHaveText("Jevnaker Half Full Distance 2027");
  expect(await cutNames(card, "[data-testid=season-name], [data-testid=phase-name]")).toEqual([]);
  expect(await splitText(page.locator("body"), COUNTS)).toEqual([]);
  expect(await breakableJoins(page.locator("main, body").first())).toEqual([]);

  await page.goto(`/seasons/${seasonId}`);
  await expect(page.getByTestId("phase-row")).toHaveCount(3);
  expect(await splitText(page.locator("body"), COUNTS)).toEqual([]);
  expect(await breakableJoins(page.locator("main, body").first())).toEqual([]);

  // The delete confirm keeps "90 days" together (J8-06) and its title on the Close row.
  await page.goto(`/cycles/${cycleId}`);
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByTestId("cycle-menu").getByRole("button", { name: "Delete cycle" }).click();
  const confirm = page.getByRole("region", { name: "Delete this cycle?" });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText("90");
  expect(await splitText(confirm, COUNTS)).toEqual([]);
  expect(await breakableJoins(confirm)).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("delete-confirm-320.png") });
});

test("at 320 px the race distance select is a 44 px tap target, on New season and in the race sheet (round 8 B15)", async ({ page }, testInfo) => {
  const { seasonId } = await plan(testInfo.parallelIndex);
  await page.goto("/seasons/new");
  const onForm = page.getByRole("combobox", { name: "Distance" });
  await expect(onForm).toBeVisible();
  expect((await onForm.boundingBox())!.height).toBeGreaterThanOrEqual(44);

  await page.goto(`/seasons/${seasonId}`);
  await page.getByRole("button", { name: "+ Add race" }).click();
  const inSheet = page.getByRole("region", { name: "New race" }).getByRole("combobox", { name: "Distance" });
  await expect(inSheet).toBeVisible();
  expect((await inSheet.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: testInfo.outputPath("race-sheet-320.png") });
});

/** `target` is fully on screen and inside `sheet` as it opens, with no scrolling. */
async function inView(page: Page, sheet: Locator, target: Locator) {
  const view = page.viewportSize()!;
  // The sheet has slid all the way up: its bottom is the screen's.
  await expect.poll(async () => Math.round(await sheet.evaluate((el) => el.getBoundingClientRect().bottom))).toBe(view.height);
  const t = (await target.boundingBox())!;
  const s = (await sheet.boundingBox())!;
  expect(t.y, "top inside the sheet").toBeGreaterThanOrEqual(Math.max(s.y, 0) - 1);
  expect(t.y + t.height, "bottom on screen").toBeLessThanOrEqual(Math.min(s.y + s.height, view.height) + 1);
}

test("at 320 px a long sheet keeps its footer and main actions in view while the rest scrolls", async ({ page }, testInfo) => {
  const { cycleId, seasonId, program } = await plan(testInfo.parallelIndex);
  const db = testDb();
  await db.update(programs).set({ name: "Strength A with heavy compound lifts and a long accessory finisher" }).where(eq(programs.id, program.id));

  await page.goto(`/cycles/${cycleId}`);
  await page.getByTestId("week-row").first().click();
  const session = page.getByTestId("session-sheet");
  await expect(session).toBeVisible();
  await expect(session.getByRole("link", { name: "Start workout" })).toBeVisible();
  await inView(page, session, session.getByText("Only this day changes. The template stays the same."));
  await page.screenshot({ path: testInfo.outputPath("session-footer-320.png") });

  await page.goto(`/seasons/${seasonId}`);
  await page.getByTestId("phase-row").nth(1).click();
  const phase = page.locator("[data-plan-sheet]");
  await expect(phase.getByRole("button", { name: "Save phase" })).toBeVisible();
  await inView(page, phase, phase.getByRole("button", { name: "Save phase" }));
  await inView(page, phase, phase.getByRole("button", { name: "Remove from season" }));
  await page.screenshot({ path: testInfo.outputPath("phase-footer-320.png") });
});

test("at 320 px the rotation hero names the next session once", async ({ page }, testInfo) => {
  const { cycleId, program } = await plan(testInfo.parallelIndex);
  const db = testDb();
  const name = "Lower body strength and single-leg work";
  await db.update(programs).set({ name }).where(eq(programs.id, program.id));
  await db.delete(trainingCycleSlots).where(eq(trainingCycleSlots.trainingCycleId, cycleId));
  await db.update(trainingCycles).set({ scheduleType: "rotation" }).where(eq(trainingCycles.id, cycleId));
  await db.insert(trainingCycleSlots).values([
    { trainingCycleId: cycleId, orderIndex: 1, programId: program.id },
    { trainingCycleId: cycleId, orderIndex: 2, programId: null, label: "Rest" },
  ]);

  await page.goto("/cycles");
  const hero = page.getByTestId("plan-hero");
  await expect(hero.getByRole("list", { name: "Rotation" })).toBeVisible();
  await expect(hero.getByText(name, { exact: true }).filter({ visible: true })).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("rotation-hero-320.png") });
});

test("at 320 px a week strip label never breaks inside a word", async ({ page }, testInfo) => {
  const { cycleId } = await plan(testInfo.parallelIndex);
  // Days with a label and no session: the strip shows the label.
  await testDb()
    .insert(trainingCycleSlots)
    .values([
      { trainingCycleId: cycleId, dayOfWeek: dow(1), daySlot: 1, label: "Mobility" },
      { trainingCycleId: cycleId, dayOfWeek: dow(2), daySlot: 1, label: "Recovery stretching" },
      { trainingCycleId: cycleId, dayOfWeek: dow(3), daySlot: 1, label: "Swimmingpoolrecovery" },
    ]);

  await page.goto("/cycles");
  const hero = page.getByTestId("plan-hero");
  await expect(hero.getByTestId("hero-day-short").filter({ hasText: "Mobility" })).toBeVisible();
  await expect(hero.getByTestId("hero-day-short").filter({ hasText: "Swimmingpoolrecovery" })).toBeVisible();
  const splitWords = await hero.getByTestId("hero-day-short").evaluateAll((els) =>
    els.flatMap((el) => {
      const split: string[] = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        for (const m of node.data.matchAll(/\S+/g)) {
          const range = document.createRange();
          range.setStart(node, m.index!);
          range.setEnd(node, m.index! + m[0].length);
          const lines = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
          if (lines.size > 1) split.push(m[0]);
        }
      }
      return split;
    }),
  );
  expect(splitWords).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("week-strip-320.png") });
});

/** How many lines each element matched by `selector` in `root` is drawn over. */
function lineCounts(root: Locator, selector: string): Promise<{ text: string; lines: number }[]> {
  return root.evaluate(
    (el, sel) =>
      [...el.querySelectorAll<HTMLElement>(sel)].map((n) => {
        const range = document.createRange();
        range.selectNodeContents(n);
        const lines = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
        return { text: n.textContent!, lines: lines.size };
      }),
    selector,
  );
}

test("at 320 px a season page phase row keeps its name to two lines, the badge out of its way (round 8)", async ({ page }, testInfo) => {
  const { seasonId } = await plan(testInfo.parallelIndex);
  const db = testDb();
  await db.update(trainingCycles).set({ name: "Swim, intervals and long bricks on Sundays" }).where(and(eq(trainingCycles.seasonId, seasonId), eq(trainingCycles.phaseOrder, 2)));
  // The next phase is scheduled, so its badge is a start day.
  await db.update(trainingCycles).set({ scheduledStartDate: dayStr(7 * 7) }).where(and(eq(trainingCycles.seasonId, seasonId), eq(trainingCycles.phaseOrder, 2)));

  await page.goto(`/seasons/${seasonId}`);
  const rows = page.getByTestId("season-phases");
  await expect(page.getByTestId("phase-row")).toHaveCount(3);
  await expect(rows).toContainText("Starts");
  const names = await lineCounts(rows, "[data-testid=phase-name]");
  expect(names.filter((n) => n.lines > 2)).toEqual([]);
  const subs = await lineCounts(rows, "[data-testid=phase-sub]");
  expect(subs.filter((n) => n.lines > 2)).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("season-phases-320.png") });
});

/**
 * `target` is on screen and the element at its centre is itself, not the
 * pinned footer: both when it is scrolled into view from the top of `sheet`
 * (as a tap on the row above or a keyboard focus does) and with the sheet
 * scrolled to its end.
 */
async function uncovered(page: Page, sheet: Locator, target: Locator) {
  await sheet.evaluate((el) => el.scrollTo(0, 0));
  await target.evaluate((el) => el.scrollIntoView({ block: "nearest" }));
  await notCovered(page, target);
  await sheet.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect.poll(() => sheet.evaluate((el) => Math.ceil(el.scrollTop + el.clientHeight) >= el.scrollHeight - 1)).toBe(true);
  await notCovered(page, target);
}

async function notCovered(page: Page, target: Locator) {
  const view = page.viewportSize()!;
  const t = (await target.boundingBox())!;
  expect(t.y, "top on screen").toBeGreaterThanOrEqual(0);
  expect(t.y + t.height, "bottom on screen").toBeLessThanOrEqual(view.height + 1);
  const hit = await target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return at != null && (el === at || el.contains(at));
  });
  expect(hit, "not covered by the footer").toBe(true);
}

test("at 320 px a pinned sheet footer never covers the last row or note (round 9 F1)", async ({ page }, testInfo) => {
  const { cycleId, seasonId } = await plan(testInfo.parallelIndex);

  await page.goto(`/cycles/${cycleId}`);
  await page.getByTestId("week-row").first().click();
  const session = page.getByTestId("session-sheet");
  await expect(session).toBeVisible();
  await session.getByRole("button", { name: "Move to another day" }).click();
  await uncovered(page, session, session.getByRole("button", { name: "Skip this session" }));
  await uncovered(page, session, session.getByText("Only this day changes. The template stays the same."));
  await page.screenshot({ path: testInfo.outputPath("session-end-320.png") });

  await page.goto(`/seasons/${seasonId}`);
  await page.getByTestId("phase-row").nth(2).click();
  const phase = page.locator("[data-plan-sheet]");
  await expect(phase.getByRole("button", { name: "Save phase" })).toBeVisible();
  await phase.getByRole("button", { name: "Weeks" }).click();
  const note = phase.getByText(/is not a whole number of weeks/);
  await expect(note).toBeVisible();
  await uncovered(page, phase, note);
  await uncovered(page, phase, phase.getByRole("button", { name: "Save phase" }));
  await page.screenshot({ path: testInfo.outputPath("phase-end-320.png") });
});
