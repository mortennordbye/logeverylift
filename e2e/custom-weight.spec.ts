import { and, eq } from "drizzle-orm";
import type { Locator, Page } from "@playwright/test";
import { customWeightUsage, exercises, programExercises, programs, users } from "../src/db/schema";
import { e2eUser } from "./fixtures/env";
import { testDb } from "./fixtures/reset";
import { expect, test } from "./fixtures/test";
import { openFirstExercise, openFirstSetEditor, openWorkout, trackActions, waitForLiveSession } from "./helpers";

/**
 * A typed-in weight gets a circle of its own (withCustomOption) and is
 * recorded for the admin Insights (logCustomWeight). The unit tests cover the
 * list; this is the sheet under a thumb: the list follows each digit, the row
 * comes back to the typed circle on blur, and the save lands in
 * custom_weight_usage and on the Insights page.
 *
 * 18 on a barbell is not a preset (2.5 kg steps), so before the custom circle
 * the 17.5 circle lit up instead.
 */

/** Puts a barbell exercise of this account's own on the first slot, and opens its set list. */
async function ownBarbellExercise(page: Page) {
  const db = testDb();
  // Exercise names are unique across users, and workers run side by side.
  const name = `Custom Weight Spec Press ${Date.now()}-${test.info().workerIndex}-${test.info().repeatEachIndex}`;
  await openWorkout(page);
  await openFirstExercise(page);
  await waitForLiveSession(page);
  const [, programId, slotId] = page.url().match(/\/programs\/(\d+)\/workout\/exercises\/(\d+)/)!.map(Number);
  const [{ userId }] = await db.select({ userId: programs.userId }).from(programs).where(eq(programs.id, programId));
  const [exercise] = await db
    .insert(exercises)
    .values({ name, category: "strength", equipment: "barbell", userId })
    .returning({ id: exercises.id });
  await db
    .update(programExercises)
    .set({ exerciseId: exercise.id, weightStack: null })
    .where(eq(programExercises.id, slotId));
  await page.reload();
  await waitForLiveSession(page);
  return { name, userId: userId!, exerciseId: exercise.id, exerciseUrl: page.url() };
}

/**
 * The circle sits in the middle of its scroll row. The editors centre a circle
 * together with the gap after it, so it lands up to half a gap (4 px) right of
 * the middle.
 */
async function expectCentred(circle: Locator) {
  const row = circle.locator("..");
  await expect
    .poll(async () => {
      const [c, r] = await Promise.all([circle.boundingBox(), row.boundingBox()]);
      if (!c || !r) return Infinity;
      return Math.abs(c.x + c.width / 2 - (r.x + r.width / 2));
    })
    .toBeLessThanOrEqual(5);
}

async function usage(userId: string, exerciseId: number) {
  return testDb()
    .select({ weightKg: customWeightUsage.weightKg })
    .from(customWeightUsage)
    .where(and(eq(customWeightUsage.userId, userId), eq(customWeightUsage.exerciseId, exerciseId)));
}

// The narrow phone width the journey reviews use.
test.use({ viewport: { width: 390, height: 844 } });

test.afterEach(async ({}, testInfo) => {
  await testDb().update(users).set({ role: "user" }).where(eq(users.email, e2eUser(testInfo.parallelIndex).email));
});

test("set editor: typing 18 gives it a lit circle, saving records it, and Insights shows it", async ({ page, context }) => {
  const { name, userId, exerciseId } = await ownBarbellExercise(page);
  await openFirstSetEditor(page);
  await page.getByRole("button", { name: /^Weight \(kg\)/ }).click();
  const sheet = page.getByRole("dialog");
  const input = sheet.getByRole("textbox");

  // The list follows each digit as it lands.
  await input.fill("");
  await input.pressSequentially("1");
  await expect(sheet.getByRole("button", { name: "1 custom", exact: true })).toBeVisible();
  await input.pressSequentially("8");
  await expect(sheet.getByRole("button", { name: "1 custom", exact: true })).toHaveCount(0);
  const circle = sheet.getByRole("button", { name: "18 custom", exact: true });
  await expect(circle).toHaveAttribute("aria-pressed", "true");
  await expect(sheet.getByRole("button", { name: "17.5 kg", exact: true })).toHaveAttribute("aria-pressed", "false");

  // On blur the row comes back to the typed circle.
  await input.blur();
  await expectCentred(circle);
  await expect(circle).toBeInViewport();

  await sheet.getByRole("button", { name: "Done", exact: true }).click();
  const settle = trackActions(page);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page).toHaveURL(/\/exercises\/\d+$/);
  await settle();
  await expect.poll(() => usage(userId, exerciseId)).toEqual([{ weightKg: 18 }]);

  // The admin Insights page reads the row back.
  await testDb().update(users).set({ role: "admin" }).where(eq(users.id, userId));
  // Better Auth caches the session, role included, in a cookie for 5 minutes; drop it so the new role is read.
  await context.clearCookies({ name: /session_data/ });
  await page.goto("/more/admin/insights");
  const section = page.locator("section").filter({ has: page.getByRole("heading", { name: "Custom Weights" }) });
  const entry = section.getByText(name, { exact: true }).locator("../..");
  await expect(entry).toContainText("1 use · 1 user");
  await expect(entry).toContainText("18 kg ×1");
});

test("new set: typing 18 on the keypad gives it a lit circle, and saving records it", async ({ page }) => {
  const { userId, exerciseId, exerciseUrl } = await ownBarbellExercise(page);
  await page.goto(`${exerciseUrl}/sets/new`);
  await page.getByRole("button", { name: /^Weight \(kg\)/ }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: "Keypad", exact: true }).click();
  const input = sheet.getByRole("textbox");

  await input.fill("");
  await input.pressSequentially("1");
  await expect(sheet.getByRole("button", { name: "1", exact: true })).toBeVisible();
  await input.pressSequentially("8");
  await expect(sheet.getByRole("button", { name: "1", exact: true })).toHaveCount(0);
  const circle = sheet.getByRole("button", { name: "18", exact: true });
  await expect(circle).toHaveAttribute("aria-pressed", "true");
  await expect(sheet.getByRole("button", { name: "17.5", exact: true })).toHaveAttribute("aria-pressed", "false");

  await input.blur();
  await expectCentred(circle);
  await expect(circle).toBeInViewport();

  await page.keyboard.press("Escape");
  const settle = trackActions(page);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page).toHaveURL(/\/exercises\/\d+\?edit=true$/);
  await settle();
  await expect.poll(() => usage(userId, exerciseId)).toEqual([{ weightKg: 18 }]);
});
