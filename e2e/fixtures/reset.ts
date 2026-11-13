import { eq, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { assertTestDatabase } from "../../scripts/lib/test-database";
import { seedDemoData } from "../../scripts/lib/demo-data";
import * as schema from "../../src/db/schema";
import { LEGAL_VERSION } from "../../src/lib/constants/legal";
import {
  aiGenerations,
  aiSetupPlans,
  athleteInjuries,
  athleteProfiles,
  athleteThresholds,
  coachMemory,
  customWeightUsage,
  dismissedMakeups,
  exerciseNotes,
  exercisePrs,
  exercises,
  friendships,
  fuelLogs,
  fuelProducts,
  garminConnections,
  garminDailyMetrics,
  illnessPeriods,
  oauthConsents,
  planRevisions,
  programs,
  seasons,
  sweatTests,
  trainingCycles,
  users,
  userWeightEntries,
  workouts,
  workoutSessions,
} from "../../src/db/schema";

/**
 * Put one e2e account's data back to the seeded state.
 *
 * Every spec starts from here, so none depends on what an earlier one left
 * behind: a spec that logs a set, reorders a list or imports a plan no longer
 * has to undo it, and a failure mid-spec cannot poison the next run. The login
 * rows are left alone, so the stored login stays valid; connected assistants
 * (OAuth consents) are cleared, so More → Connected assistants starts empty.
 *
 * History is generated from a fixed seed. The suggestions and PR rows a spec
 * sees are derived from it, and with Math.random they would differ per run.
 */

let pool: pg.Pool | null = null;

/** The test database, for specs that check what a flow actually wrote. */
export function testDb() {
  pool ??= new pg.Pool({
    connectionString: assertTestDatabase(process.env.DATABASE_URL).toString(),
    max: 2,
  });
  return drizzle({ client: pool, schema });
}

/** mulberry32: small, fast, and the same sequence for the same seed. */
function seededRandom(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function resetE2EUser(email: string): Promise<void> {
  const db = testDb();
  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (!user) {
    throw new Error(`e2e user ${email} does not exist. Run scripts/e2e-prepare.ts first.`);
  }
  const userId = user.id;

  await db.transaction(async (tx) => {
    // The previous spec's last write can still be running on the server when
    // this reset starts. Take the locks that write takes, in its order, before
    // deleting anything, so one waits for the other instead of deadlocking:
    // a set write takes the per-exercise records lock (lockRecords) first and
    // then writes sets and records across this user's sessions; deleting the
    // sessions first could lock one it needed while it held another
    // ("deadlock detected while deleting tuple in relation workout_sessions").
    // A plan write locks cycles, then programs (planWrite), so those next.
    const exerciseIds = await tx.execute<{ id: number }>(sql`
      SELECT ws.exercise_id AS id FROM workout_sets ws JOIN workout_sessions s ON s.id = ws.session_id WHERE s.user_id = ${userId}
      UNION SELECT exercise_id FROM exercise_prs WHERE user_id = ${userId}
      ORDER BY 1`);
    for (const { id } of exerciseIds.rows) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}), ${id})`);
    }
    await tx.execute(sql`SELECT id FROM training_cycles WHERE user_id = ${userId} ORDER BY id FOR UPDATE`);
    await tx.execute(sql`SELECT id FROM programs WHERE user_id = ${userId} ORDER BY id FOR UPDATE`);
    // Sessions first: their sets reference program slots.
    await tx.delete(workoutSessions).where(eq(workoutSessions.userId, userId));
    // Fuel logs on app sessions go with them; these are the rest (docs/plans/nutrition-and-race-day.md).
    await tx.delete(fuelLogs).where(eq(fuelLogs.userId, userId));
    await tx.delete(fuelProducts).where(eq(fuelProducts.userId, userId));
    await tx.delete(sweatTests).where(eq(sweatTests.userId, userId));
    await tx.delete(exercisePrs).where(eq(exercisePrs.userId, userId));
    await tx.delete(trainingCycles).where(eq(trainingCycles.userId, userId));
    // Races go with their seasons (cascade).
    await tx.delete(seasons).where(eq(seasons.userId, userId));
    await tx.delete(programs).where(eq(programs.userId, userId));
    await tx.delete(planRevisions).where(eq(planRevisions.userId, userId));
    await tx.delete(coachMemory).where(eq(coachMemory.userId, userId));
    await tx.delete(athleteProfiles).where(eq(athleteProfiles.userId, userId));
    await tx.delete(athleteThresholds).where(eq(athleteThresholds.userId, userId));
    await tx.delete(athleteInjuries).where(eq(athleteInjuries.userId, userId));
    await tx.delete(illnessPeriods).where(eq(illnessPeriods.userId, userId));
    await tx.delete(workouts).where(eq(workouts.userId, userId));
    await tx.delete(aiSetupPlans).where(eq(aiSetupPlans.userId, userId));
    await tx.delete(aiGenerations).where(eq(aiGenerations.userId, userId));
    await tx.delete(customWeightUsage).where(eq(customWeightUsage.userId, userId));
    await tx.delete(dismissedMakeups).where(eq(dismissedMakeups.userId, userId));
    await tx.delete(exerciseNotes).where(eq(exerciseNotes.userId, userId));
    await tx.delete(userWeightEntries).where(eq(userWeightEntries.userId, userId));
    await tx.delete(oauthConsents).where(eq(oauthConsents.userId, userId));
    await tx.delete(exercises).where(eq(exercises.userId, userId));
    // A spec may connect Garmin and make the account an admin (readiness-swap, garmin).
    await tx.delete(garminDailyMetrics).where(eq(garminDailyMetrics.userId, userId));
    await tx.delete(garminConnections).where(eq(garminConnections.userId, userId));
    await tx
      .delete(friendships)
      .where(or(eq(friendships.requesterId, userId), eq(friendships.addresseeId, userId)));
    await seedDemoData(tx, userId, seededRandom(20261021));
    // Terms accepted, so the home screen doesn't send every spec to /consent;
    // AI editing not opted in, as for a new user.
    const now = new Date();
    await tx
      .update(users)
      .set({
        termsVersion: LEGAL_VERSION,
        policySeenVersion: LEGAL_VERSION,
        termsAcceptedAt: now,
        healthConsentAt: now,
        aiConsentAt: null,
        friendsSeenAt: now,
        primaryGymId: null,
        // Settings as for a new user: the browser fills the zone on first load.
        timeZone: null,
        distanceUnit: "km",
        swimUnit: "m",
        enduranceEnabled: false,
        role: "user",
      })
      .where(eq(users.id, userId));
  });
}

export async function closeResetPool(): Promise<void> {
  await pool?.end();
  pool = null;
}
