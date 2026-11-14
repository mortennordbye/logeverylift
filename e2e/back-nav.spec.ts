import type { Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { exercisePrs, exercises, seasons, users, workoutSessions } from "../src/db/schema";
import type { StoredHomeItem } from "../src/lib/home/stored-layout";
import { e2eUser } from "./fixtures/env";
import { testDb } from "./fixtures/reset";
import { expect, test } from "./fixtures/test";
import { backLink, openFirstExercise, openFirstSetEditor, openWorkout, trackActions } from "./helpers";

/**
 * Back goes where the user came from (docs/plans/back-navigation.md).
 *
 * The bug: home > Body weight (or Recent PRs) > Progress showed "< More" and
 * went to More. Back now pops history to the previous in-app page and names
 * it; with nothing to go back to (a deep link, a cold start) it goes to the
 * page's parent. `goForward()` after Back proves it was a pop, not a push.
 */

async function homeWith(workerIndex: number, ids: string[]) {
  const items: StoredHomeItem[] = [
    { id: "title", size: "m", hidden: false },
    { id: "today", size: "l", hidden: false },
    ...ids.map((id): StoredHomeItem => ({ id, size: "l", hidden: false })),
  ];
  await testDb()
    .update(users)
    .set({ homeLayout: { v: 1, updatedAt: new Date().toISOString(), items } })
    .where(eq(users.email, e2eUser(workerIndex).email));
}

/** One record, so the Recent PRs widget has a row and a link. */
async function withPr(workerIndex: number) {
  const db = testDb();
  const user = await db.query.users.findFirst({ where: eq(users.email, e2eUser(workerIndex).email) });
  const [bench] = await db
    .select({ id: exercises.id })
    .from(exercises)
    .where(and(eq(exercises.name, "Bench Press"), eq(exercises.isCustom, false)));
  await db.insert(exercisePrs).values({ userId: user!.id, exerciseId: bench.id, prType: "weight", value: "100" });
}

const back = backLink;
const atPath = (path: string) => (u: URL) => u.pathname === path;

/** The More tab's own page: its list, not a page under it. */
async function openMore(page: Page) {
  await page.goto("/more");
  await expect(page.getByRole("link", { name: /Progress/ }).first()).toBeVisible();
}

test("home widget > Progress > Back lands on home, as a pop", async ({ page }, testInfo) => {
  await withPr(testInfo.parallelIndex);
  await homeWith(testInfo.parallelIndex, ["recentPrs"]);
  await page.goto("/");
  // Every frame's Back label from here on, read just before paint.
  await page.evaluate(() => {
    const w = window as unknown as { __labels: string[] };
    w.__labels = [];
    const tick = () => {
      const el = document.querySelector('[data-testid="back-link"]');
      if (el?.textContent) w.__labels.push(el.textContent);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.getByTestId("recent-prs").getByRole("link", { name: "All records →" }).click();
  await page.waitForURL("**/more/metrics?tab=records");
  await expect(back(page)).toHaveText("Home");
  // Never painted with the wrong name first.
  expect(await page.evaluate(() => (window as unknown as { __labels: string[] }).__labels)).not.toContain("More");

  await back(page).click();
  await page.waitForURL(atPath("/"));
  await expect(page.getByTestId("home-title")).toBeVisible();
  // A pop leaves Progress ahead in history; a push would not.
  await page.goForward();
  await page.waitForURL("**/more/metrics?tab=records");
});

test("More > Progress > Back lands on More", async ({ page }) => {
  await openMore(page);
  await page.getByRole("link", { name: /Progress/ }).first().click();
  await page.waitForURL(atPath("/more/metrics"));
  await expect(back(page)).toHaveText("More");
  await back(page).click();
  await page.waitForURL(atPath("/more"));
  await page.goForward();
  await page.waitForURL(atPath("/more/metrics"));
});

test("a deep link has no in-app page behind it, so Back goes to the parent", async ({ page }) => {
  await page.goto("/more/metrics");
  await expect(back(page)).toHaveText("More");
  await back(page).click();
  await page.waitForURL(atPath("/more"));
});

test("after a reload Back still knows where the user came from", async ({ page }, testInfo) => {
  await withPr(testInfo.parallelIndex);
  await homeWith(testInfo.parallelIndex, ["recentPrs"]);
  await page.goto("/");
  await page.getByTestId("recent-prs").getByRole("link", { name: "All records →" }).click();
  await page.waitForURL("**/more/metrics?tab=records");
  await page.reload();
  await expect(back(page)).toHaveText("Home");
  await back(page).click();
  await page.waitForURL(atPath("/"));
});

test("two levels: Settings > Add to iPhone > Back > Back", async ({ page }) => {
  await openMore(page);
  await page.getByRole("link", { name: /Settings/ }).first().click();
  await page.waitForURL(atPath("/settings"));
  await page.getByRole("link", { name: /Add to iPhone/ }).click();
  await page.waitForURL(atPath("/more/install"));
  await expect(back(page)).toHaveText("Settings");
  await back(page).click();
  await page.waitForURL(atPath("/settings"));
  await expect(back(page)).toHaveText("More");
  await back(page).click();
  await page.waitForURL(atPath("/more"));
});

test("two levels from the home: Friends' activity > Friends > Add Friends > Back > Back", async ({ page }, testInfo) => {
  await homeWith(testInfo.parallelIndex, ["friendsActivity"]);
  await page.goto("/");
  await page.getByTestId("friends-activity").getByRole("link").first().click();
  await page.waitForURL(atPath("/more/friends"));
  await expect(back(page)).toHaveText("Home");
  await page.getByRole("link", { name: "Add Friends" }).first().click();
  await page.waitForURL(atPath("/more/friends/search"));
  await expect(back(page)).toHaveText("Friends");
  await back(page).click();
  await page.waitForURL(atPath("/more/friends"));
  await expect(back(page)).toHaveText("Home");
  await back(page).click();
  await page.waitForURL(atPath("/"));
});

test("the Progress tab is kept in the URL, through Back, a reload and a link back", async ({ page }) => {
  const records = () => page.getByRole("button", { name: "Records" });
  await openMore(page);
  await page.getByRole("link", { name: /Progress/ }).first().click();
  await page.waitForURL(atPath("/more/metrics"));
  await records().click();
  await expect(records()).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/\/more\/metrics\?tab=records$/);
  // The tab is not a history step: Back still leaves Progress.
  await expect(back(page)).toHaveText("More");

  // Away through the bottom nav, then the platform's Back.
  await page.getByRole("link", { name: "Programs" }).click();
  await page.waitForURL(atPath("/programs"));
  await page.goBack();
  await page.waitForURL("**/more/metrics?tab=records");
  await expect(records()).toHaveAttribute("aria-pressed", "true");

  await page.reload();
  await expect(records()).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "All Time" }).click();
  await expect(page).toHaveURL(/\/more\/metrics$/);
});

test("a saved form does not stay in history: New season > Create > Back lands on Cycles", async ({ page }, testInfo) => {
  const settle = trackActions(page);
  await testDb().update(users).set({ enduranceEnabled: true }).where(eq(users.email, e2eUser(testInfo.parallelIndex).email));
  await page.goto("/cycles");
  await page.getByRole("link", { name: "New season" }).click();
  await page.waitForURL(atPath("/seasons/new"));
  await page.getByLabel("Name").fill("Back test");
  await page.getByLabel("Start").fill("2027-01-04");
  await page.getByLabel("End").fill("2027-05-02");
  await page.getByRole("button", { name: "Create season" }).click();
  await settle();
  await expect(page).toHaveURL(/\/seasons\/\d+$/);
  await expect(back(page)).toHaveText("Cycles");
  await back(page).click();
  await page.waitForURL(atPath("/cycles"));
  // The form is gone from history: forward is the season, not the form.
  await page.goForward();
  await expect(page).toHaveURL(/\/seasons\/\d+$/);
});

test("a deep link to a child, then Back twice, reaches the grandparent instead of looping", async ({ page }, testInfo) => {
  const user = await testDb().query.users.findFirst({ where: eq(users.email, e2eUser(testInfo.parallelIndex).email) });
  const [session] = await testDb()
    .select({ id: workoutSessions.id })
    .from(workoutSessions)
    .where(and(eq(workoutSessions.userId, user!.id), eq(workoutSessions.isCompleted, true)))
    .limit(1);
  await page.goto(`/history/${session.id}`);
  await expect(back(page)).toHaveText("History");
  await back(page).click();
  await page.waitForURL(atPath("/history"));
  // The parent replaced the child, so its own Back goes up, not back down.
  await expect(back(page)).toHaveText("More");
  await back(page).click();
  await page.waitForURL(atPath("/more"));
});

test("Edit season > Save returns to the season without a duplicate entry", async ({ page }, testInfo) => {
  const settle = trackActions(page);
  const email = e2eUser(testInfo.parallelIndex).email;
  await testDb().update(users).set({ enduranceEnabled: true }).where(eq(users.email, email));
  const user = await testDb().query.users.findFirst({ where: eq(users.email, email) });
  const [season] = await testDb()
    .insert(seasons)
    .values({ userId: user!.id, name: "Edit back test", startDate: "2027-01-04", endDate: "2027-05-02" })
    .returning({ id: seasons.id });
  await page.goto("/cycles");
  await page.getByRole("link", { name: /Edit back test/ }).click();
  await page.waitForURL(atPath(`/seasons/${season.id}`));
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  await page.waitForURL(atPath(`/seasons/${season.id}/edit`));
  await page.getByLabel("Name").fill("Edited back test");
  await page.getByRole("button", { name: "Save" }).click();
  await settle();
  await page.waitForURL(atPath(`/seasons/${season.id}`));
  await expect(page.getByRole("heading", { name: "Edited back test" })).toBeVisible();
  // The platform's Back (the iOS swipe) leaves the season, not a stale copy of it.
  await page.goBack();
  await page.waitForURL(atPath("/cycles"));
});

test("deleting a session returns to History, and Back does not reopen the deleted page", async ({ page }) => {
  const settle = trackActions(page);
  await openMore(page);
  await page.getByRole("link", { name: /History/ }).first().click();
  await page.waitForURL(atPath("/history"));
  const row = page.locator('a[href^="/history/"]').first();
  const href = (await row.getAttribute("href"))!;
  await row.click();
  await page.waitForURL(atPath(href));
  await page.getByRole("button", { name: "Delete workout", exact: true }).click();
  await page.getByRole("button", { name: "Delete Workout", exact: true }).click();
  await settle();
  await page.waitForURL(atPath("/history"));
  await expect(page.locator(`a[href="${href}"]`).filter({ visible: true })).toHaveCount(0);
  await page.goBack();
  await page.waitForURL(atPath("/more"));
});

test("adding an exercise mid-workout returns to the workout without leaving the picker behind", async ({ page }) => {
  await openWorkout(page);
  const workout = new URL(page.url()).pathname;
  await page.getByRole("button", { name: "Workout actions" }).click();
  await page.getByRole("link", { name: "Add Exercise" }).click();
  await page.waitForURL(atPath(`${workout}/add-exercise`));
  const added = await page.getByRole("listitem").first().locator("span").first().innerText();
  await page.getByRole("listitem").first().getByRole("button").click();
  await page.waitForURL(atPath(workout));
  // Popped back to the workout, and it shows the new exercise.
  await expect(page.getByRole("link", { name: new RegExp(added) }).filter({ visible: true }).first()).toBeVisible();
  // The platform's Back (the iOS swipe) must not reopen the picker.
  await page.goBack();
  await expect(page).not.toHaveURL(/\/add-exercise/);
});

test("a cold start on the exercise picker: Back goes to the workout, not out of the app", async ({ page }) => {
  await openWorkout(page);
  const workout = new URL(page.url()).pathname;
  const cold = await page.context().newPage();
  await cold.goto(`${workout}/add-exercise`);
  await cold.getByRole("button", { name: /^Back( to Workout)?$/ }).click();
  await cold.waitForURL(atPath(workout));
  await cold.close();
});

test("a cold start on the set editor: Save goes to the exercise, not out of the app", async ({ page }) => {
  await openWorkout(page);
  await openFirstExercise(page);
  const exercise = new URL(page.url()).pathname;
  await openFirstSetEditor(page);
  const editor = page.url();
  const cold = await page.context().newPage();
  await cold.goto(editor);
  await cold.getByRole("button", { name: /^Save$/ }).first().click();
  await cold.waitForURL(atPath(exercise));
  await cold.close();
});
