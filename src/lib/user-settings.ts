/**
 * The user's time zone and display units, for server code that has a resolved
 * userId (Server Components, Server Actions after requireSession, the weekly
 * sync, MCP tools). Read once per request.
 */

import { db } from "@/db";
import { users } from "@/db/schema";
import { DEFAULT_UNITS, type Units } from "@/lib/utils/units";
import { todayIn } from "@/lib/utils/user-date";
import { eq } from "drizzle-orm";
import { cache } from "react";

export type UserSettings = {
  timeZone: string | null;
  units: Units;
  /** The raw `home_layout` column; parse it with parseStoredLayout (src/lib/home/layout.ts). */
  homeLayout: unknown;
};

export const getUserSettings = cache(async (userId: string): Promise<UserSettings> => {
  const [row] = await db
    .select({
      timeZone: users.timeZone,
      distanceUnit: users.distanceUnit,
      swimUnit: users.swimUnit,
      homeLayout: users.homeLayout,
    })
    .from(users)
    .where(eq(users.id, userId));
  if (!row) return { timeZone: null, units: DEFAULT_UNITS, homeLayout: null };
  return {
    timeZone: row.timeZone,
    units: { distance: row.distanceUnit, swim: row.swimUnit },
    homeLayout: row.homeLayout,
  };
});

/** Today for this user, as a local-midnight Date (see todayIn). */
export async function userToday(userId: string, now: Date = new Date()): Promise<Date> {
  const { timeZone } = await getUserSettings(userId);
  return todayIn(timeZone, now);
}
