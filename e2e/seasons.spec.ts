import type { Locator, Page } from "@playwright/test";
import { and, asc, eq } from "drizzle-orm";
import { athleteProfiles, planRevisions, programs, seasonRaces, seasons, trainingCycles, users } from "../src/db/schema";
import { dayLabel } from "../src/lib/utils/seasons";
import { e2eUser } from "./fixtures/env";
import { testDb } from "./fixtures/reset";
import { expect, test } from "./fixtures/test";
import { stableBox, trackActions } from "./helpers";

/**
 * Seasons (docs/plans/plan-tab-redesign.md, P4): make a season with its A race,
 * add an existing cycle and a new taper as phases, fit the taper, drag a phase,
 * move the race and answer the re-plan banner; and make a triathlon plan whose
 * phases end on race day.
 */

const isoDay = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Drag `handle` onto `target` the way a finger does (e2e/drag-reorder.spec.ts). */
async function drag(page: Page, handle: Locator, target: Locator) {
  const from = await stableBox(handle);
  const to = await stableBox(target);
  const x = from.x + from.width / 2;
  await page.mouse.move(x, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, from.y + from.height / 2 + 12, { steps: 4 });
  await page.mouse.move(x, to.y + to.height / 2, { steps: 20 });
  // dnd-kit takes the drop from the last move; a finger pauses before it lifts.
  // eslint-disable-next-line no-restricted-syntax
  await page.waitForTimeout(150);
  await page.mouse.up();
}

const phaseNames = (page: Page) => page.getByTestId("phase-name").allInnerTexts();

/** The Weeks and Days switch next to the length field has room for both words. */
async function expectUnitSwitchVisible(page: Page) {
  const unit = page.getByRole("group", { name: "Length unit" });
  await expect(unit.getByRole("button", { name: "Days" })).toBeVisible();
  expect((await unit.boundingBox())!.width).toBeGreaterThan(100);
}

