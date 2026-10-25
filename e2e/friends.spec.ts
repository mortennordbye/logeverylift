import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { friendships, programShares, programs, users, workoutReactions, workoutSessions } from "../src/db/schema";
import { e2eUser } from "./fixtures/env";
import { testDb } from "./fixtures/reset";
import { expect, test } from "./fixtures/test";

/**
 * A friend of this worker's e2e account. The friend never signs in, so a bare
 * user row is enough; deleting it in `finally` cascades to the friendship and
 * everything hanging off it.
 */
async function withFriend(workerIndex: number, run: (me: string, friend: { id: string; name: string }) => Promise<void>) {
  const db = testDb();
  const [me] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, e2eUser(workerIndex).email));
  const id = `e2e-friend-${randomUUID()}`;
  const name = `Friend ${workerIndex}`;
  const now = new Date();
  await db.insert(users).values({ id, name, email: `${id}@test.local`, createdAt: now, updatedAt: now });
  await db.insert(friendships).values({ requesterId: id, addresseeId: me.id, status: "accepted" });
  try {
    await run(me.id, { id, name });
  } finally {
    await db.delete(users).where(eq(users.id, id));
  }
}

test("a program shared with a friend can be revoked", async ({ page }, testInfo) => {
  await withFriend(testInfo.parallelIndex, async (me, friend) => {
    const db = testDb();
    const [program] = await db.select({ id: programs.id }).from(programs).where(eq(programs.userId, me)).limit(1);
    const shareRows = () =>
      db
        .select({ id: programShares.id })
        .from(programShares)
        .where(and(eq(programShares.programId, program.id), eq(programShares.sharedWithUserId, friend.id)));

    await page.goto(`/programs/${program.id}`);
    await page.getByRole("button", { name: "Share", exact: true }).click();
    await page.getByRole("button", { name: "Share", exact: true }).last().click();
    const revoke = page.getByRole("button", { name: `Revoke share with ${friend.name}` });
    await expect(revoke).toBeVisible();
    expect(await shareRows()).toHaveLength(1);

    await revoke.click();
    await expect(revoke).toBeHidden();
    await expect.poll(async () => (await shareRows()).length).toBe(0);
  });
});

test("a reaction to my workout shows a badge until I open Friends", async ({ page }, testInfo) => {
  await withFriend(testInfo.parallelIndex, async (me, friend) => {
    const db = testDb();
    const [session] = await db
      .select({ id: workoutSessions.id })
      .from(workoutSessions)
      .where(and(eq(workoutSessions.userId, me), eq(workoutSessions.isCompleted, true)))
      .orderBy(desc(workoutSessions.startTime))
      .limit(1);
    await db.insert(workoutReactions).values({ sessionId: session.id, userId: friend.id, emoji: "🔥" });

    await page.goto("/more");
    await expect(page.getByTestId("friends-badge")).toBeVisible();
    await expect(page.getByLabel("1 new")).toBeVisible();

    await page.getByRole("link", { name: /Friends/ }).first().click();
    await expect(page.getByRole("link", { name: new RegExp(`${friend.name} 🔥 your`) })).toBeVisible();
    await expect(page.getByTestId("friends-badge")).toBeHidden();

    await page.getByRole("link", { name: new RegExp(`${friend.name} 🔥 your`) }).click();
    await expect(page.getByText(`🔥 ${friend.name}`)).toBeVisible();
  });
});
