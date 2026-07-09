"use server";

import { db } from "@/db";
import { exercisePrs, exercises, friendships, nudges, programs, users, workoutReactions, workoutSessions, workoutSets } from "@/db/schema";
import {
  removeFriendSchema,
  respondToFriendRequestSchema,
  searchUsersSchema,
  sendFriendRequestSchema,
  sendNudgeSchema,
  toggleReactionSchema,
  updateActivityPrivacySchema,
} from "@/lib/validators/friends";
import { requireSession } from "@/lib/utils/session";
import type {
  ActionResult,
  FriendActivityItem,
  FriendProfileStats,
  FriendSessionCard,
  FriendWithActivity,
  LeaderboardEntry,
  PendingRequest,
  ReceivedNudge,
  ReactionSummary,
  UserSearchResult,
} from "@/types/workout";
import { and, count, eq, gt, gte, ilike, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

// ─── Streak utility ───────────────────────────────────────────────────────

function calcStreak(dates: string[]): number {
  if (dates.length === 0) return 0;
  const dateSet = new Set(dates);
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const start = dateSet.has(today) ? today : dateSet.has(yesterday) ? yesterday : null;
  if (!start) return 0;
  let streak = 0;
  let cursor: string = start;
  while (dateSet.has(cursor)) {
    streak++;
    const d = new Date(cursor + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() - 1);
    cursor = d.toISOString().slice(0, 10);
  }
  return streak;
}

// ─── Search ────────────────────────────────────────────────────────────────

export async function searchUsers(query: unknown): Promise<ActionResult<UserSearchResult[]>> {
  const session = await requireSession();
  const parsed = searchUsersSchema.safeParse(query);
  if (!parsed.success) {
    return { success: false, error: "Invalid search query" };
  }

  try {
    const pattern = `%${parsed.data.query}%`;
    const me = session.user.id;

    // Fetch matching users excluding self
    const matchingUsers = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        image: users.image,
      })
      .from(users)
      .where(
        and(
          or(ilike(users.name, pattern), ilike(users.email, pattern)),
          ne(users.id, me),
        ),
      )
      .limit(20);

    if (matchingUsers.length === 0) {
      return { success: true, data: [] };
    }

    // Fetch all friendships involving me to determine status per result
    const allMyFriendships = await db
      .select()
      .from(friendships)
      .where(
        or(eq(friendships.requesterId, me), eq(friendships.addresseeId, me)),
      );

    const results: UserSearchResult[] = matchingUsers.map((u) => {
      const row = allMyFriendships.find(
        (f) =>
          (f.requesterId === me && f.addresseeId === u.id) ||
          (f.addresseeId === me && f.requesterId === u.id),
      );

      let friendshipStatus: UserSearchResult["friendshipStatus"] = "none";
      let friendshipId: number | null = null;

      if (row) {
        friendshipId = row.id;
        if (row.status === "accepted") {
          friendshipStatus = "accepted";
        } else if (row.status === "pending") {
          friendshipStatus = row.requesterId === me ? "pending_sent" : "pending_received";
        }
        // "declined" rows are treated as "none" so either party can retry
      }

      return { ...u, friendshipStatus, friendshipId };
    });

    return { success: true, data: results };
  } catch {
    return { success: false, error: "Search failed" };
  }
}

// ─── Send Friend Request ───────────────────────────────────────────────────

export async function sendFriendRequest(data: unknown): Promise<ActionResult<void>> {
  const session = await requireSession();
  const parsed = sendFriendRequestSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: "Invalid request" };
  }

  const me = session.user.id;
  const { addresseeId } = parsed.data;

  if (addresseeId === me) {
    return { success: false, error: "You cannot add yourself as a friend" };
  }

  try {
    // Check the target user exists
    const target = await db.query.users.findFirst({ where: eq(users.id, addresseeId) });
    if (!target) {
      return { success: false, error: "User not found" };
    }

    // Check for any existing row in either direction (pending or accepted)
    const existing = await db.query.friendships.findFirst({
      where: or(
        and(eq(friendships.requesterId, me), eq(friendships.addresseeId, addresseeId)),
        and(eq(friendships.requesterId, addresseeId), eq(friendships.addresseeId, me)),
      ),
    });

    if (existing) {
      if (existing.status === "accepted") {
        return { success: false, error: "You are already friends" };
      }
      if (existing.status === "pending") {
        return { success: false, error: "A friend request already exists" };
      }
      // declined — delete the old row so a fresh request can be sent
      await db.delete(friendships).where(eq(friendships.id, existing.id));
    }

    await db.insert(friendships).values({
      requesterId: me,
      addresseeId,
      status: "pending",
    });

    revalidatePath("/more/friends");
    return { success: true, data: undefined };
  } catch {
    return { success: false, error: "Failed to send friend request" };
  }
}

