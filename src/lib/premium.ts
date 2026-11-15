/**
 * Premium: the add-ons that fill fields the user can also type, such as
 * Garmin (docs/plans/account-profile.md, 6). For now Premium is the admin role.
 */

import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

export function isPremium(role: string | null | undefined): boolean {
  return role === "admin";
}

/** For callers with only a user id. */
export async function premiumFor(userId: string): Promise<boolean> {
  const [u] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId));
  return isPremium(u?.role);
}
