import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { assertTestDatabase } from "../../scripts/lib/test-database";
import { seedDemoData } from "../../scripts/lib/demo-data";
import * as schema from "../../src/db/schema";
import {
  aiGenerations,
  aiSetupPlans,
  customWeightUsage,
  dismissedMakeups,
  exercisePrs,
  exercises,
  programs,
  trainingCycles,
  users,
  userWeightEntries,
  workoutSessions,
} from "../../src/db/schema";
import { E2E_USER_EMAIL } from "./env";

/**
 * Put the e2e user's data back to the seeded state.
 *
 * Every spec starts from here, so none depends on what an earlier one left
 * behind: a spec that logs a set, reorders a list or imports a plan no longer
 * has to undo it, and a failure mid-spec cannot poison the next run. The auth
 * rows are left alone, so the stored login stays valid.
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

export async function resetE2EUser(): Promise<void> {
  const db = testDb();
  const user = await db.query.users.findFirst({ where: eq(users.email, E2E_USER_EMAIL) });
  if (!user) {
    throw new Error(`e2e user ${E2E_USER_EMAIL} does not exist. Run scripts/e2e-prepare.ts first.`);
  }
  const userId = user.id;

  await db.transaction(async (tx) => {
    // Sessions first: their sets reference program slots.
    await tx.delete(workoutSessions).where(eq(workoutSessions.userId, userId));
    await tx.delete(exercisePrs).where(eq(exercisePrs.userId, userId));
    await tx.delete(trainingCycles).where(eq(trainingCycles.userId, userId));
    await tx.delete(programs).where(eq(programs.userId, userId));
    await tx.delete(aiSetupPlans).where(eq(aiSetupPlans.userId, userId));
    await tx.delete(aiGenerations).where(eq(aiGenerations.userId, userId));
    await tx.delete(customWeightUsage).where(eq(customWeightUsage.userId, userId));
    await tx.delete(dismissedMakeups).where(eq(dismissedMakeups.userId, userId));
    await tx.delete(userWeightEntries).where(eq(userWeightEntries.userId, userId));
    await tx.delete(exercises).where(eq(exercises.userId, userId));
    await seedDemoData(tx, userId, seededRandom(20261021));
  });
}

export async function closeResetPool(): Promise<void> {
  await pool?.end();
  pool = null;
}