// ─── Respond to Friend Request ─────────────────────────────────────────────

export async function respondToFriendRequest(data: unknown): Promise<ActionResult<void>> {
  const session = await requireSession();
  const parsed = respondToFriendRequestSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: "Invalid request" };
  }

  const me = session.user.id;
  const { friendshipId, action } = parsed.data;

  try {
    const row = await db.query.friendships.findFirst({
      where: eq(friendships.id, friendshipId),
    });

    if (!row) {
      return { success: false, error: "Friend request not found" };
    }
    if (row.addresseeId !== me) {
      return { success: false, error: "Not authorised" };
    }
    if (row.status !== "pending") {
      return { success: false, error: "Request is no longer pending" };
    }

    await db
      .update(friendships)
      .set({ status: action, updatedAt: new Date() })
      .where(eq(friendships.id, friendshipId));

    revalidatePath("/more/friends");
    return { success: true, data: undefined };
  } catch {
    return { success: false, error: "Failed to respond to request" };
  }
}

// ─── Remove Friend / Cancel Request ───────────────────────────────────────

export async function removeFriend(data: unknown): Promise<ActionResult<void>> {
  const session = await requireSession();
  const parsed = removeFriendSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: "Invalid request" };
  }

  const me = session.user.id;
  const { friendshipId } = parsed.data;

  try {
    const row = await db.query.friendships.findFirst({
      where: eq(friendships.id, friendshipId),
    });

    if (!row) {
      return { success: false, error: "Not found" };
    }
    if (row.requesterId !== me && row.addresseeId !== me) {
      return { success: false, error: "Not authorised" };
    }

    await db.delete(friendships).where(eq(friendships.id, friendshipId));

    revalidatePath("/more/friends");
    return { success: true, data: undefined };
  } catch {
    return { success: false, error: "Failed to remove friend" };
  }
}

// ─── Get Friends List ──────────────────────────────────────────────────────

export async function getFriends(): Promise<ActionResult<FriendWithActivity[]>> {
  const session = await requireSession();
  const me = session.user.id;

  try {
    const rows = await db.query.friendships.findMany({
      where: and(
        or(eq(friendships.requesterId, me), eq(friendships.addresseeId, me)),
        eq(friendships.status, "accepted"),
      ),
      with: {
        requester: true,
        addressee: true,
      },
    });

    const today = new Date().toISOString().slice(0, 10);
    const friendUsers = rows.map((row) => ({
      row,
      friend: row.requesterId === me ? row.addressee : row.requester,
    }));

    // Batch-fetch last 90 days of session dates for all friends with activity visible
    const visibleFriendIds = friendUsers
      .filter((f) => f.friend.showActivityToFriends)
      .map((f) => f.friend.id);

    const since90 = new Date(Date.now() - 400 * 86400000);
    const sessionDateRows =
      visibleFriendIds.length > 0
        ? await db
            .select({ userId: workoutSessions.userId, date: workoutSessions.date })
            .from(workoutSessions)
            .where(
              and(
                inArray(workoutSessions.userId, visibleFriendIds),
                eq(workoutSessions.isCompleted, true),
                gt(workoutSessions.startTime, since90),
              ),
            )
        : [];

    // Group dates by userId
    const datesByUser = new Map<string, string[]>();
    for (const r of sessionDateRows) {
      const arr = datesByUser.get(r.userId) ?? [];
      arr.push(r.date);
      datesByUser.set(r.userId, arr);
    }

    const result: FriendWithActivity[] = friendUsers.map(({ row, friend }) => {
      let workedOutToday: boolean | null = null;
      let streak = 0;

      if (friend.showActivityToFriends) {
        const dates = datesByUser.get(friend.id) ?? [];
        workedOutToday = dates.includes(today);
        streak = calcStreak(dates);
      }

      return {
        friendshipId: row.id,
        userId: friend.id,
        name: friend.name,
        image: friend.image,
        workedOutToday,
        streak,
      };
    });

    return { success: true, data: result };
  } catch {
    return { success: false, error: "Failed to load friends" };
  }
}

