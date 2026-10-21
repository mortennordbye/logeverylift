/**
 * Fake data seed script
 *
 * Populates DEMO_USER_ID=1 with realistic programs, a training cycle,
 * and 4 weeks of workout history. Safe to run multiple times — exits
 * early if fake data already exists unless --force flag is passed.
 *
 * Usage (inside Docker):
 *   docker-compose exec app pnpm db:seed-fake
 *   docker-compose exec app pnpm db:seed-fake --force  # wipe first
 */

import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { programs, trainingCycles, users, workoutSessions } from "../src/db/schema";
import { seedDemoData } from "./lib/demo-data";

const FORCE = process.argv.includes("--force");

async function seedFake() {
  console.log("🏋️  Seeding fake data...");

  // Resolve user ID
  const targetEmail = process.env.USER_EMAIL;
  const user = targetEmail
    ? await db.query.users.findFirst({ where: eq(users.email, targetEmail) })
    : await db.query.users.findFirst();

  if (!user) {
    console.error("❌ No users found. Run `pnpm create-admin` first.");
    process.exit(1);
  }
  const DEMO_USER_ID = user.id;
  console.log(`👤 Seeding for user: ${user.email}`);

  // Check if fake data already exists
  const existingPrograms = await db
    .select({ id: programs.id })
    .from(programs)
    .where(eq(programs.userId, DEMO_USER_ID));

  if (existingPrograms.length > 0 && !FORCE) {
    console.log(
      `ℹ️  Demo user already has ${existingPrograms.length} program(s). Run with --force to overwrite.`
    );
    process.exit(0);
  }

  if (FORCE && existingPrograms.length > 0) {
    console.log("🗑️  --force: clearing existing user data first...");
    await db
      .delete(workoutSessions)
      .where(eq(workoutSessions.userId, DEMO_USER_ID));
    await db.delete(programs).where(eq(programs.userId, DEMO_USER_ID));
    await db
      .delete(trainingCycles)
      .where(eq(trainingCycles.userId, DEMO_USER_ID));
    console.log("✅ Cleared");
  }

  await seedDemoData(db, DEMO_USER_ID);

  const sessionCount = await db
    .select({ id: workoutSessions.id })
    .from(workoutSessions)
    .where(eq(workoutSessions.userId, DEMO_USER_ID));

  console.log(`✅ Created ${sessionCount.length} workout sessions with sets`);
  console.log("✅ Fake data seeding completed");
  process.exit(0);
}

seedFake().catch((err) => {
  console.error("❌ Fake seed failed:", err);
  process.exit(1);
});
