import { eq } from "drizzle-orm";
import { bodyMeasurements, users } from "../src/db/schema";
import { e2eUser } from "./fixtures/env";
import { testDb } from "./fixtures/reset";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { trackActions } from "./helpers";

/**
 * Body measurements (docs/plans/body-measurements.md): open from Account, log
 * a few parts in the step flow with a Skip, read them back on the summary and
 * delete one on its part page.
 */

async function userId(parallelIndex: number) {
  const [user] = await testDb().select({ id: users.id }).from(users).where(eq(users.email, e2eUser(parallelIndex).email));
  return user.id;
}

const rowsOf = (uid: string) =>
  testDb()
    .select({ site: bodyMeasurements.site, side: bodyMeasurements.side, valueCm: bodyMeasurements.valueCm, measuredOn: bodyMeasurements.measuredOn })
    .from(bodyMeasurements)
    .where(eq(bodyMeasurements.userId, uid));

test("log measurements step by step, read them back and delete one", async ({ page }, testInfo) => {
  const settle = trackActions(page);
  const uid = await userId(testInfo.parallelIndex);

  await page.goto("/more/account/body-and-health");
  await expect(page.getByTestId("account-measurements")).toContainText("Not set");
  await page.getByTestId("account-measurements").click();
  await page.waitForURL("**/more/account/measurements");
  await expect(page.getByTestId("measurements-empty")).toBeVisible();
  // The empty page shows the whole body map, so the parts can be seen before the first log.
  await expect(page.getByTestId("map-point-waist")).toBeVisible();
  await page.getByRole("link", { name: "Log measurements" }).click();
  await page.waitForURL("**/more/account/measurements/log");

  // A first log has the 13 circumference steps and the 3 lengths. Log an old date.
  await expect(page.getByTestId("step-count")).toHaveText("1 of 16");
  await page.getByLabel("Log date").fill("2026-10-01");
  await expect(page.getByText("1 Oct ›")).toBeVisible();
  await page.getByRole("textbox", { name: "Neck in cm" }).fill("39");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await settle();

  await expect(page.getByTestId("step-count")).toHaveText("2 of 16");
  // Back goes to the previous step with its saved value; Cancel stays reachable.
  await expect(page.getByRole("link", { name: "Cancel" })).toBeVisible();
  await page.getByRole("button", { name: "Back to the previous step" }).click();
  await expect(page.getByTestId("step-count")).toHaveText("1 of 16");
  await expect(page.getByRole("textbox", { name: "Neck in cm" })).toHaveValue("39.0");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await settle();
  await expect(page.getByTestId("step-count")).toHaveText("2 of 16");
  await page.getByRole("button", { name: "Skip", exact: true }).click();

  // Next on the keypad (Enter) goes on as well.
  await page.getByRole("textbox", { name: "Chest in cm" }).fill("110.5");
  await page.getByRole("textbox", { name: "Chest in cm" }).press("Enter");
  await settle();
  await expect(page.getByTestId("step-count")).toHaveText("4 of 16");

  for (let n = 4; n <= 5; n++) await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Upper arm · right" })).toBeVisible();
  await page.getByRole("textbox", { name: "Upper arm · right in cm" }).fill("36.5");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await settle();
  for (let n = 7; n <= 16; n++) {
    await expect(page.getByTestId("step-count")).toHaveText(`${n} of 16`);
    await page.getByRole("button", { name: "Skip", exact: true }).click();
  }

  await expect(page.getByTestId("measure-done")).toBeVisible();
  await expect(page.getByText("3 of 16 values · 13 skipped")).toBeVisible();
  await expect(page.getByTestId("done-row-shoulders")).toContainText("Skipped");

  // Tap a value to correct it.
  await page.getByTestId("done-row-neck").click();
  // The field has the focus, so the keypad opens with the sheet.
  await expect(page.getByRole("textbox", { name: "Neck in cm" })).toBeFocused();
  await expectBigField(page.getByRole("textbox", { name: "Neck in cm" }), 16);
  await page.getByRole("textbox", { name: "Neck in cm" }).fill("38.5");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await settle();
  await expect(page.getByTestId("done-row-neck")).toContainText("38.5 cm");

  expect((await rowsOf(uid)).sort((a, b) => a.site.localeCompare(b.site))).toEqual([
    { site: "chest", side: "none", valueCm: 110.5, measuredOn: "2026-10-01" },
    { site: "neck", side: "none", valueCm: 38.5, measuredOn: "2026-10-01" },
    { site: "upper-arm", side: "right", valueCm: 36.5, measuredOn: "2026-10-01" },
  ]);

  await page.getByRole("link", { name: "Done" }).click();
  await page.waitForURL("**/more/account/measurements");
  await expect(page.getByTestId("measurement-row-neck")).toContainText("38.5 cm");
  await expect(page.getByTestId("measurement-row-upper-arm")).toContainText("R 36.5");
  await expect(page.getByTestId("next-log")).toHaveText("Next log from 15 Oct · every 2 to 4 weeks");

  await page.getByTestId("measurement-row-neck").click();
  await page.waitForURL("**/more/account/measurements/neck");
  await expect(page.getByTestId("measure-guide")).toContainText("Adam's apple");
  // Delete takes two taps: the first turns the button into Confirm.
  await page.getByRole("button", { name: "Delete 1 Oct" }).click();
  await expect(page.getByRole("button", { name: "Confirm delete 1 Oct" })).toHaveText("Confirm");
  await settle();
  expect((await rowsOf(uid)).map((r) => r.site).sort()).toEqual(["chest", "neck", "upper-arm"]);
  await page.getByRole("button", { name: "Confirm delete 1 Oct" }).click();
  await settle();
  await expect(page.getByText("No values yet")).toBeVisible();
  expect((await rowsOf(uid)).map((r) => r.site).sort()).toEqual(["chest", "upper-arm"]);
});