// ─── Get Pending Incoming Requests ────────────────────────────────────────

export async function getPendingRequests(): Promise<ActionResult<PendingRequest[]>> {
  const session = await requireSession();
  const me = session.user.id;

  try {
    const rows = await db.query.friendships.findMany({
      where: and(eq(friendships.addresseeId, me), eq(friendships.status, "pending")),
      with: { requester: true },
      orderBy: (f, { desc }) => [desc(f.createdAt)],
    });

    return {
      success: true,
      data: rows.map((row) => ({
        friendshipId: row.id,
        requesterId: row.requester.id,
        requesterName: row.requester.name,
        requesterImage: row.requester.image,
        createdAt: row.createdAt,
      })),
    };
  } catch {
    return { success: false, error: "Failed to load requests" };
  }
}

// ─── Friends Activity Feed ─────────────────────────────────────────────────

export async function getFriendsActivityFeed(): Promise<ActionResult<FriendActivityItem[]>> {
  const session = await requireSession();
  const me = session.user.id;

  try {
    const since = new Date();
    since.setDate(since.getDate() - 14);

    const rows = await db
      .select({
        friendshipId: friendships.id,
        userId: users.id,
        name: users.name,
        image: users.image,
        sessionId: workoutSessions.id,
        date: workoutSessions.date,
        startTime: workoutSessions.startTime,
        endTime: workoutSessions.endTime,
        programName: programs.name,
        feeling: workoutSessions.feeling,
        setCount: count(workoutSets.id),
        exerciseCount: sql<number>`count(distinct ${workoutSets.exerciseId})`,
        totalVolumeKg: sql<number>`coalesce(sum(${workoutSets.weightKg} * ${workoutSets.actualReps}), 0)`,
      })
      .from(friendships)
      .innerJoin(
        users,
        and(
          or(
            and(eq(friendships.requesterId, me), eq(users.id, friendships.addresseeId)),
            and(eq(friendships.addresseeId, me), eq(users.id, friendships.requesterId)),
          ),
          eq(users.showActivityToFriends, true),
        ),
      )
      .innerJoin(
        workoutSessions,
        and(
          eq(workoutSessions.userId, users.id),
          eq(workoutSessions.isCompleted, true),
          gt(workoutSessions.startTime, since),
        ),
      )
      .leftJoin(programs, eq(programs.id, workoutSessions.programId))
      .leftJoin(
        workoutSets,
        and(eq(workoutSets.sessionId, workoutSessions.id), eq(workoutSets.isCompleted, true)),
      )
      .where(
        and(
          eq(friendships.status, "accepted"),
          or(eq(friendships.requesterId, me), eq(friendships.addresseeId, me)),
        ),
      )
      .groupBy(
        friendships.id,
        users.id,
        users.name,
        users.image,
        workoutSessions.id,
        workoutSessions.date,
        workoutSessions.startTime,
        workoutSessions.endTime,
        programs.name,
        workoutSessions.feeling,
      )
      .orderBy(sql`${workoutSessions.startTime} desc`)
      .limit(20);

    const sessionIds = rows.map((r) => r.sessionId);

    // Batch-fetch PRs for these sessions (prefer estimated_1rm > weight > reps_at_weight)
    const prRows = sessionIds.length > 0
      ? await db
          .select({
            sessionId: exercisePrs.sessionId,
            exerciseName: exercises.name,
            prType: exercisePrs.prType,
            value: exercisePrs.value,
          })
          .from(exercisePrs)
          .innerJoin(exercises, eq(exercises.id, exercisePrs.exerciseId))
          .where(and(inArray(exercisePrs.sessionId, sessionIds), isNull(exercisePrs.supersededAt)))
      : [];

    // Pick one PR per session: estimated_1rm > weight > reps_at_weight
    const prPriority: Record<string, number> = { estimated_1rm: 0, weight: 1, reps_at_weight: 2 };
    const prBySession = new Map<number, { exerciseName: string; prType: string; value: number }>();
    for (const pr of prRows) {
      if (pr.sessionId == null) continue;
      const existing = prBySession.get(pr.sessionId);
      const newPriority = prPriority[pr.prType] ?? 99;
      const existingPriority = existing ? (prPriority[existing.prType] ?? 99) : 99;
      if (!existing || newPriority < existingPriority) {
        prBySession.set(pr.sessionId, {
          exerciseName: pr.exerciseName,
          prType: pr.prType,
          value: Number(pr.value),
        });
      }
    }

    // Batch-fetch reactions for these sessions
    const reactionRows = sessionIds.length > 0
      ? await db
          .select({
            sessionId: workoutReactions.sessionId,
            emoji: workoutReactions.emoji,
            reactorId: workoutReactions.userId,
          })
          .from(workoutReactions)
          .where(inArray(workoutReactions.sessionId, sessionIds))
      : [];

    // Aggregate reactions per session
    const reactionsBySession = new Map<number, Map<string, { count: number; reactedByMe: boolean }>>();
    for (const r of reactionRows) {
      if (!reactionsBySession.has(r.sessionId)) reactionsBySession.set(r.sessionId, new Map());
      const emojiMap = reactionsBySession.get(r.sessionId)!;
      const existing = emojiMap.get(r.emoji) ?? { count: 0, reactedByMe: false };
      emojiMap.set(r.emoji, {
        count: existing.count + 1,
        reactedByMe: existing.reactedByMe || r.reactorId === me,
      });
    }

    // Batch-fetch 90-day session dates for streak calculation
    const feedUserIds = [...new Set(rows.map((r) => r.userId))];
    const since90 = new Date(Date.now() - 400 * 86400000);
    const streakDateRows =
      feedUserIds.length > 0
        ? await db
            .select({ userId: workoutSessions.userId, date: workoutSessions.date })
            .from(workoutSessions)
            .where(
              and(
                inArray(workoutSessions.userId, feedUserIds),
                eq(workoutSessions.isCompleted, true),
                gt(workoutSessions.startTime, since90),
              ),
            )
        : [];

    const streakDatesByUser = new Map<string, string[]>();
    for (const r of streakDateRows) {
      const arr = streakDatesByUser.get(r.userId) ?? [];
      arr.push(r.date);
      streakDatesByUser.set(r.userId, arr);
    }

    const data: FriendActivityItem[] = rows.map((r) => {
      const durationMinutes =
        r.endTime && r.startTime
          ? Math.max(1, Math.round((r.endTime.getTime() - r.startTime.getTime()) / 60000))
          : 0;

      const emojiMap = reactionsBySession.get(r.sessionId);
      const reactions: ReactionSummary[] = ["🔥", "💪", "👏"].map((emoji) => {
        const r = emojiMap?.get(emoji);
        return { emoji, count: r?.count ?? 0, reactedByMe: r?.reactedByMe ?? false };
      });

      return {
        friendshipId: r.friendshipId,
        userId: r.userId,
        name: r.name,
        image: r.image,
        sessionId: r.sessionId,
        date: r.date,
        startTime: r.startTime,
        programName: r.programName ?? null,
        durationMinutes,
        setCount: Number(r.setCount),
        exerciseCount: Number(r.exerciseCount),
        totalVolumeKg: Number(r.totalVolumeKg),
        feeling: r.feeling ?? null,
        streak: calcStreak(streakDatesByUser.get(r.userId) ?? []),
        prHighlight: prBySession.get(r.sessionId) ?? null,
        reactions,
      };
    });

    return { success: true, data };
  } catch {
    return { success: false, error: "Failed to load activity feed" };
  }
}

