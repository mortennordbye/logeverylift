import { db } from "@/db";
import {
  accounts,
  aiGenerations,
  aiSetupPlans,
  customWeightUsage,
  dismissedMakeups,
  exerciseNotes,
  exercisePrs,
  exercises,
  feedback,
  friendships,
  gyms,
  inviteTokens,
  nudges,
  oauthAccessTokens,
  oauthClientResources,
  oauthClients,
  oauthConsents,
  oauthRefreshTokens,
  programExercises,
  programSets,
  programShares,
  programs,
  sessions,
  trainingCycleSlots,
  trainingCycles,
  userWeightEntries,
  users,
  workoutReactions,
  workoutSessions,
  workoutSets,
} from "@/db/schema";
import { eq, getTableColumns, inArray, lt, or, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

/**
 * Everything stored about one user, for the GDPR export (Art. 15 and 20), and
 * the clean-up that has to run before a user is deleted.
 *
 * Keyed by SQL table name. src/__tests__/integration/account-data.test.ts
 * fails when a table that hangs off "user" is missing here, so a new table
 * can't silently fall out of the export.
 */

/** Columns of `table` minus the ones that are credentials, not personal data. */
function columnsWithout<T extends PgTable>(table: T, omit: (keyof T["_"]["columns"])[]) {
  const cols = { ...getTableColumns(table) } as Record<string, unknown>;
  for (const key of omit) delete cols[key as string];
  return cols as ReturnType<typeof getTableColumns<T>>;
}

export async function collectUserData(userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));

  const programRows = await db.select().from(programs).where(eq(programs.userId, userId));
  const programIds = programRows.map((p) => p.id);
  const programExerciseRows = programIds.length
    ? await db.select().from(programExercises).where(inArray(programExercises.programId, programIds))
    : [];
  const programExerciseIds = programExerciseRows.map((pe) => pe.id);

  const sessionRows = await db.select().from(workoutSessions).where(eq(workoutSessions.userId, userId));
  const sessionIds = sessionRows.map((s) => s.id);

  const cycleRows = await db.select().from(trainingCycles).where(eq(trainingCycles.userId, userId));
  const cycleIds = cycleRows.map((c) => c.id);

  return {
    exportedAt: new Date().toISOString(),
    user,
    // The gym behind user.primaryGymId, so the export says which one it is.
    primaryGym: user?.primaryGymId
      ? ((
          await db
            .select({ name: gyms.name, address: gyms.address, osmRef: gyms.osmRef })
            .from(gyms)
            .where(eq(gyms.id, user.primaryGymId))
        )[0] ?? null)
      : null,
    account: await db
      .select(columnsWithout(accounts, ["password", "accessToken", "refreshToken", "idToken"]))
      .from(accounts)
      .where(eq(accounts.userId, userId)),
    session: await db
      .select(columnsWithout(sessions, ["token"]))
      .from(sessions)
      .where(eq(sessions.userId, userId)),
    user_weight_entry: await db.select().from(userWeightEntries).where(eq(userWeightEntries.userId, userId)),
    workout_sessions: sessionRows,
    workout_sets: sessionIds.length
      ? await db.select().from(workoutSets).where(inArray(workoutSets.sessionId, sessionIds))
      : [],
    exercise_prs: await db.select().from(exercisePrs).where(eq(exercisePrs.userId, userId)),
    exercises: await db.select().from(exercises).where(eq(exercises.userId, userId)),
    exercise_notes: await db.select().from(exerciseNotes).where(eq(exerciseNotes.userId, userId)),
    programs: programRows,
    program_exercises: programExerciseRows,
    program_sets: programExerciseIds.length
      ? await db.select().from(programSets).where(inArray(programSets.programExerciseId, programExerciseIds))
      : [],
    training_cycles: cycleRows,
    training_cycle_slots: cycleIds.length
      ? await db.select().from(trainingCycleSlots).where(inArray(trainingCycleSlots.trainingCycleId, cycleIds))
      : [],
    ai_setup_plans: await db.select().from(aiSetupPlans).where(eq(aiSetupPlans.userId, userId)),
    ai_generations: await db.select().from(aiGenerations).where(eq(aiGenerations.userId, userId)),
    custom_weight_usage: await db.select().from(customWeightUsage).where(eq(customWeightUsage.userId, userId)),
    dismissed_makeups: await db.select().from(dismissedMakeups).where(eq(dismissedMakeups.userId, userId)),
    feedback: await db.select().from(feedback).where(eq(feedback.userId, userId)),
    friendships: await db
      .select()
      .from(friendships)
      .where(or(eq(friendships.requesterId, userId), eq(friendships.addresseeId, userId))),
    nudges: await db
      .select()
      .from(nudges)
      .where(or(eq(nudges.fromUserId, userId), eq(nudges.toUserId, userId))),
    workout_reactions: await db.select().from(workoutReactions).where(eq(workoutReactions.userId, userId)),
    program_shares: await db
      .select()
      .from(programShares)
      .where(or(eq(programShares.sharedByUserId, userId), eq(programShares.sharedWithUserId, userId))),
    invite_token: await db.select().from(inviteTokens).where(eq(inviteTokens.createdBy, userId)),
    oauth_client: await db
      .select(columnsWithout(oauthClients, ["clientSecret"]))
      .from(oauthClients)
      .where(eq(oauthClients.userId, userId)),
    oauth_client_resource: await db
      .select(getTableColumns(oauthClientResources))
      .from(oauthClientResources)
      .innerJoin(oauthClients, eq(oauthClients.clientId, oauthClientResources.clientId))
      .where(eq(oauthClients.userId, userId)),
    oauth_access_token: await db
      .select(columnsWithout(oauthAccessTokens, ["token"]))
      .from(oauthAccessTokens)
      .where(eq(oauthAccessTokens.userId, userId)),
    oauth_refresh_token: await db
      .select(columnsWithout(oauthRefreshTokens, ["token", "rotationReplayResponse"]))
      .from(oauthRefreshTokens)
      .where(eq(oauthRefreshTokens.userId, userId)),
    oauth_consent: await db.select().from(oauthConsents).where(eq(oauthConsents.userId, userId)),
  };
}