test("make a season with a race and phases, fit the taper, drag a phase, and answer a re-plan", async ({ page }, testInfo) => {
  const settle = trackActions(page);
  const [user] = await testDb().select({ id: users.id }).from(users).where(eq(users.email, e2eUser(testInfo.parallelIndex).email));
  // Races and phase types are endurance features (D18).
  await testDb().update(users).set({ enduranceEnabled: true }).where(eq(users.id, user.id));
  const [existing] = await testDb().insert(trainingCycles).values({ userId: user.id, name: "Build block", durationWeeks: 8 }).returning();
  // A name no seeded program shares, so the picker has one row for it.
  await testDb().insert(programs).values({ userId: user.id, name: "Zed taper" });

  await page.goto("/cycles");
  await page.getByRole("button", { name: "New cycle or season" }).click();
  await page.getByRole("link", { name: /New season/ }).click();
  await expect(page).toHaveURL(/\/seasons\/new$/);
  // The date field shows only once the form has hydrated, so later typing sticks.
  await page.getByRole("button", { name: "Change start" }).click();
  await page.getByLabel("Start date").fill(isoDay(0));
  await page.getByLabel("Name", { exact: true }).fill("Half 2027");
  // The A race: 8 weeks of build and a 10-day taper end 3 days before it.
  await page.getByLabel("Race name").fill("Haugesund 70.3");
  await page.getByLabel("Race date").fill(isoDay(68));
  await expect(page.getByText("· race day")).toBeVisible();
  await page.getByRole("button", { name: "Create season" }).click();
  await settle();
  await expect(page).toHaveURL(/\/seasons\/\d+$/);
  await expect(page.getByRole("heading", { name: "Half 2027" })).toBeVisible();
  // A new season's first race is no change to a plan: no re-plan flag.
  await expect(page.getByTestId("replan-banner")).toHaveCount(0);
  await expect(page.getByTestId("season-hero")).toContainText("Haugesund 70.3");
  const seasonUrl = page.url();

  await page.getByRole("link", { name: "+ Add phase" }).click();
  await expect(page).toHaveURL(/\/phases\/new$/);
  await page.getByText("Cycle I already have").click();
  await page.getByText("Build block").click();
  await page.getByRole("button", { name: "Build", exact: true }).click();
  await page.getByRole("textbox", { name: "Length", exact: true }).fill("8");
  await page.getByRole("button", { name: "Add phase" }).click();
  await settle();
  await expect(page).toHaveURL(seasonUrl);
  await expect(page.getByTestId("season-phases")).toContainText("Build block");

  await page.getByRole("link", { name: "+ Add phase" }).click();
  await expect(page.getByText("Step 1 of 2")).toBeVisible();
  await expectUnitSwitchVisible(page);
  await page.setViewportSize({ width: 320, height: 568 });
  await expectUnitSwitchVisible(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("Name", { exact: true }).fill("Taper");
  // Picking Taper sets the A race's taper length.
  await page.getByRole("button", { name: "Taper", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Length", exact: true })).toHaveValue("10");
  await page.getByRole("button", { name: "Build the week" }).click();
  await settle();
  // Step 2 is the season's own page: the week, then Add phase back to the season.
  await expect(page).toHaveURL(/\/seasons\/\d+\/phases\/\d+\/week$/);
  await expect(page.getByText("Step 2 of 2")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Build the week" })).toBeVisible();
  // An all-rest week is no phase: Add phase stays off until the week has a session, as Create cycle does.
  await expect(page.getByRole("button", { name: "Add phase" })).toBeDisabled();
  await expect(page.getByText("Add a session first.")).toBeVisible();
  await page.getByRole("button", { name: "Add a session on Mon" }).click();
  await page.getByRole("region", { name: "Pick a program" }).getByRole("button", { name: /^Zed taper / }).click();
  await settle();
  await page.getByRole("button", { name: "Add phase" }).click();
  await expect(page).toHaveURL(seasonUrl);
  await expect(page.getByTestId("season-phases")).toContainText("10 days");
  await expect(page.getByTestId("replan-banner")).toContainText("The taper does not end on race day.");
  await expect(page.getByTestId("season-phases")).toContainText("Taper ends 3 days before the race");
  await page.getByRole("button", { name: "Fit the taper" }).click();
  await settle();
  await expect(page.getByTestId("replan-banner")).toHaveCount(0);

  // The phase sheet draws on a card, with room for Weeks and Days.
  await page.getByRole("button", { name: /^Taper/ }).click();
  const sheet = page.getByRole("region", { name: "Taper" });
  await expect(sheet).toBeVisible();
  expect(await sheet.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
  await expectUnitSwitchVisible(page);
  await page.keyboard.press("Escape");
  await page.goto(seasonUrl);

  // Drag the taper above the build block, then back.
  expect(await phaseNames(page)).toEqual(["Build block", "Taper"]);
  await drag(page, page.getByRole("button", { name: "Reorder Taper" }), page.getByRole("button", { name: "Reorder Build block" }));
  await settle();
  await expect.poll(() => phaseNames(page)).toEqual(["Taper", "Build block"]);
  const [season] = await testDb().select().from(seasons).where(eq(seasons.userId, user.id));
  const order = () =>
    testDb()
      .select({ name: trainingCycles.name, phaseOrder: trainingCycles.phaseOrder })
      .from(trainingCycles)
      .where(eq(trainingCycles.seasonId, season.id))
      .orderBy(asc(trainingCycles.phaseOrder));
  await expect.poll(order).toEqual([
    { name: "Taper", phaseOrder: 1 },
    { name: "Build block", phaseOrder: 2 },
  ]);
  // The order holds after a reload: the server saved it.
  await page.reload();
  expect(await phaseNames(page)).toEqual(["Taper", "Build block"]);
  await drag(page, page.getByRole("button", { name: "Reorder Taper" }), page.getByRole("button", { name: "Reorder Build block" }));
  await settle();
  await expect.poll(order).toEqual([
    { name: "Build block", phaseOrder: 1 },
    { name: "Taper", phaseOrder: 2 },
  ]);
  await page.reload();
  await expect(page.getByTestId("replan-banner")).toHaveCount(0);

  // The race moves: the season is flagged, and the phases stay as they are.
  await page.getByRole("button", { name: /Haugesund 70\.3/ }).click();
  await page.getByLabel("Date").fill(isoDay(75));
  await page.getByRole("button", { name: "Save race" }).click();
  await settle();
  const banner = page.getByTestId("replan-banner");
  await expect(banner).toContainText("Race date changed. The taper no longer ends on race day.");
  await expect(banner).toContainText(`moved from ${dayLabel(isoDay(68))} to ${dayLabel(isoDay(75))}`);
  // The season ended on its A race, so the end moved with it.
  await expect(page.getByText(`${dayLabel(isoDay(0))} to ${dayLabel(isoDay(75))}`)).toBeVisible();
  await expect(page.getByTestId("season-phases")).toContainText("Taper ends 7 days before the race");

  // Keep as it is: the flag goes, the phases do not change.
  await banner.getByRole("button", { name: "Keep as it is" }).click();
  await settle();
  await expect.poll(async () => (await testDb().select().from(seasons).where(eq(seasons.id, season.id)))[0].replanFlaggedAt).toBeNull();
  await expect(banner).toContainText("The taper does not end on race day.");
  await expect(banner.getByRole("button", { name: "Keep as it is" })).toHaveCount(0);

  expect(await testDb().select({ name: seasonRaces.name, raceDate: seasonRaces.raceDate, priority: seasonRaces.priority, distance: seasonRaces.distance }).from(seasonRaces).where(eq(seasonRaces.seasonId, season.id))).toEqual([
    { name: "Haugesund 70.3", raceDate: isoDay(75), priority: "A", distance: "half" },
  ]);
  const phases = await testDb()
    .select({ id: trainingCycles.id, name: trainingCycles.name, phaseOrder: trainingCycles.phaseOrder, phaseType: trainingCycles.phaseType, durationDays: trainingCycles.durationDays })
    .from(trainingCycles)
    .where(eq(trainingCycles.seasonId, season.id))
    .orderBy(asc(trainingCycles.phaseOrder));
  expect(phases).toEqual([
    { id: existing.id, name: "Build block", phaseOrder: 1, phaseType: "build", durationDays: 59 },
    expect.objectContaining({ name: "Taper", phaseOrder: 2, phaseType: "taper", durationDays: 10 }),
  ]);

  // The cycle page shows where the phase sits and links to the season.
  await page.goto(`/cycles/${existing.id}`);
  await expect(page.getByTestId("cycle-season")).toContainText("Phase 1 of 2 · Half 2027");
  await expect(page.getByTestId("cycle-season")).toHaveAttribute("href", `/seasons/${season.id}`);

  const revs = await testDb()
    .select({ writer: planRevisions.writer })
    .from(planRevisions)
    .where(and(eq(planRevisions.objectType, "season"), eq(planRevisions.objectId, season.id)));
  expect(revs.length).toBeGreaterThan(5);
  expect(new Set(revs.map((r) => r.writer))).toEqual(new Set(["user"]));
});

test("make a triathlon plan: five phases from the start to race day", async ({ page }, testInfo) => {
  const settle = trackActions(page);
  const [user] = await testDb().select({ id: users.id }).from(users).where(eq(users.email, e2eUser(testInfo.parallelIndex).email));
  await testDb().update(users).set({ enduranceEnabled: true }).where(eq(users.id, user.id));
  // The plan starts with the intake interview (D10).
  await testDb().insert(athleteProfiles).values({ userId: user.id, interviewCompletedAt: new Date() }).onConflictDoUpdate({ target: athleteProfiles.userId, set: { interviewCompletedAt: new Date() } });

  // The old address leads to New season with the plan picked.
  await page.goto("/cycles/triathlon");
  await expect(page).toHaveURL(/\/seasons\/new\?plan=triathlon$/);
  await expect(page.getByRole("radio", { name: /Make a triathlon plan/ })).toBeChecked();
  // The date field shows only once the form has hydrated, so later typing sticks.
  await page.getByRole("button", { name: "Change start" }).click();
  await page.getByLabel("Start date").fill(isoDay(0));
  await page.getByLabel("Name", { exact: true }).fill("Jevnaker Half");
  await page.getByLabel("Race name").fill("Jevnaker Halv Full Distanse");
  await page.getByLabel("Race date").fill(isoDay(200));
  await expect(page.getByRole("list", { name: "Planned phases" }).getByRole("listitem")).toHaveCount(5);
  await page.getByRole("button", { name: "Create season" }).click();
  await settle();
  await expect(page).toHaveURL(/\/seasons\/\d+$/);
  expect(await phaseNames(page)).toEqual(["Aerobic base + strength", "Longer ride and run", "Swim, intervals, bricks", "Race pace + open water", "Taper"]);
  await expect(page.getByTestId("replan-banner")).toHaveCount(0);

  const [season] = await testDb().select().from(seasons).where(eq(seasons.userId, user.id));
  expect(season).toMatchObject({ name: "Jevnaker Half", startDate: isoDay(0), endDate: isoDay(200) });
  const types = await testDb()
    .select({ phaseType: trainingCycles.phaseType })
    .from(trainingCycles)
    .where(eq(trainingCycles.seasonId, season.id))
    .orderBy(asc(trainingCycles.phaseOrder));
  expect(types.map((t) => t.phaseType)).toEqual(["general", "base", "build", "peak", "taper"]);

  // On the Plan list the five-phase card keeps its full height: no row is
  // squashed and the A race row at the bottom is not cut off.
  await page.goto("/cycles");
  const card = page.getByTestId("season-card");
  const raceRow = card.getByRole("link", { name: /Jevnaker Halv Full Distanse/ });
  await expect(raceRow).toBeVisible();
  const fit = await card.evaluate((el) => ({ client: el.clientHeight, scroll: el.scrollHeight }));
  expect(fit.scroll).toBeLessThanOrEqual(fit.client);
  const [cardBox, rowBox] = [await card.boundingBox(), await raceRow.boundingBox()];
  expect(rowBox!.y + rowBox!.height).toBeLessThanOrEqual(cardBox!.y + cardBox!.height + 1);
  expect(rowBox!.height).toBeGreaterThanOrEqual(44);

  // At 320 by 568, under a running cycle, the card keeps its height too.
  await testDb().update(trainingCycles).set({ status: "active", startDate: isoDay(0) }).where(and(eq(trainingCycles.seasonId, season.id), eq(trainingCycles.phaseOrder, 1)));
  await page.setViewportSize({ width: 320, height: 568 });
  await page.reload();
  await expect(page.getByTestId("season-card")).toBeVisible();
  const small = await page.getByTestId("season-card").evaluate((el) => ({ client: el.clientHeight, scroll: el.scrollHeight }));
  expect(small.client).toBeGreaterThan(200);
  expect(small.scroll).toBeLessThanOrEqual(small.client);
  await page.getByTestId("season-card").getByRole("link", { name: /Jevnaker Halv Full Distanse/ }).scrollIntoViewIfNeeded();
  await expect(page.getByTestId("season-card").getByRole("link", { name: /Jevnaker Halv Full Distanse/ })).toBeInViewport();
});

test("a second season asks before it takes the start, step 2 Cancel removes the phase, and Plan stays the active tab", async ({ page }, testInfo) => {
  const settle = trackActions(page);
  const [user] = await testDb().select({ id: users.id }).from(users).where(eq(users.email, e2eUser(testInfo.parallelIndex).email));
  // A season under way: Base runs from today, Build is scheduled for the day after it ends.
  // Only one cycle runs: the account's seeded block ends first.
  await testDb().update(trainingCycles).set({ status: "completed" }).where(and(eq(trainingCycles.userId, user.id), eq(trainingCycles.status, "active")));
  const [old] = await testDb().insert(seasons).values({ userId: user.id, name: "Winter run base", startDate: isoDay(0), endDate: isoDay(120) }).returning();
  await testDb()
    .insert(trainingCycles)
    .values({ userId: user.id, name: "Base", durationWeeks: 4, seasonId: old.id, phaseOrder: 1, status: "active", startDate: isoDay(0) });
  const [build] = await testDb()
    .insert(trainingCycles)
    .values({ userId: user.id, name: "Build", durationWeeks: 4, seasonId: old.id, phaseOrder: 2, scheduledStartDate: isoDay(28) })
    .returning();
  const [next] = await testDb().insert(seasons).values({ userId: user.id, name: "Spring block", startDate: isoDay(3), endDate: isoDay(90) }).returning();

  await page.goto(`/seasons/${next.id}`);
  await expect(page.getByRole("link", { name: "Plan", exact: true })).toHaveAttribute("aria-current", "page");

  // Step 2 Cancel removes the phase this flow made.
  await page.getByRole("link", { name: "+ Add phase" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Recovery block");
  await page.getByRole("button", { name: "Build the week" }).click();
  const confirm = page.getByRole("region", { name: /^Start this season/ });
  await expect(confirm).toContainText("This ends Base at week 1 of 4.");
  await expect(confirm).toContainText("Winter run base pauses. Its next phase no longer starts");
  // Nothing is written before the confirm.
  expect(await testDb().select().from(trainingCycles).where(eq(trainingCycles.seasonId, next.id))).toHaveLength(0);
  await confirm.getByRole("button", { name: "Build the week" }).click();
  await settle();
  await expect(page).toHaveURL(/\/phases\/\d+\/week$/);
  await expect.poll(async () => (await testDb().select().from(trainingCycles).where(eq(trainingCycles.id, build.id)))[0].scheduledStartDate).toBeNull();

  await page.getByRole("button", { name: "Cancel" }).click();
  const remove = page.getByRole("region", { name: "Remove this phase?" });
  await expect(remove).toContainText("Recovery block and the sessions you added are deleted.");
  await remove.getByRole("button", { name: "Remove phase" }).click();
  await settle();
  await expect(page).toHaveURL(new RegExp(`/seasons/${next.id}$`));
  await expect(page.getByTestId("season-phases")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Plan", exact: true })).toHaveAttribute("aria-current", "page");
});