// ─── Activity Privacy ──────────────────────────────────────────────────────

export async function updateActivityPrivacy(data: unknown): Promise<ActionResult<void>> {
  const session = await requireSession();
  const parsed = updateActivityPrivacySchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: "Invalid data" };
  }

  try {
    await db
      .update(users)
      .set({ showActivityToFriends: parsed.data.showActivityToFriends })
      .where(eq(users.id, session.user.id));

    revalidatePath("/more/account");
    return { success: true, data: undefined };
  } catch {
    return { success: false, error: "Failed to update privacy setting" };
  }
}

// ─── Friend Profile Stats ─────────────────────────────────────────────────

export async function getFriendProfile(
  userId: string,
): Promise<ActionResult<FriendProfileStats>> {
  const session = await requireSession();
  const me = session.user.id;

  try {
    // Verify accepted friendship
    const [friendship] = await db
      .select({ id: friendships.id })
      .from(friendships)
      .where(
        and(
          eq(friendships.status, "accepted"),
          or(
            and(eq(friendships.requesterId, me), eq(friendships.addresseeId, userId)),
            and(eq(friendships.addresseeId, me), eq(friendships.requesterId, userId)),
          ),
        ),
      )
      .limit(1);

    if (!friendship) return { success: false, error: "Not a friend" };

    const [targetUser] = await db
      .select({ showActivity: users.showActivityToFriends })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!targetUser?.showActivity) {
      return { success: true, data: { streak: 0, thisWeekVolume: 0, thisWeekWorkouts: 0, totalWorkouts: 0, recentSessions: [] } };
    }

    // Monday of this week
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    weekStart.setHours(0, 0, 0, 0);

    const since90 = new Date(Date.now() - 400 * 86400000);

    // Run queries in parallel
    const [sessionDateRows, weekRows, recentRows, totalRow] = await Promise.all([
      // Streak dates
      db.select({ date: workoutSessions.date })
        .from(workoutSessions)
        .where(and(eq(workoutSessions.userId, userId), eq(workoutSessions.isCompleted, true), gt(workoutSessions.startTime, since90))),

      // This week's volume + count
      db.select({
        workoutCount: sql<number>`count(distinct ${workoutSessions.id})`,
        totalVolumeKg: sql<number>`coalesce(sum(${workoutSets.weightKg}::numeric * ${workoutSets.actualReps}), 0)`,
      })
        .from(workoutSessions)
        .leftJoin(workoutSets, and(eq(workoutSets.sessionId, workoutSessions.id), eq(workoutSets.isCompleted, true)))
        .where(and(eq(workoutSessions.userId, userId), eq(workoutSessions.isCompleted, true), gte(workoutSessions.startTime, weekStart))),

      // Recent 5 sessions with stats
      db.select({
        sessionId: workoutSessions.id,
        date: workoutSessions.date,
        startTime: workoutSessions.startTime,
        endTime: workoutSessions.endTime,
        programName: programs.name,
        feeling: workoutSessions.feeling,
        setCount: count(workoutSets.id),
        exerciseCount: sql<number>`count(distinct ${workoutSets.exerciseId})`,
        totalVolumeKg: sql<number>`coalesce(sum(${workoutSets.weightKg}::numeric * ${workoutSets.actualReps}), 0)`,
      })
        .from(workoutSessions)
        .leftJoin(programs, eq(programs.id, workoutSessions.programId))
        .leftJoin(workoutSets, and(eq(workoutSets.sessionId, workoutSessions.id), eq(workoutSets.isCompleted, true)))
        .where(and(eq(workoutSessions.userId, userId), eq(workoutSessions.isCompleted, true)))
        .groupBy(workoutSessions.id, programs.name)
        .orderBy(sql`${workoutSessions.startTime} desc`)
        .limit(5),

      // Total workout count
      db.select({ total: count() })
        .from(workoutSessions)
        .where(and(eq(workoutSessions.userId, userId), eq(workoutSessions.isCompleted, true))),
    ]);

    const streak = calcStreak(sessionDateRows.map((r) => r.date));

    // Fetch PRs for recent sessions
    const recentSessionIds = recentRows.map((r) => r.sessionId);
    const prRows = recentSessionIds.length > 0
      ? await db
          .select({ sessionId: exercisePrs.sessionId, exerciseName: exercises.name, value: exercisePrs.value, prType: exercisePrs.prType })
          .from(exercisePrs)
          .innerJoin(exercises, eq(exercises.id, exercisePrs.exerciseId))
          .where(and(inArray(exercisePrs.sessionId, recentSessionIds), isNull(exercisePrs.supersededAt)))
      : [];

    const prPriority: Record<string, number> = { estimated_1rm: 0, weight: 1, reps_at_weight: 2 };
    const prBySession = new Map<number, { exerciseName: string; value: number; prType: string }>();
    for (const pr of prRows) {
      if (pr.sessionId == null) continue;
      const existing = prBySession.get(pr.sessionId);
      const newPri = prPriority[pr.prType] ?? 99;
      const existPri = existing ? (prPriority[existing.prType] ?? 99) : 99;
      if (!existing || newPri < existPri) {
        prBySession.set(pr.sessionId, { exerciseName: pr.exerciseName, value: Number(pr.value), prType: pr.prType });
      }
    }

    const recentSessions: FriendSessionCard[] = recentRows.map((r) => ({
      sessionId: r.sessionId,
      date: r.date,
      startTime: r.startTime,
      programName: r.programName ?? null,
      durationMinutes: r.endTime && r.startTime
        ? Math.max(1, Math.round((r.endTime.getTime() - r.startTime.getTime()) / 60000))
        : 0,
      setCount: Number(r.setCount),
      exerciseCount: Number(r.exerciseCount),
      totalVolumeKg: Number(r.totalVolumeKg),
      feeling: r.feeling ?? null,
      prHighlight: prBySession.get(r.sessionId) ?? null,
    }));

    return {
      success: true,
      data: {
        streak,
        thisWeekVolume: Number(weekRows[0]?.totalVolumeKg ?? 0),
        thisWeekWorkouts: Number(weekRows[0]?.workoutCount ?? 0),
        totalWorkouts: Number(totalRow[0]?.total ?? 0),
        recentSessions,
      },
    };
  } catch {
    return { success: false, error: "Failed to load profile" };
  }
}

