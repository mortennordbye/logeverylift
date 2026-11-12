/**
 * The endurance add-on switch (decisions D15 and D18 in
 * docs/triathlon-coach-audit.md). One per-user flag turns on the triathlon plan,
 * the race on a cycle, and every later endurance feature. Only an admin can
 * set it for now (setUserEndurance in src/lib/actions/admin.ts), but nothing
 * may check the admin role instead of this flag: opening the add-on to more
 * users later must only change who may turn it on.
 *
 * Not a Server Action: it takes a resolved userId, for Server Components,
 * Server Actions after requireSession, and MCP tools.
 */

import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { cache } from "react";

export const enduranceEnabledFor = cache(async (userId: string): Promise<boolean> => {
  const [row] = await db
    .select({ on: users.enduranceEnabled })
    .from(users)
    .where(eq(users.id, userId));
  return row?.on ?? false;
});
