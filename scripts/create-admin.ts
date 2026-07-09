/**
 * Create Admin User
 *
 * Run once after initial deployment to create the first admin account.
 * Usage: docker-compose exec app pnpm tsx scripts/create-admin.ts
 *
 * The admin can then create additional accounts via /settings/users.
 */

import { auth } from "../src/lib/auth";

const DEFAULT_ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@example.com";
const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "changeme123";
const DEFAULT_ADMIN_NAME = process.env.ADMIN_NAME ?? "Admin";

async function main() {
  console.log(`Creating admin user: ${DEFAULT_ADMIN_EMAIL}`);

  try {
    const result = await auth.api.signUpEmail({
      body: {
        name: DEFAULT_ADMIN_NAME,
        email: DEFAULT_ADMIN_EMAIL,
        password: DEFAULT_ADMIN_PASSWORD,
      },
    });

    if (!result?.user) {
      throw new Error("Signup returned no user");
    }

    // Promote to admin role by directly updating the DB record.
    // The admin plugin's setRole endpoint requires a session, but during
    // bootstrapping we don't have one — so we update the user table directly.
    const { db } = await import("../src/db");
    const { users } = await import("../src/db/schema");
    const { eq } = await import("drizzle-orm");
    await db
      .update(users)
      .set({ role: "admin" })
      .where(eq(users.id, result.user.id));

    console.log(`✓ Admin created: ${DEFAULT_ADMIN_EMAIL}`);
    console.log(`  Password: ${DEFAULT_ADMIN_PASSWORD}`);
    console.log("");
    console.log("⚠  Change this password immediately after first login.");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.toLowerCase().includes("already") || message.toLowerCase().includes("unique")) {
      console.log(`ℹ  User ${DEFAULT_ADMIN_EMAIL} already exists.`);
      console.log("   Use /settings/users to manage roles.");
    } else {
      console.error("Failed to create admin user:", message);
      process.exit(1);
    }
  }

  process.exit(0);
}

main();