// ─── Weekly Leaderboard ────────────────────────────────────────────────────

export async function getFriendsLeaderboard(): Promise<ActionResult<LeaderboardEntry[]>> {
  const session = await requireSession();
  const me = session.user.id;

  try {
    // Monday of current week at midnight
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    weekStart.setHours(0, 0, 0, 0);

    // Friends who have activity visible
    const friendRows = await db
      .select({ userId: users.id, name: users.name, image: users.image })
      .from(friendships)
      .innerJoin(
        users,
        and(
          or(
            and(eq(friendships.requesterId, me), eq(users.id, friendships.addresseeId)),
            and(eq(friendships.addresseeId, me), eq(users.id, friendships.requesterId)),
          ),
          eq(users.showActivityToFriends, true),
        ),
      )
      .where(
        and(
          eq(friendships.status, "accepted"),
          or(eq(friendships.requesterId, me), eq(friendships.addresseeId, me)),
        ),
      );

    const [selfRow] = await db
      .select({ name: users.name, image: users.image })
      .from(users)
      .where(eq(users.id, me))
      .limit(1);

    const participantIds = [me, ...friendRows.map((f) => f.userId)];

    // Volume + session count per user this week
    const volumeRows = await db
      .select({
        userId: workoutSessions.userId,
        workoutCount: sql<number>`count(distinct ${workoutSessions.id})`,
        totalVolumeKg: sql<number>`coalesce(sum(${workoutSets.weightKg}::numeric * ${workoutSets.actualReps}), 0)`,
      })
      .from(workoutSessions)
      .leftJoin(
        workoutSets,
        and(eq(workoutSets.sessionId, workoutSessions.id), eq(workoutSets.isCompleted, true)),
      )
      .where(
        and(
          inArray(workoutSessions.userId, participantIds),
          eq(workoutSessions.isCompleted, true),
          gte(workoutSessions.startTime, weekStart),
        ),
      )
      .groupBy(workoutSessions.userId);

    const volumeMap = new Map(volumeRows.map((r) => [r.userId, r]));

    const participants = [
      { userId: me, name: selfRow?.name ?? "You", image: selfRow?.image ?? null, isMe: true },
      ...friendRows.map((f) => ({ userId: f.userId, name: f.name, image: f.image, isMe: false })),
    ];

    const entries: LeaderboardEntry[] = participants.map((p) => {
      const v = volumeMap.get(p.userId);
      return {
        ...p,
        totalVolumeKg: Number(v?.totalVolumeKg ?? 0),
        workoutCount: Number(v?.workoutCount ?? 0),
      };
    });

    entries.sort((a, b) => b.totalVolumeKg - a.totalVolumeKg);
    return { success: true, data: entries };
  } catch {
    return { success: false, error: "Failed to load leaderboard" };
  }
}

