import type { Locator, Page } from "@playwright/test";
import { and, asc, eq } from "drizzle-orm";
import { athleteProfiles, planRevisions, seasonRaces, seasons, trainingCycles, users } from "../src/db/schema";
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

test("make a season with a race and phases, fit the taper, drag a phase, and answer a re-plan", async ({ page }, testInfo) => {
  const settle = trackActions(page);
  const [user] = await testDb().select({ id: users.id }).from(users).where(eq(users.email, e2eUser(testInfo.parallelIndex).email));
  // Races and phase types are endurance features (D18).
  await testDb().update(users).set({ enduranceEnabled: true }).where(eq(users.id, user.id));
  const [existing] = await testDb().insert(trainingCycles).values({ userId: user.id, name: "Build block", durationWeeks: 8 }).returning();

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
  await page.getByLabel("Name", { exact: true }).fill("Taper");
  // Picking Taper sets the A race's taper length.
  await page.getByRole("button", { name: "Taper", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Length", exact: true })).toHaveValue("10");
  await page.getByRole("button", { name: "Build the week" }).click();
  await settle();
  await expect(page).toHaveURL(/\/cycles\/\d+\/template$/);

  await page.goto(seasonUrl);
  await expect(page.getByTestId("season-phases")).toContainText("10 days");
  await expect(page.getByTestId("replan-banner")).toContainText("The taper does not end on race day.");
  await expect(page.getByTestId("season-phases")).toContainText("Taper ends 3 days before the race");
  await page.getByRole("button", { name: "Fit the taper" }).click();
  await settle();
  await expect(page.getByTestId("replan-banner")).toHaveCount(0);

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
  await expect(banner).toContainText(`moved from ${isoDay(68)} to ${isoDay(75)}`);
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
});
