import { db } from "@/db";
import { garminDays } from "@/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { localDate } from "./dates";

/**
 * Today's date where the user is, from the time zone in their Garmin profile
 * snapshot; UTC without one. A UTC date runs a day late after local midnight
 * east of Greenwich (race countdown, the Monday week split).
 */
export async function garminToday(userId: string, now = new Date()): Promise<string> {
  const [row] = await db
    .select({ tz: sql<string | null>`${garminDays.data}->>'timeZone'` })
    .from(garminDays)
    .where(and(eq(garminDays.userId, userId), eq(garminDays.kind, "profile")))
    .orderBy(desc(garminDays.calendarDate))
    .limit(1);
  return localDate(now, row?.tz ?? null);
}
