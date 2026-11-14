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

/** Every date in `root` ("16 Nov", "Mon 14 Dec", "5 Sep 2027") that is drawn over more than one line. */
function splitDates(root: Locator): Promise<string[]> {
  return root.evaluate((el) => {
    const re = /(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[  ])?\d{1,2}[  ](?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b(?:[  ]\d{4})?/g;
    const split: string[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      for (const m of node.data.matchAll(re)) {
        const range = document.createRange();
        range.setStart(node, m.index!);
        range.setEnd(node, m.index! + m[0].length);
        const lines = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
        if (lines.size > 1) split.push(m[0]);
      }
    }
    return split;
  });
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
