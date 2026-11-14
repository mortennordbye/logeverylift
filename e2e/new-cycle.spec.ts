import type { Locator, Page } from "@playwright/test";
import { asc, eq } from "drizzle-orm";
import { programs, trainingCycleSlots, trainingCycles, users } from "../src/db/schema";
import { e2eUser } from "./fixtures/env";
import { testDb } from "./fixtures/reset";
import { expect, test } from "./fixtures/test";
import { stableBox, trackActions } from "./helpers";

/**
 * The new cycle setup (docs/plans/plan-tab-redesign.md, P3): a rotation is put
 * in order by drag and by Move up, and Cancel on step 2 discards the draft.
 */

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

/** The rotation's labels in their saved order. */
async function savedOrder(cycleId: number) {
  const rows = await testDb()
    .select({ label: trainingCycleSlots.label })
    .from(trainingCycleSlots)
    .where(eq(trainingCycleSlots.trainingCycleId, cycleId))
    .orderBy(asc(trainingCycleSlots.orderIndex));
  return rows.map((r) => r.label);
}

test("a new rotation is reordered by drag and Move up, and Cancel discards it", async ({ page }, testInfo) => {
  const settle = trackActions(page);
  const [user] = await testDb().select({ id: users.id }).from(users).where(eq(users.email, e2eUser(testInfo.parallelIndex).email));
  // Names no seeded program shares, so each picks one row.
  await testDb().insert(programs).values(["Zed one", "Zed two", "Zed three"].map((name) => ({ userId: user.id, name })));

  await page.goto("/cycles/new");
  // A chip only shows as pressed once React runs, so typing after it sticks (WebKit hydrates late and would reset the name).
  await page.getByRole("button", { name: "6 weeks" }).click();
  await expect(page.getByRole("button", { name: "6 weeks" })).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Name").fill("PPL rotation");
  await page.getByText("Rotation", { exact: true }).click();
  await page.getByRole("button", { name: "Put the sessions in order" }).click();
  await settle();
  await expect(page.getByRole("heading", { name: "Rotation order" })).toBeVisible();
  const cycleId = Number(new URL(page.url()).searchParams.get("cycle"));
  // No session yet: Create cycle is off and says why.
  await expect(page.getByRole("button", { name: "Create cycle" })).toBeDisabled();
  await expect(page.getByText("Add a session first.")).toBeVisible();

  for (const name of ["Zed one", "Zed two", "Zed three"]) {
    await page.getByRole("button", { name: "+ Add session" }).click();
    await page.getByRole("region", { name: "Pick a program" }).getByRole("button", { name: new RegExp(`^${name} `) }).click();
    await settle();
    await expect(page.getByRole("button", { name: `Reorder ${name}` })).toBeVisible();
  }
  expect(await savedOrder(cycleId)).toEqual(["Zed one", "Zed two", "Zed three"]);

  // The last session to the top: every slot moves one place, which the unique order index refused.
  await drag(page, page.getByRole("button", { name: "Reorder Zed three" }), page.getByRole("button", { name: "Reorder Zed one" }));
  await settle();
  await expect.poll(() => savedOrder(cycleId)).toEqual(["Zed three", "Zed one", "Zed two"]);
  await expect(page.getByText("Failed to reorder the slots")).toHaveCount(0);

  await page.getByRole("button", { name: "Options for Zed two" }).click();
  await page.getByRole("button", { name: "Move up" }).click();
  await settle();
  await expect.poll(() => savedOrder(cycleId)).toEqual(["Zed three", "Zed two", "Zed one"]);
  // The options sheet closes with the shared Close button, as every Plan sheet does.
  await page.getByRole("region", { name: "Zed two" }).getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("region", { name: "Zed two" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Create cycle" })).toBeEnabled();

  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("region", { name: "Discard this cycle?" }).getByRole("button", { name: "Discard cycle" }).click();
  await settle();
  await expect(page).toHaveURL(/\/cycles$/);
  const [cycle] = await testDb().select({ deletedAt: trainingCycles.deletedAt }).from(trainingCycles).where(eq(trainingCycles.id, cycleId));
  expect(cycle.deletedAt).not.toBeNull();
});
