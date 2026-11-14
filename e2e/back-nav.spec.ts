import type { Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { exercisePrs, exercises, users } from "../src/db/schema";
import type { StoredHomeItem } from "../src/lib/home/stored-layout";
import { e2eUser } from "./fixtures/env";
import { testDb } from "./fixtures/reset";
import { expect, test } from "./fixtures/test";
import { backLink, trackActions } from "./helpers";

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