/**
 * Hand this user's custom exercises that other users still train with to one
 * of those users, before the user is deleted.
 *
 * Copying a shared program reuses the sharer's custom exercise ids, and
 * workout_sets.exercise_id cascades, so deleting the sharer would otherwise
 * delete the other user's logged sets too. Names are unique, so the exercise
 * moves rather than being copied; the new owner already sees its name.
 */
export async function handOverSharedCustomExercises(userId: string) {
  await db.execute(sql`
    UPDATE exercises e
    SET user_id = ref.user_id
    FROM (
      SELECT DISTINCT ON (exercise_id) exercise_id, user_id
      FROM (
        SELECT pe.exercise_id, p.user_id
          FROM program_exercises pe JOIN programs p ON p.id = pe.program_id
        UNION ALL
        SELECT ws.exercise_id, s.user_id
          FROM workout_sets ws JOIN workout_sessions s ON s.id = ws.session_id
        UNION ALL
        SELECT exercise_id, user_id FROM exercise_prs
        UNION ALL
        SELECT exercise_id, user_id FROM custom_weight_usage
      ) r
      WHERE r.user_id <> ${userId}
      ORDER BY exercise_id, user_id
    ) ref
    WHERE e.id = ref.exercise_id AND e.user_id = ${userId}
  `);
}

/**
 * Delete sessions that have expired. Better Auth only removes a session when
 * it is used after expiry, so abandoned ones would keep their IP address and
 * user agent forever.
 */
export async function purgeExpiredSessions() {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

/**
 * Delete expired MCP access and refresh tokens. Every token refresh writes a
 * new pair and nothing removes the old ones, so a connected assistant would
 * otherwise grow these tables for as long as the account exists.
 */
export async function purgeExpiredOAuthTokens() {
  const now = new Date();
  await db.delete(oauthAccessTokens).where(lt(oauthAccessTokens.expiresAt, now));
  await db.delete(oauthRefreshTokens).where(lt(oauthRefreshTokens.expiresAt, now));
}
