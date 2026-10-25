import { db } from "@/db";
import { friendships, nudges, users, workoutReactions, workoutSessions, workoutSets } from "@/db/schema";
import {
  getFriendSessionDetail,
  getFriendsReadTime,
  getFriendsBadgeCount,
  getReactionsToMyWorkouts,
  markFriendsSeen,
  searchUsers,
  sendFriendRequest,
  toggleReaction,
} from "@/lib/actions/friends";
import { getSessionDetail } from "@/lib/actions/workout-sets";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createExercise, createSession, createUser } from "./factories";
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

const dbNow = getFriendsReadTime;

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

    await markFriendsSeen({ at: await dbNow() });
    expect(await badge()).toBe(1);
  });

  it("still counts what arrived after the moment the page was read", async () => {
    const friend = await createUser();
    const mine = await createSession(meId, null, { isCompleted: true });
    const readAt = await dbNow();
    await db.insert(workoutReactions).values({ sessionId: mine.id, userId: friend.id, emoji: "🔥" });
    await markFriendsSeen({ at: readAt });
    expect(await badge()).toBe(1);
  });

  it("never moves the seen mark backwards", async () => {
    const friend = await createUser();
    const mine = await createSession(meId, null, { isCompleted: true });
    await db.insert(workoutReactions).values({ sessionId: mine.id, userId: friend.id, emoji: "🔥" });
    await markFriendsSeen({ at: await dbNow() });
    await markFriendsSeen({ at: new Date(Date.now() - 3600_000).toISOString() });
    expect(await badge()).toBe(0);
  });

  it("before the page was ever opened, counts reactions only as far back as the list shows them", async () => {
    const friend = await createUser();
    const mine = await createSession(meId, null, { isCompleted: true });
    await db.insert(workoutReactions).values({
      sessionId: mine.id,
      userId: friend.id,
      emoji: "🔥",
      createdAt: new Date(Date.now() - 8 * 24 * 3600_000),
    });
    await db.update(users).set({ friendsSeenAt: null }).where(eq(users.id, meId));
    expect(await badge()).toBe(0);
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

describe("getFriendSessionDetail", () => {
  async function friendSession({ friend = true, showActivityToFriends = true } = {}) {
    const owner = await createUser({ name: "Owner", showActivityToFriends });
    if (friend) {
      await db.insert(friendships).values({ requesterId: owner.id, addresseeId: meId, status: "accepted" });
    }
    const session = await createSession(owner.id, null, { isCompleted: true, notes: "knee hurt" });
    const exercise = await createExercise({ name: "Squat" });
    await db.insert(workoutSets).values({
      sessionId: session.id,
      exerciseId: exercise.id,
      setNumber: 1,
      actualReps: 5,
      weightKg: "100",
      restTimeSeconds: 120,
      rir: 2,
      notes: "felt heavy",
    });
    return session;
  }

  it("shows a friend's sets as labels, without notes or effort", async () => {
    const session = await friendSession();
    const result = await getFriendSessionDetail({ sessionId: session.id });
    if (!result.success) throw new Error(result.error);
    expect(result.data.ownerName).toBe("Owner");
    expect(result.data.exercises).toEqual([{ exerciseName: "Squat", sets: [{ setNumber: 1, label: "5 × 100kg" }] }]);
    const json = JSON.stringify(result.data);
    expect(json).not.toContain("knee hurt");
    expect(json).not.toContain("felt heavy");
    expect(json).not.toMatch(/"(rir|rpe|readiness|notes|heartRateZone)"/);
  });

  it("refuses someone who is not a friend", async () => {
    const session = await friendSession({ friend: false });
    expect((await getFriendSessionDetail({ sessionId: session.id })).success).toBe(false);
  });

  it("refuses a friend who hides activity from friends", async () => {
    const session = await friendSession({ showActivityToFriends: false });
    expect((await getFriendSessionDetail({ sessionId: session.id })).success).toBe(false);
  });

  it("refuses a friend request that is still pending", async () => {
    const owner = await createUser({ name: "Asker" });
    await db.insert(friendships).values({ requesterId: owner.id, addresseeId: meId, status: "pending" });
    const session = await createSession(owner.id, null, { isCompleted: true });
    expect((await getFriendSessionDetail({ sessionId: session.id })).success).toBe(false);
  });

  it("refuses a workout that is still in progress", async () => {
    const session = await friendSession();
    await db.update(workoutSessions).set({ isCompleted: false }).where(eq(workoutSessions.id, session.id));
    expect((await getFriendSessionDetail({ sessionId: session.id })).success).toBe(false);
  });
});

describe("sendFriendRequest", () => {
  it("can't be re-sent within 30 days of being declined", async () => {
    const other = await createUser();
    await db.insert(friendships).values({ requesterId: meId, addresseeId: other.id, status: "declined", updatedAt: new Date() });
    expect((await sendFriendRequest({ addresseeId: other.id })).success).toBe(false);

    await db.update(friendships).set({ updatedAt: new Date(Date.now() - 31 * 24 * 3600_000) });
    expect((await sendFriendRequest({ addresseeId: other.id })).success).toBe(true);
  });

  it("is limited to 20 an hour per sender", async () => {
    const results = [];
    for (let i = 0; i < 21; i++) {
      const other = await createUser();
      results.push((await sendFriendRequest({ addresseeId: other.id })).success);
    }
    expect(results.filter(Boolean)).toHaveLength(20);
    expect(results.at(-1)).toBe(false);
  });
});