// ─── Reactions ─────────────────────────────────────────────────────────────

export async function toggleReaction(
  data: unknown,
): Promise<ActionResult<{ reacted: boolean }>> {
  const session = await requireSession();
  const parsed = toggleReactionSchema.safeParse(data);
  if (!parsed.success) return { success: false, error: "Invalid reaction data" };

  const { sessionId, emoji } = parsed.data;
  const me = session.user.id;

  try {
    // Verify the session belongs to an accepted friend (privacy guard)
    const [ws] = await db
      .select({ ownerId: workoutSessions.userId })
      .from(workoutSessions)
      .where(and(eq(workoutSessions.id, sessionId), eq(workoutSessions.isCompleted, true)))
      .limit(1);

    if (!ws) return { success: false, error: "Workout not found" };

    const [friendship] = await db
      .select({ id: friendships.id })
      .from(friendships)
      .where(
        and(
          eq(friendships.status, "accepted"),
          or(
            and(eq(friendships.requesterId, me), eq(friendships.addresseeId, ws.ownerId)),
            and(eq(friendships.addresseeId, me), eq(friendships.requesterId, ws.ownerId)),
          ),
        ),
      )
      .limit(1);

    if (!friendship) return { success: false, error: "Not a friend" };

    // Toggle: delete if exists, insert if not
    const [existing] = await db
      .select({ id: workoutReactions.id })
      .from(workoutReactions)
      .where(
        and(
          eq(workoutReactions.sessionId, sessionId),
          eq(workoutReactions.userId, me),
          eq(workoutReactions.emoji, emoji),
        ),
      )
      .limit(1);

    if (existing) {
      await db.delete(workoutReactions).where(eq(workoutReactions.id, existing.id));
      revalidatePath("/more/friends");
      return { success: true, data: { reacted: false } };
    }

    await db.insert(workoutReactions).values({ sessionId, userId: me, emoji });
    revalidatePath("/more/friends");
    return { success: true, data: { reacted: true } };
  } catch {
    return { success: false, error: "Failed to toggle reaction" };
  }
}

