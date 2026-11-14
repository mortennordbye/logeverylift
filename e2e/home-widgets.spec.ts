import { eq } from "drizzle-orm";
import { users } from "../src/db/schema";
import type { StoredHomeLayout } from "../src/lib/home/stored-layout";
import { WIDGETS, widgetDef, type WidgetId } from "../src/lib/home/widgets";
import { SIZE_LABEL } from "../src/lib/home/widgets/types";
import { e2eUser } from "./fixtures/env";
import { testDb } from "./fixtures/reset";
import { expect, test } from "./fixtures/test";

// Edit mode jiggles the widgets, and Playwright waits for an element to stop
// moving before it clicks. The jiggle has its own test, with motion on.
test.use({ contextOptions: { reducedMotion: "reduce" } });
import { trackActions } from "./helpers";

/**
 * E5 in docs/home-widgets-audit.md, section 7: every widget the e2e user can
 * have, added from the gallery and shown at each of its sizes, renders with
 * no console error and persists across a reload. It loops over the registry,
 * so a new widget is covered without a new spec. Garmin readiness is for
 * admin accounts only and must not be offered here.
 */

const AUDIENCE = { endurance: false, garmin: false, cycle: true };
/** Widgets the default home hides, which the gallery offers. */
const ADDABLE = (Object.keys(WIDGETS) as WidgetId[]).filter((id) => {
  const def = widgetDef(id);
  return def.kind === "widget" && def.available(AUDIENCE) && !def.defaultVisible(AUDIENCE);
});
const ROUNDS = Math.max(...ADDABLE.map((id) => widgetDef(id).sizes.length));
const sizeIn = (id: WidgetId, round: number) => {
  const sizes = widgetDef(id).sizes;
  return sizes[Math.min(round, sizes.length - 1)];
};

test("every available widget, at every size, from the gallery", async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    // Linux WebKit (CI) reports the app-wide viewport meta's `interactive-widget` key as a
    // console error; it is not from the home, as in consent.spec.ts.
    if (msg.type() === "error" && !msg.text().includes('"interactive-widget" not recognized')) consoleErrors.push(msg.text());
  });
  const user = await testDb().query.users.findFirst({ where: eq(users.email, e2eUser(testInfo.parallelIndex).email) });
  const layout = async () =>
    (await testDb().select({ l: users.homeLayout }).from(users).where(eq(users.id, user!.id)))[0].l as StoredHomeLayout | null;

  await page.goto("/");
  await page.getByRole("button", { name: "Edit home" }).click();
  await page.getByRole("button", { name: "Add widget" }).click();
  const gallery = page.getByTestId("widget-gallery");
  await expect(gallery).toBeVisible();
  await expect(gallery.getByTestId("gallery-item")).toHaveCount(ADDABLE.length);
  await expect(gallery.getByText("Garmin readiness")).toHaveCount(0);
  for (const [n, id] of ADDABLE.entries()) {
    if (n > 0) await page.getByRole("button", { name: "Add widget" }).click();
    await gallery.getByRole("button", { name: `Add ${widgetDef(id).title}` }).click();
    await expect(page.locator(`[data-edit-tile="${id}"]`)).toBeVisible();
  }

  for (let round = 0; round < ROUNDS; round++) {
    if (round > 0) await page.getByRole("button", { name: "Edit home" }).click();
    for (const id of ADDABLE) {
      if (widgetDef(id).sizes.length < 2) continue;
      await page.locator(`[data-edit-tile="${id}"] [data-control="tile"]`).click();
      const sheet = page.getByTestId("widget-sheet");
      await sheet.getByRole("button", { name: SIZE_LABEL[sizeIn(id, round)], exact: true }).click();
      await sheet.getByRole("button", { name: "Close" }).click();
      await expect(sheet).toBeHidden();
    }
    const settle = trackActions(page);
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByTestId("home-edit-grid")).toBeHidden();
    await settle();
    await expect
      .poll(async () => (await layout())?.items.filter((i) => ADDABLE.includes(i.id as WidgetId)).map((i) => [i.id, i.size, i.hidden]))
      .toEqual(ADDABLE.map((id) => [id, sizeIn(id, round), false]));

    await page.reload();
    await expect(page.getByTestId("home-title")).toBeVisible();
    for (const id of ADDABLE) await expect(page.locator(`[data-widget="${id}"]`)).toBeVisible();
    // Streamed widgets settle: no skeleton left, and none failed.
    await expect(page.getByTestId("widget-skeleton")).toHaveCount(0);
    await expect(page.getByTestId("widget-error")).toHaveCount(0);
  }

  expect(consoleErrors).toEqual([]);
});