/** A field the keypad types into: big enough to read and tap. */
async function expectBigField(field: Locator, fontPx: number) {
  const style = await field.evaluate((el) => ({ font: getComputedStyle(el).fontSize, height: el.getBoundingClientRect().height }));
  expect(style.font).toBe(`${fontPx}px`);
  expect(style.height).toBeGreaterThanOrEqual(44);
}

/**
 * Stands in for the phone keypad: a visualViewport whose height the test sets.
 * The keypad shrinks only the visual viewport (interactiveWidget "resizes-visual").
 */
async function fakeKeypad(page: Page) {
  await page.addInitScript(() => {
    let keypad = 0;
    const vv = new EventTarget();
    const fields: Record<string, () => number> = {
      height: () => window.innerHeight - keypad,
      width: () => window.innerWidth,
      offsetTop: () => 0,
      offsetLeft: () => 0,
      pageTop: () => window.scrollY,
      pageLeft: () => window.scrollX,
      scale: () => 1,
    };
    for (const [key, get] of Object.entries(fields)) {
      Object.defineProperty(vv, key, { get });
    }
    Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
    (window as unknown as { setKeypad: (px: number) => void }).setKeypad = (px) => {
      keypad = px;
      vv.dispatchEvent(new Event("resize"));
    };
  });
  return (px: number) => page.evaluate((v) => (window as unknown as { setKeypad: (px: number) => void }).setKeypad(v), px);
}

/** Where the bottom of `el` is, from the top of the screen. */
const bottomOf = async (el: Locator) => {
  const box = await el.boundingBox();
  return box!.y + box!.height;
};

test("a step fits the screen with the keypad open and starts from the right value", async ({ page }, testInfo) => {
  const uid = await userId(testInfo.parallelIndex);
  await testDb()
    .insert(bodyMeasurements)
    .values([
      { userId: uid, site: "neck", side: "none", valueCm: 40, measuredOn: "2026-09-01" },
      { userId: uid, site: "neck", side: "none", valueCm: 39, measuredOn: "2026-10-15" },
    ]);
  const setKeypad = await fakeKeypad(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/more/account/measurements/log");
  await expect(page.getByTestId("step-count")).toHaveText("1 of 16");

  const neck = page.getByRole("textbox", { name: "Neck in cm" });
  const next = page.getByRole("button", { name: "Next", exact: true });
  const figure = page.getByRole("img", { name: /Where to measure/ }).locator("svg").first();

  // The value is big: 36 px, not the 16 px all fields get in globals.css.
  await expectBigField(neck, 36);

  // The step starts from the latest value before the log date, also after the date changes.
  await expect(neck).toHaveValue("39.0");
  await page.getByLabel("Log date").fill("2026-10-01");
  await expect(neck).toHaveValue("40.0");

  // Closing the guide gives the focus back to the field, so the keypad stays open.
  await page.getByRole("button", { name: "How to measure ›" }).click();
  await expect(page.getByTestId("measure-guide")).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(neck).toBeFocused();

  // With the keypad closed the figures keep their full size: half the card each.
  const full = (await figure.boundingBox())!;
  expect(full.height).toBeGreaterThan(300);
  expect(await bottomOf(next)).toBeLessThanOrEqual(844);

  // The keypad covers about the bottom 300 px: the field and Next stay above it.
  await setKeypad(300);
  await expect.poll(() => bottomOf(next)).toBeLessThanOrEqual(544);
  expect(await bottomOf(neck)).toBeLessThanOrEqual(544);
  await setKeypad(0);
  await expect.poll(async () => (await figure.boundingBox())!.height).toBeCloseTo(full.height, 0);

  // The field does not move from step to step: the where line is always two lines high.
  const fieldTop = (await neck.boundingBox())!.y;
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  const shoulders = page.getByRole("textbox", { name: "Shoulders in cm" });
  await expect(shoulders).toBeVisible();
  expect((await shoulders.boundingBox())!.y).toBeCloseTo(fieldTop, 0);
  // The step is a fixed full screen: after the guide sheet the header is still at the top.
  expect((await page.getByTestId("measure-step").boundingBox())!.y).toBe(0);
  // No last value: no Same button.
  await expect(page.getByRole("button", { name: "Same", exact: true })).toHaveCount(0);

  // A small phone: Next fits with no keypad and with the keypad.
  await page.setViewportSize({ width: 320, height: 568 });
  await expect.poll(() => bottomOf(next)).toBeLessThanOrEqual(568);
  await setKeypad(260);
  await expect.poll(() => bottomOf(next)).toBeLessThanOrEqual(308);
  expect(await bottomOf(shoulders)).toBeLessThanOrEqual(308);
  await setKeypad(0);

  // While a save runs, Next says so.
  let release = () => {};
  const held = new Promise<void>((r) => (release = r));
  await page.route("**/*", async (route) => {
    const req = route.request();
    if (req.method() !== "POST" || !req.headers()["next-action"]) return route.continue();
    await held;
    return route.continue();
  });
  await shoulders.fill("120");
  await next.click();
  await expect(page.getByRole("button", { name: "Saving…" })).toBeDisabled();
  release();
  await expect(page.getByTestId("step-count")).toHaveText("3 of 16");
});
