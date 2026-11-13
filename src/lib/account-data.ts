import { db } from "@/db";
import {
  accounts,
  aiGenerations,
  aiSetupPlans,
  customWeightUsage,
  dismissedMakeups,
  athleteInjuries,
  illnessPeriods,
  workouts,
  workoutStepResults,
  athleteProfiles,
  athleteThresholds,
  coachMemory,
  exerciseNotes,
  exercisePrs,
  exercises,
  feedback,
  friendships,
  garminActivities,
  garminActivityFiles,
  garminActivityMetrics,
  garminActivityStreams,
  garminConnections,
  garminDailyMetrics,
  garminDays,
  garminFuelLogs,
  garminSyncRuns,
  gyms,
  inviteTokens,
  nudges,
  oauthAccessTokens,
  oauthClientResources,
  oauthClients,
  oauthConsents,
  oauthRefreshTokens,
  planRevisions,
  programExercises,
  programSets,
  programShares,
  programs,
  seasonRaces,
  seasons,
  plannedSessions,
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

  // plan-read: includes deleted (the export holds all of the user's data)
  const programRows = await db.select().from(programs).where(eq(programs.userId, userId));
  const programIds = programRows.map((p) => p.id);
  const programExerciseRows = programIds.length
    ? // plan-read: includes deleted (the export holds all of the user's data)
      await db.select().from(programExercises).where(inArray(programExercises.programId, programIds))
    : [];
  const programExerciseIds = programExerciseRows.map((pe) => pe.id);

  const sessionRows = await db.select().from(workoutSessions).where(eq(workoutSessions.userId, userId));
  const sessionIds = sessionRows.map((s) => s.id);

  // plan-read: includes deleted (the export holds all of the user's data)
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
    garmin_connections: await db
      .select(columnsWithout(garminConnections, ["encryptedKey"]))
      .from(garminConnections)
      .where(eq(garminConnections.userId, userId)),
    garmin_days: await db.select().from(garminDays).where(eq(garminDays.userId, userId)),
    garmin_activities: await db.select().from(garminActivities).where(eq(garminActivities.userId, userId)),
    // The original file's content is in garmin_activity_streams; the ZIP itself isn't JSON.
    garmin_activity_files: await db
      .select(columnsWithout(garminActivityFiles, ["zip"]))
      .from(garminActivityFiles)
      .where(eq(garminActivityFiles.userId, userId)),
    garmin_activity_streams: await db.select().from(garminActivityStreams).where(eq(garminActivityStreams.userId, userId)),
    garmin_activity_metrics: await db.select().from(garminActivityMetrics).where(eq(garminActivityMetrics.userId, userId)),
    garmin_daily_metrics: await db.select().from(garminDailyMetrics).where(eq(garminDailyMetrics.userId, userId)),
    garmin_sync_runs: await db.select().from(garminSyncRuns).where(eq(garminSyncRuns.userId, userId)),
    garmin_fuel_logs: await db.select().from(garminFuelLogs).where(eq(garminFuelLogs.userId, userId)),
    programs: programRows,
    program_exercises: programExerciseRows,
    program_sets: programExerciseIds.length
      ? // plan-read: includes deleted (the export holds all of the user's data)
        await db.select().from(programSets).where(inArray(programSets.programExerciseId, programExerciseIds))
      : [],
    training_cycles: cycleRows,
    training_cycle_slots: cycleIds.length
      ? await db.select().from(trainingCycleSlots).where(inArray(trainingCycleSlots.trainingCycleId, cycleIds))
      : [],
    // The change history of the user's programs and cycles (docs/plans/revisions.md, 6).
    plan_revisions: await db.select().from(planRevisions).where(eq(planRevisions.userId, userId)),
    coach_memory: await db.select().from(coachMemory).where(eq(coachMemory.userId, userId)),
    // The athlete profile (docs/plans/athlete-profile.md, 4).
    athlete_profiles: await db.select().from(athleteProfiles).where(eq(athleteProfiles.userId, userId)),
    athlete_thresholds: await db.select().from(athleteThresholds).where(eq(athleteThresholds.userId, userId)),
    athlete_injuries: await db.select().from(athleteInjuries).where(eq(athleteInjuries.userId, userId)),
    // plan-read: includes deleted (the export holds all of the user's data)
    workouts: await db.select().from(workouts).where(eq(workouts.userId, userId)),
    // plan-read: includes deleted (the export holds all of the user's data)
    illness_periods: await db.select().from(illnessPeriods).where(eq(illnessPeriods.userId, userId)),
    // Per-step results of structured sessions (docs/plans/endurance-app.md, 9).
    workout_step_results: await db.select().from(workoutStepResults).where(eq(workoutStepResults.userId, userId)),
    // Seasons and their races (docs/plans/seasons.md, 4), deleted ones too.
    // plan-read: includes deleted (the export holds all of the user's data)
    seasons: await db.select().from(seasons).where(eq(seasons.userId, userId)),
    season_races: await db.select().from(seasonRaces).where(eq(seasonRaces.userId, userId)),
    // Dated sessions of the cycles (docs/plans/sessions.md, 10), removed ones too.
    // plan-read: includes deleted (the export holds all of the user's data)
    planned_sessions: await db.select().from(plannedSessions).where(eq(plannedSessions.userId, userId)),
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
