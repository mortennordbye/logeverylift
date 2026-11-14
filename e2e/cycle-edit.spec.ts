import { eq } from "drizzle-orm";
import { trainingCycles, users } from "../src/db/schema";
import { e2eUser } from "./fixtures/env";
import { testDb } from "./fixtures/reset";
import { expect, test } from "./fixtures/test";
import { trackActions } from "./helpers";

/**
 * Edit details of a cycle (docs/plans/plan-tab-redesign.md): the Plan form
 * saves a new name and end, returns to the cycle, and the history says what
 * changed in plain sentences.
 */

async function draftCycle(parallelIndex: number, name = "Edit block") {
  const db = testDb();
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, e2eUser(parallelIndex).email));
  const [cycle] = await db
    .insert(trainingCycles)
    .values({ userId: user.id, name, durationWeeks: 8, status: "draft", scheduleType: "rotation" })
    .returning();
  return cycle.id;
}

test("Edit details saves the name and the end, and the history says so in sentences", async ({ page }, testInfo) => {
  const settle = trackActions(page);
  const id = await draftCycle(testInfo.parallelIndex);

  await page.goto(`/cycles/${id}/edit`);
  await expect(page.getByRole("heading", { level: 1, name: "Edit cycle" })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Rotation/ })).toBeChecked();
  await expect(page.getByRole("radio", { name: /Rotation/ })).toBeDisabled();
  // A form screen shows its pinned Save bar, not the tab bar under it.
  await expect(page.getByRole("link", { name: "Programs" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("edit-details.png"), fullPage: true });

  // The chip turns on only once React runs, so the name typed next is not lost to hydration.
  await expect(async () => {
    await page.getByRole("button", { name: "Rest period" }).click();
    await expect(page.getByRole("button", { name: "Rest period" })).toHaveAttribute("aria-pressed", "true", { timeout: 1_000 });
  }).toPass();
  await page.getByLabel("Name").fill("Edited block");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await settle();
  await page.waitForURL(new RegExp(`/cycles/${id}$`));
  await expect
    .poll(async () => (await testDb().select({ name: trainingCycles.name, endAction: trainingCycles.endAction }).from(trainingCycles).where(eq(trainingCycles.id, id)))[0])
    .toEqual({ name: "Edited block", endAction: "rest" });

  await page.goto(`/cycles/${id}/history`);
  await expect(page.getByText("Name changed from Edit block to Edited block", { exact: true })).toBeVisible();
  await expect(page.getByText("When it ends changed from Just stop to Rest period", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("cycle-history.png"), fullPage: true });
});

test("Edit cycle has the form header of New cycle: Cancel, the title centred, whatever the cycle's name", async ({ page }, testInfo) => {
  const id = await draftCycle(testInfo.parallelIndex, "Base block with three sessions on Wednesdays and a long easy ride every Saturday morning");
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`/cycles/${id}/edit`);
    const title = page.getByRole("heading", { level: 1, name: "Edit cycle" });
    await expect(title).toBeVisible();
    const cancel = (await page.getByTestId("form-header").getByRole("button", { name: "Cancel" }).boundingBox())!;
    const heading = (await title.boundingBox())!;
    expect(cancel.x + cancel.width, `Cancel ends before the title at ${width} px`).toBeLessThanOrEqual(heading.x);
    // The title stays in the middle of the row, as on the other form screens.
    expect(Math.abs(heading.x + heading.width / 2 - width / 2), `title centred at ${width} px`).toBeLessThanOrEqual(2);
    await page.screenshot({ path: testInfo.outputPath(`edit-header-${width}.png`) });
  }
});