// ─── Nudge ────────────────────────────────────────────────────────────────────

export async function sendNudge(input: unknown): Promise<ActionResult<void>> {
  const session = await requireSession();
  const me = session.user.id;

  const parsed = sendNudgeSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid input" };
  const { toUserId } = parsed.data;

  if (toUserId === me) return { success: false, error: "Cannot nudge yourself" };

  try {
    // Verify accepted friendship
    const [friendship] = await db
      .select({ id: friendships.id })
      .from(friendships)
      .where(
        and(
          eq(friendships.status, "accepted"),
          or(
            and(eq(friendships.requesterId, me), eq(friendships.addresseeId, toUserId)),
            and(eq(friendships.addresseeId, me), eq(friendships.requesterId, toUserId)),
          ),
        ),
      )
      .limit(1);

    if (!friendship) return { success: false, error: "Not a friend" };

    // Cooldown: one nudge per 24 h per direction
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [recent] = await db
      .select({ id: nudges.id })
      .from(nudges)
      .where(
        and(
          eq(nudges.fromUserId, me),
          eq(nudges.toUserId, toUserId),
          gt(nudges.createdAt, cutoff),
        ),
      )
      .limit(1);

    if (recent) return { success: false, error: "Already nudged recently" };

    await db.insert(nudges).values({ fromUserId: me, toUserId });
    return { success: true, data: undefined };
  } catch {
    return { success: false, error: "Failed to send nudge" };
  }
}

export async function getReceivedNudges(): Promise<ActionResult<ReceivedNudge[]>> {
  const session = await requireSession();
  const me = session.user.id;

  try {
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const rows = await db
      .select({
        id: nudges.id,
        fromUserId: nudges.fromUserId,
        fromName: users.name,
        fromImage: users.image,
        createdAt: nudges.createdAt,
      })
      .from(nudges)
      .innerJoin(users, eq(users.id, nudges.fromUserId))
      .where(and(eq(nudges.toUserId, me), gt(nudges.createdAt, cutoff)))
      .orderBy(sql`${nudges.createdAt} desc`);

    return {
      success: true,
      data: rows.map((r) => ({
        id: r.id,
        fromUserId: r.fromUserId,
        fromName: r.fromName,
        fromImage: r.fromImage,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  } catch {
    return { success: false, error: "Failed to fetch nudges" };
  }
}
