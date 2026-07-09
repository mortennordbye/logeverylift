/**
 * Reset user data script
 *
 * Deletes all user-specific data for a given user while keeping the user
 * record and the exercise library intact.
 *
 * Usage (inside Docker):
 *   docker-compose exec app pnpm db:reset-user                            # uses first user
 *   USER_EMAIL=you@example.com docker-compose exec app pnpm db:reset-user # specific user
 */

import { eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  programs,
  trainingCycles,
  users,
  workoutSessions,
} from "../src/db/schema";

async function resetUser() {
  const email = process.env.USER_EMAIL;

  let userId: string;

  if (email) {
    const user = await db.query.users.findFirst({ where: eq(users.email, email) });
    if (!user) {
      console.error(`❌ No user found with email: ${email}`);
      process.exit(1);
    }
    userId = user.id;
    console.log(`🗑️  Resetting data for user: ${email} (${userId})`);
  } else {
    const first = await db.query.users.findFirst();
    if (!first) {
      console.error("❌ No users found in database. Run create-admin first.");
      process.exit(1);
    }
    userId = first.id;
    console.log(`🗑️  Resetting data for first user: ${first.email} (${userId})`);
  }

  const deletedSessions = await db
    .delete(workoutSessions)
    .where(eq(workoutSessions.userId, userId))
    .returning({ id: workoutSessions.id });

  const deletedPrograms = await db
    .delete(programs)
    .where(eq(programs.userId, userId))
    .returning({ id: programs.id });

  const deletedCycles = await db
    .delete(trainingCycles)
    .where(eq(trainingCycles.userId, userId))
    .returning({ id: trainingCycles.id });

  console.log(`✅ Deleted ${deletedSessions.length} workout session(s) (+ sets)`);
  console.log(`✅ Deleted ${deletedPrograms.length} program(s) (+ exercises + sets)`);
  console.log(`✅ Deleted ${deletedCycles.length} training cycle(s) (+ slots)`);
  console.log("✅ Reset complete — user record and exercises are untouched");
  process.exit(0);
}

resetUser().catch((err) => {
  console.error("❌ Reset failed:", err);
  process.exit(1);
});
