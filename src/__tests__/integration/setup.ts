import { sql } from "drizzle-orm";
import { afterAll, beforeEach, vi } from "vitest";

/**
 * Per-file setup for the integration project.
 *
 * Two things are faked, and only these:
 * - **Who is calling.** `requireSession` returns `asUser`'s user, so a test can
 *   call an action as one user and then as another to check ownership.
 * - **Next's cache invalidation**, which needs a request context these tests
 *   don't have and has nothing to assert on.
 *
 * Everything else, the queries in particular, runs against the real database.
 */

let currentUser: { id: string; role: "user" | "admin" } | null = null;

/** Make the next actions run as this user. */
export function asUser(id: string, role: "user" | "admin" = "user") {
  currentUser = { id, role };
}

vi.mock("@/lib/utils/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils/session")>();
  const requireSession = async () => {
    if (!currentUser) throw new Error("integration test called an action without asUser()");
    return { user: { ...currentUser, name: "Test", email: `${currentUser.id}@test.local` }, session: {} };
  };
  return {
    ...actual,
    requireSession,
    getOptionalSession: requireSession,
    requireAdmin: async () => {
      const s = await requireSession();
      if (s.user.role !== "admin") throw new actual.ForbiddenError("Admin access required");
      return s;
    },
  };
});

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  updateTag: () => {},
  refresh: () => {},
}));

beforeEach(async () => {
  if (process.env.INTEGRATION_DB_ERROR) throw new Error(process.env.INTEGRATION_DB_ERROR);
  currentUser = null;
  const { db } = await import("@/db");
  // Every table but the migrations journal, in one statement so foreign keys
  // don't dictate an order.
  const { rows } = await db.execute<{ tablename: string }>(
    sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
  );
  if (rows.length) {
    await db.execute(
      sql.raw(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`),
    );
  }
});

afterAll(async () => {
  const { pool } = await import("@/db");
  await pool.end();
});
