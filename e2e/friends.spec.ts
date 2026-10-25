import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  exercises,
  friendships,
  programShares,
  programs,
  users,
  workoutReactions,
  workoutSessions,
  workoutSets,
} from "../src/db/schema";
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

    // Back on More within the router's 30 s cache: the count must be gone too.
    await page.getByRole("link", { name: "More" }).first().click();
    await page.waitForURL("**/more");
    await expect(page.getByLabel("1 new")).toBeHidden();
    await page.goBack();

    await page.getByRole("link", { name: new RegExp(`${friend.name} 🔥 your`) }).click();
    await expect(page.getByText(`🔥 ${friend.name}`)).toBeVisible();
  });
});

test("a friend's workout opens from the feed, sets shown and notes kept private", async ({ page }, testInfo) => {
  await withFriend(testInfo.parallelIndex, async (_me, friend) => {
    const db = testDb();
    const now = new Date();
    const [session] = await db
      .insert(workoutSessions)
      .values({
        userId: friend.id,
        date: now.toISOString().slice(0, 10),
        startTime: new Date(now.getTime() - 45 * 60_000),
        endTime: now,
        isCompleted: true,
        notes: "private session note",
      })
      .returning();
    const [exercise] = await db
      .select({ id: exercises.id, name: exercises.name })
      .from(exercises)
      .where(and(isNull(exercises.userId), eq(exercises.category, "strength")))
      .limit(1);
    await db.insert(workoutSets).values({
      sessionId: session.id,
      exerciseId: exercise.id,
      setNumber: 1,
      actualReps: 5,
      weightKg: "100",
      restTimeSeconds: 120,
      notes: "private set note",
    });

    await page.goto("/more/friends");
    await page.locator(`a[href="/more/friends/${friend.id}/sessions/${session.id}"]`).click();
    await page.waitForURL(`**/more/friends/${friend.id}/sessions/${session.id}`);
    await expect(page.getByRole("heading", { name: exercise.name })).toBeVisible();
    await expect(page.getByText("5 × 100kg")).toBeVisible();
    await expect(page.getByText(/private (session|set) note/)).toHaveCount(0);

    await page.getByTestId("friend-session-reactions").getByRole("button", { name: "💪" }).click();
    await expect
      .poll(async () => (await db.select().from(workoutReactions).where(eq(workoutReactions.sessionId, session.id))).length)
      .toBe(1);
  });
});

test("a failed revoke says why instead of doing nothing", async ({ page }, testInfo) => {
  await withFriend(testInfo.parallelIndex, async (me, friend) => {
    const db = testDb();
    const [program] = await db.select({ id: programs.id }).from(programs).where(eq(programs.userId, me)).limit(1);
    await db.insert(programShares).values({ programId: program.id, sharedByUserId: me, sharedWithUserId: friend.id });

    await page.goto(`/programs/${program.id}`);
    await page.getByRole("button", { name: "Share", exact: true }).click();
    const revoke = page.getByRole("button", { name: `Revoke share with ${friend.name}` });
    await expect(revoke).toBeVisible();
    // Revoked elsewhere (another device) while this sheet was open.
    await db.delete(programShares).where(eq(programShares.programId, program.id));

    await revoke.click();
    await expect(page.getByRole("alert").filter({ hasText: "Share not found" })).toBeVisible();
    await expect(revoke).toBeHidden();
  });
});
