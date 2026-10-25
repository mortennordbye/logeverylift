import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { friendships, gyms, users } from "../src/db/schema";
import { e2eUser } from "./fixtures/env";
import { testDb } from "./fixtures/reset";
import { expect, test } from "./fixtures/test";

test("the gym map lists who trains there, and a member can be added or the gym removed", async ({ page }, testInfo) => {
  const db = testDb();
  const [me] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, e2eUser(testInfo.parallelIndex).email));
  const [gym] = await db
    .insert(gyms)
    .values({ osmRef: `node/${Date.now()}${testInfo.parallelIndex}`, name: `E2E Gym ${testInfo.parallelIndex}`, lat: 59.93 + testInfo.parallelIndex * 0.05, lng: 10.71, address: "Testveien 1" })
    .returning();
  const strangerId = `e2e-gym-${randomUUID()}`;
  const now = new Date();
  await db.insert(users).values({
    id: strangerId,
    name: `Gym Stranger ${testInfo.parallelIndex}`,
    email: `${strangerId}@test.local`,
    createdAt: now,
    updatedAt: now,
    primaryGymId: gym.id,
  });
  await db.update(users).set({ primaryGymId: gym.id }).where(eq(users.id, me.id));

  try {
    // MapLibre reports a worker it can't load as a console error, not a page
    // error, and the pins still render; catch it here.
    const consoleErrors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });
    // Each worker's gym sits apart from the others', so its pin is the one under the click.
    await page.goto("/more/gyms");
    await page.getByRole("button", { name: `${gym.name}, 2 members` }).click();
    expect(consoleErrors.filter((e) => /worker/i.test(e))).toEqual([]);
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("heading", { name: gym.name })).toBeVisible();
    await expect(sheet.getByText("You", { exact: true })).toBeVisible();

    await sheet.getByRole("button", { name: `Add Gym Stranger ${testInfo.parallelIndex} as a friend` }).click();
    await expect(sheet.getByText("Requested")).toBeVisible();
    await expect
      .poll(async () =>
        (await db.select().from(friendships).where(and(eq(friendships.requesterId, me.id), eq(friendships.addresseeId, strangerId)))).length,
      )
      .toBe(1);

    await page.goto("/more/account/gym");
    await page.getByRole("button", { name: "Remove my gym" }).click();
    await page.waitForURL("**/more/account");
    await expect(page.getByText("Not set · you're not on the gym map")).toBeVisible();
    const [after] = await db.select({ gym: users.primaryGymId }).from(users).where(eq(users.id, me.id));
    expect(after.gym).toBeNull();
  } finally {
    await db.delete(users).where(eq(users.id, strangerId));
    await db.update(users).set({ primaryGymId: null }).where(eq(users.id, me.id));
    await db.delete(gyms).where(eq(gyms.id, gym.id));
  }
});
