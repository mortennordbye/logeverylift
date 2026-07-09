import { eq } from "drizzle-orm";
import pg from "pg";
import { db } from "../src/db";
import { users, workoutSessions } from "../src/db/schema";

const { Pool } = pg;

async function diagnose() {
  console.log("🔍 Database Diagnostics\n");
  console.log("=".repeat(60));

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    // 1. Test basic connectivity
    console.log("\n1️⃣  Testing Database Connectivity...");
    const connectTest = await pool.query("SELECT NOW()");
    console.log("   ✅ Connected:", connectTest.rows[0].now);

    // 2. Check migration state
    console.log("\n2️⃣  Checking Migration State...");
    try {
      const migrationsResult = await pool.query(
        "SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at",
      );
      console.log(
        `   ✅ Migrations table exists (${migrationsResult.rows.length} entries)`,
      );
      migrationsResult.rows.forEach((row, idx) => {
        const date = new Date(parseInt(row.created_at));
        console.log(
          `      ${idx + 1}. ${row.hash.substring(0, 12)}... (${date.toISOString()})`,
        );
      });
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      if (err.code === "42P01") {
        console.log("   ⚠️  Migrations table does not exist");
      } else {
        console.log("   ❌ Error checking migrations:", err.message);
      }
    }

    // 3. Check tables exist
    console.log("\n3️⃣  Checking Tables...");
    const tables = ["users", "exercises", "workout_sessions", "workout_sets"];
    for (const table of tables) {
      const result = await pool.query(
        `
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' AND table_name = $1
        )
      `,
        [table],
      );
      const exists = result.rows[0].exists;
      console.log(`   ${exists ? "✅" : "❌"} ${table}`);
    }

    // 4. Count records
    console.log("\n4️⃣  Record Counts...");
    const usersCount = await pool.query("SELECT COUNT(*) FROM users");
    const exercisesCount = await pool.query("SELECT COUNT(*) FROM exercises");
    const sessionsCount = await pool.query(
      "SELECT COUNT(*) FROM workout_sessions",
    );
    const setsCount = await pool.query("SELECT COUNT(*) FROM workout_sets");

    console.log(`   Users: ${usersCount.rows[0].count}`);
    console.log(`   Exercises: ${exercisesCount.rows[0].count}`);
    console.log(`   Workout Sessions: ${sessionsCount.rows[0].count}`);
    console.log(`   Workout Sets: ${setsCount.rows[0].count}`);

    // 5. Check demo user
    console.log("\n5️⃣  Demo User...");
    const demoUser = await db.query.users.findFirst({
      where: eq(users.email, "demo@example.com"),
    });
    if (demoUser) {
      console.log(`   ✅ Found (ID: ${demoUser.id})`);
    } else {
      console.log("   ❌ Not found");
    }

    // 6. Test workout session creation
    console.log("\n6️⃣  Testing Workout Session Creation...");
    if (demoUser) {
      try {
        const testSession = await db
          .insert(workoutSessions)
          .values({
            userId: demoUser.id,
            date: new Date().toISOString().split("T")[0],
            startTime: new Date(),
            isCompleted: false,
          })
          .returning();

        console.log(`   ✅ Created test session (ID: ${testSession[0].id})`);

        // Clean up
        await db
          .delete(workoutSessions)
          .where(eq(workoutSessions.id, testSession[0].id));
        console.log("   ✅ Cleaned up test session");
      } catch (e: unknown) {
        const err = e as { message?: string; code?: string; detail?: string };
        console.log("   ❌ Failed:", err.message);
        console.log("      Error code:", err.code);
        console.log("      Error detail:", err.detail);
      }
    } else {
      console.log("   ⏭️  Skipped (no demo user)");
    }

    // 7. Check for active sessions
    console.log("\n7️⃣  Active Sessions...");
    if (demoUser) {
      const activeSessions = await db.query.workoutSessions.findMany({
        where: (sessions, { eq, and }) =>
          and(
            eq(sessions.userId, demoUser.id),
            eq(sessions.isCompleted, false),
          ),
      });
      console.log(`   Found ${activeSessions.length} active session(s)`);
      activeSessions.forEach((session) => {
        console.log(`      Session ${session.id}: ${session.date}`);
      });
    }

    console.log("\n" + "=".repeat(60));
    console.log("✅ Diagnostics completed\n");
  } catch (error) {
    console.error("\n❌ Diagnostic failed:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

diagnose();
