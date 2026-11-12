/**
 * Who may use the Garmin section. Garmin's Personal API is "intended for
 * individual Garmin users who want programmatic access to their own data" and
 * "not intended for commercial applications serving multiple end users"
 * (Garmin Connect Personal API FAQ). So it is the owner's tool: on only where
 * the encryption key is set, and only for admin accounts. Opening it to every
 * user needs the Garmin Connect Developer Program (BACKLOG.md).
 */

import { db } from "@/db";
import { users } from "@/db/schema";
import { env } from "@/lib/env";
import { eq } from "drizzle-orm";

export function garminAllowed(role: string | null | undefined): boolean {
  return Boolean(env.GARMIN_KEY_ENCRYPTION_KEY) && role === "admin";
}

/** For callers with only a user id (the MCP route). */
export async function garminAllowedFor(userId: string): Promise<boolean> {
  if (!env.GARMIN_KEY_ENCRYPTION_KEY) return false;
  const [u] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId));
  return garminAllowed(u?.role);
}
