import { db } from "@/db";
import { friendships, nudges, users, workoutReactions } from "@/db/schema";
import {
  getFriendsBadgeCount,
  getReactionsToMyWorkouts,
  markFriendsSeen,
  searchUsers,
  toggleReaction,
} from "@/lib/actions/friends";
import { getSessionDetail } from "@/lib/actions/workout-sets";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createSession, createUser } from "./factories";
import { asUser } from "./setup";

let meId: string;

beforeEach(async () => {
  meId = (await createUser({ name: "Me" })).id;
  await createUser({ name: "Alice Hansen", email: "alice@example.com" });
  await createUser({ name: "Bob Berg", email: "bob@example.com" });
  asUser(meId);
});

async function search(query: string) {
  const result = await searchUsers({ query });
  if (!result.success) throw new Error(result.error);
  return result.data;
}

describe("searchUsers", () => {
  it("never returns another user's email", async () => {
    const results = await search("Alice");
    expect(results.map((r) => r.name)).toEqual(["Alice Hansen"]);
    expect(results[0]).not.toHaveProperty("email");
  });

  it("does not list users for short queries", async () => {
    expect(await search("a")).toEqual([]);
    expect(await search("al")).toEqual([]);
  });

  it("treats LIKE wildcards as plain characters", async () => {
    expect(await search("___")).toEqual([]);
    expect(await search("%%%")).toEqual([]);
  });

  it("does not match a partial email", async () => {
    expect(await search("example.com")).toEqual([]);
    expect(await search("@example")).toEqual([]);
  });

  it("finds a user by their exact email, ignoring case", async () => {
    expect((await search("Bob@Example.com")).map((r) => r.name)).toEqual(["Bob Berg"]);
  });
});

describe("toggleReaction", () => {
  async function friendWithSession(showActivityToFriends: boolean) {
    const friend = await createUser({ name: "Friend", showActivityToFriends });
    await db
      .insert(friendships)
      .values({ requesterId: meId, addresseeId: friend.id, status: "accepted" });
    return createSession(friend.id, null, { isCompleted: true });
  }

  it("reacts to a friend's shared workout", async () => {
    const session = await friendWithSession(true);
    const result = await toggleReaction({ sessionId: session.id, emoji: "🔥" });
    expect(result).toEqual({ success: true, data: { reacted: true } });
  });

  it("refuses a workout the friend has hidden from friends", async () => {
    const session = await friendWithSession(false);
    const result = await toggleReaction({ sessionId: session.id, emoji: "🔥" });
    expect(result.success).toBe(false);
  });
});

describe("reactions to my workouts", () => {
  it("lists who reacted, on my own sessions only", async () => {
    const friend = await createUser({ name: "Kari" });
    const mine = await createSession(meId, null, { isCompleted: true });
    const theirs = await createSession(friend.id, null, { isCompleted: true });
    await db.insert(workoutReactions).values([
      { sessionId: mine.id, userId: friend.id, emoji: "💪" },
      { sessionId: theirs.id, userId: meId, emoji: "🔥" },
    ]);

    const result = await getReactionsToMyWorkouts();
    if (!result.success) throw new Error(result.error);
    expect(result.data.map((r) => [r.fromName, r.emoji, r.sessionId])).toEqual([
      ["Kari", "💪", mine.id],
    ]);

    const detail = await getSessionDetail(mine.id);
    if (!detail.success) throw new Error(detail.error);
    expect(detail.data.reactions).toEqual([{ emoji: "💪", fromName: "Kari" }]);
  });
});

describe("getFriendsBadgeCount", () => {
  async function badge() {
    const result = await getFriendsBadgeCount();
    if (!result.success) throw new Error(result.error);
    return result.data;
  }

  it("counts requests, new nudges and new reactions, and clears all but requests once seen", async () => {
    const asker = await createUser();
    const friend = await createUser();
    const mine = await createSession(meId, null, { isCompleted: true });
    await db.insert(friendships).values({ requesterId: asker.id, addresseeId: meId });
    await db.insert(nudges).values({ fromUserId: friend.id, toUserId: meId });
    await db.insert(workoutReactions).values({ sessionId: mine.id, userId: friend.id, emoji: "👏" });

    expect(await badge()).toBe(3);

    await markFriendsSeen();
    expect(await badge()).toBe(1);
  });

  it("ignores nudges older than the 48 hours they are shown for", async () => {
    const friend = await createUser();
    await db
      .insert(nudges)
      .values({ fromUserId: friend.id, toUserId: meId, createdAt: new Date(Date.now() - 49 * 3600_000) });
    await db.update(users).set({ friendsSeenAt: null }).where(eq(users.id, meId));
    expect(await badge()).toBe(0);
  });
});
