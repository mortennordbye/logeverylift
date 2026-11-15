import type { Locator, Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { athleteProfiles, seasons, trainingCycles, users } from "../src/db/schema";
import { e2eUser } from "./fixtures/env";
import { testDb } from "./fixtures/reset";
import { expect, test } from "./fixtures/test";
import { stableBox } from "./helpers";

/**
 * Repeated taps on a slow network make one row. A Plan form keeps its submit
 * busy from the first tap until the next page is on screen, and a second tap
 * that lands before the button re-renders does nothing.
 */

const isoDay = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Holds each Server Action response and each page load 1.5 s: a slow network. */
async function slowNetwork(page: Page) {
  await page.route("**/*", async (route) => {
    const req = route.request();
    const headers = req.headers();
    const action = req.method() === "POST" && Boolean(headers["next-action"]);
    const navigation = headers["rsc"] === "1" && !headers["next-router-prefetch"];
    if (!action && !navigation) return route.continue();
    const response = await route.fetch();
    await new Promise((r) => setTimeout(r, 1500));
    return route.fulfill({ response });
  });
}

/** Taps where `button` is every 250 ms, as long as the page is still on `path`. */
async function tapUntilLeft(page: Page, button: Locator, path: RegExp) {
  // A sheet slides up: tap where its button comes to rest.
  const box = await stableBox(button);
  for (let i = 0; i < 20 && path.test(new URL(page.url()).pathname); i++) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    // Taps a person makes on a slow network: the gap is the point of the test.
    // eslint-disable-next-line no-restricted-syntax
    await page.waitForTimeout(250);
  }
}

/** Types the phase name once the form has hydrated: a fill before that is lost. */
async function namePhase(page: Page, name: string) {
  await expect(async () => {
    await page.getByLabel("Name", { exact: true }).fill(name);
    await expect(page.getByRole("button", { name: "Build the week" })).toBeEnabled({ timeout: 500 });
  }).toPass();
}

async function userId(index: number) {
  const [user] = await testDb().select({ id: users.id }).from(users).where(eq(users.email, e2eUser(index).email));
  return user.id;
}

test("New season makes one season when Create season is tapped again and again", async ({ page }, testInfo) => {
  const id = await userId(testInfo.parallelIndex);
  await page.goto("/seasons/new");
  // The date field shows only once the form has hydrated, so later typing sticks.
  await page.getByRole("button", { name: "Change start" }).click();
  await page.getByLabel("Start date").fill(isoDay(0));
  await page.getByLabel("Name", { exact: true }).fill("Tap season");
  await page.getByRole("button", { name: "Change end" }).click();
  await page.getByLabel("End date").fill(isoDay(60));
  await slowNetwork(page);
  await tapUntilLeft(page, page.getByRole("button", { name: "Create season" }), /^\/seasons\/new$/);
  await expect(page).toHaveURL(/\/seasons\/\d+$/);
  await expect(page.getByRole("heading", { name: "Tap season" })).toBeVisible();
  expect(await testDb().select().from(seasons).where(eq(seasons.userId, id))).toHaveLength(1);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("a triathlon plan confirmed again and again makes one season with five phases", async ({ page }, testInfo) => {
  const id = await userId(testInfo.parallelIndex);
  await testDb().update(users).set({ enduranceEnabled: true }).where(eq(users.id, id));
  const ready = { enduranceLevel: "intermediate" as const, availableDays: [1, 2, 3, 4, 7] };
  await testDb().insert(athleteProfiles).values({ userId: id, ...ready }).onConflictDoUpdate({ target: athleteProfiles.userId, set: ready });
  await page.goto("/seasons/new?plan=triathlon");
  await page.getByRole("button", { name: "Change start" }).click();
  // A start after today takes the seeded running cycle's place: the confirm sheet asks first.
  await page.getByLabel("Start date").fill(isoDay(1));
  await page.getByLabel("Name", { exact: true }).fill("Tap tri");
  await page.getByLabel("Race name").fill("Tap race");
  await page.getByLabel("Race date").fill(isoDay(200));
  await page.getByRole("button", { name: "Create season" }).click();
  const confirm = page.getByRole("region", { name: /^Start this season/ });
  await expect(confirm).toBeVisible();
  await slowNetwork(page);
  await tapUntilLeft(page, confirm.getByRole("button", { name: "Create season" }), /^\/seasons\/new$/);
  await expect(page).toHaveURL(/\/seasons\/\d+$/);
  await expect(page.getByRole("heading", { name: "Tap tri" })).toBeVisible();
  const made = await testDb().select().from(seasons).where(eq(seasons.userId, id));
  expect(made).toHaveLength(1);
  expect(await testDb().select().from(trainingCycles).where(eq(trainingCycles.seasonId, made[0].id))).toHaveLength(5);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("Build the week makes one phase, on a slow network and on three fast clicks", async ({ page }, testInfo) => {
  const id = await userId(testInfo.parallelIndex);
  const [season] = await testDb().insert(seasons).values({ userId: id, name: "Tap phases", startDate: isoDay(0), endDate: isoDay(120) }).returning();
  const phases = () => testDb().select().from(trainingCycles).where(and(eq(trainingCycles.userId, id), eq(trainingCycles.seasonId, season.id)));

  await page.goto(`/seasons/${season.id}/phases/new`);
  await namePhase(page, "Slow phase");
  await slowNetwork(page);
  await tapUntilLeft(page, page.getByRole("button", { name: "Build the week" }), /\/phases\/new$/);
  await expect(page).toHaveURL(/\/phases\/\d+\/week$/);
  await expect(page.getByText("Step 2 of 2")).toBeVisible();
  expect(await phases()).toHaveLength(1);
  await page.unrouteAll({ behavior: "ignoreErrors" });

  // Three clicks before React re-renders the button: no network delay.
  await testDb().delete(trainingCycles).where(eq(trainingCycles.seasonId, season.id));
  await page.goto(`/seasons/${season.id}/phases/new`);
  await namePhase(page, "Fast phase");
  const box = await stableBox(page.getByRole("button", { name: "Build the week" }));
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
  await Promise.all([page.mouse.click(x, y), page.mouse.click(x, y), page.mouse.click(x, y)]);
  await expect(page).toHaveURL(/\/phases\/\d+\/week$/);
  await expect(page.getByText("Step 2 of 2")).toBeVisible();
  expect(await phases()).toHaveLength(1);
});
