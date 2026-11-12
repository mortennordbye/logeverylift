import { and, asc, eq } from "drizzle-orm";
import { planRevisions, seasonRaces, seasons, trainingCycles, users } from "../src/db/schema";
import { e2eUser } from "./fixtures/env";
import { testDb } from "./fixtures/reset";
import { expect, test } from "./fixtures/test";
import { trackActions } from "./helpers";

/**
 * Seasons (docs/plans/seasons.md, 2.10): make a season, add an A race, add an
 * existing cycle and a new taper as phases, fit the taper to the race, move
 * the race and see the re-plan banner, then mark it as re-planned.
 */

const isoDay = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

test("make a season with a race and phases, fit the taper, and re-plan after a race moves", async ({ page }, testInfo) => {
  const settle = trackActions(page);
  const [user] = await testDb().select({ id: users.id }).from(users).where(eq(users.email, e2eUser(testInfo.parallelIndex).email));
  // Races and phase types are endurance features (D18).
  await testDb().update(users).set({ enduranceEnabled: true }).where(eq(users.id, user.id));
  const [existing] = await testDb().insert(trainingCycles).values({ userId: user.id, name: "Build block", durationWeeks: 8 }).returning();

  await page.goto("/cycles");
  await expect(page.getByTestId("seasons-section")).toBeVisible();
  await page.getByRole("link", { name: "New season" }).click();
  await expect(page).toHaveURL(/\/seasons\/new$/);
  await page.getByLabel("Name").fill("Half 2027");
  await page.getByLabel("Start").fill(isoDay(0));
  await page.getByLabel("End").fill(isoDay(120));
  await page.getByRole("button", { name: "Create season" }).click();
  await settle();
  await expect(page).toHaveURL(/\/seasons\/\d+$/);
  await expect(page.getByRole("heading", { name: "Half 2027" })).toBeVisible();

  // The A race: 8 weeks of build and a 10-day taper end 3 days before it.
  await page.getByRole("button", { name: "Add race" }).click();
  await page.getByLabel("Name").fill("Haugesund 70.3");
  await page.getByLabel("Date").fill(isoDay(68));
  await page.getByRole("button", { name: "Save race" }).click();
  await settle();
  await expect(page.getByRole("button", { name: /Haugesund 70\.3/ })).toBeVisible();
  // Adding an A race flags the season; nothing is planned yet, so mark it.
  await expect(page.getByTestId("replan-banner")).toBeVisible();
  await page.getByRole("button", { name: "Mark as re-planned" }).click();
  await settle();
  await expect(page.getByTestId("replan-banner")).toHaveCount(0);

  await page.getByRole("button", { name: "Add phase" }).click();
  await page.getByRole("button", { name: "Existing cycle" }).click();
  await page.getByRole("combobox", { name: "Cycle", exact: true }).selectOption({ label: "Build block" });
  await page.getByLabel("Phase type").selectOption("build");
  await page.getByRole("textbox", { name: "Length", exact: true }).fill("8");
  await page.getByRole("button", { name: "Add phase" }).last().click();
  await settle();
  await expect(page.getByTestId("season-phases")).toContainText("Build block");

  await page.getByRole("button", { name: "Add phase" }).click();
  await page.getByLabel("Name").fill("Taper");
  await page.getByLabel("Phase type").selectOption("taper");
  await page.getByRole("textbox", { name: "Length", exact: true }).fill("");
  await page.getByRole("button", { name: "Add phase" }).last().click();
  await settle();
  await expect(page.getByTestId("season-phases")).toContainText("10 days");
  await expect(page.getByTestId("taper-fit")).toHaveText("The taper ends 3 days before the A race.");

  await page.getByRole("button", { name: "Fit taper" }).click();
  await settle();
  await expect(page.getByTestId("taper-fit")).toHaveText("The taper ends on race day.");

  // The race moves: the season is flagged, and the phases stay as they are.
  await page.getByRole("button", { name: /Haugesund 70\.3/ }).click();
  await page.getByLabel("Date").fill(isoDay(75));
  await page.getByRole("button", { name: "Save race" }).click();
  await settle();
  await expect(page.getByTestId("replan-banner")).toContainText(`moved from ${isoDay(68)} to ${isoDay(75)}`);
  await expect(page.getByTestId("taper-fit")).toHaveText("The taper ends 7 days before the A race.");

  const [season] = await testDb().select().from(seasons).where(eq(seasons.userId, user.id));
  expect(season).toMatchObject({ name: "Half 2027", startDate: isoDay(0), endDate: isoDay(120) });
  expect(season.replanFlaggedAt).not.toBeNull();
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

  await page.getByRole("button", { name: "Mark as re-planned" }).click();
  await settle();
  await expect(page.getByTestId("replan-banner")).toHaveCount(0);
  await expect.poll(async () => (await testDb().select().from(seasons).where(eq(seasons.id, season.id)))[0].replanFlaggedAt).toBeNull();

  const revs = await testDb()
    .select({ writer: planRevisions.writer })
    .from(planRevisions)
    .where(and(eq(planRevisions.objectType, "season"), eq(planRevisions.objectId, season.id)));
  expect(revs.length).toBeGreaterThan(5);
  expect(new Set(revs.map((r) => r.writer))).toEqual(new Set(["user"]));

  // The cycle page shows where the phase sits and the season's race.
  await page.goto(`/cycles/${existing.id}`);
  await expect(page.getByTestId("cycle-season")).toContainText("Phase 1 of 2 in Half 2027");
  await expect(page.getByTestId("cycle-season")).toContainText("A race: Haugesund 70.3");
});
