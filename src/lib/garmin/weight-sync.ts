/**
 * Opt-in (garmin_connections.sync_weight): copy Garmin weigh-ins into the
 * profile's weight history, and set the profile's body weight to the newest
 * entry from either source. A weigh-in is copied once: an entry already at its
 * exact time is not added again, so this runs after every import.
 */

import { db } from "@/db";
import { garminConnections, garminDays } from "@/db/schema";
import { users } from "@/db/schema/users";
import { userWeightEntries } from "@/db/schema/weight-history";
import { and, desc, eq } from "drizzle-orm";
import { garminWeighIns } from "./weigh-ins";

/** Copies new weigh-ins when the user opted in. Returns how many were added. */
export async function syncGarminWeight(userId: string): Promise<number> {
  const [conn] = await db.select({ syncWeight: garminConnections.syncWeight }).from(garminConnections).where(eq(garminConnections.userId, userId));
  if (!conn?.syncWeight) return 0;

  const rows = await db.select({ data: garminDays.data }).from(garminDays).where(and(eq(garminDays.userId, userId), eq(garminDays.kind, "weight_entries")));
  const weighIns = garminWeighIns(rows.map((r) => r.data));
  if (!weighIns.length) return 0;

  const have = new Set(
    (await db.select({ at: userWeightEntries.recordedAt }).from(userWeightEntries).where(eq(userWeightEntries.userId, userId))).map((r) => r.at.getTime()),
  );
  const fresh = weighIns.filter((w) => !have.has(w.at.getTime()));
  if (fresh.length) {
    await db.insert(userWeightEntries).values(fresh.map((w) => ({ id: crypto.randomUUID(), userId, weightKg: w.kg, recordedAt: w.at })));
  }

  // The newest entry from either source is the body weight plans and progression use.
  const [newest] = await db
    .select({ kg: userWeightEntries.weightKg })
    .from(userWeightEntries)
    .where(eq(userWeightEntries.userId, userId))
    .orderBy(desc(userWeightEntries.recordedAt))
    .limit(1);
  if (newest) await db.update(users).set({ weightKg: newest.kg }).where(eq(users.id, userId));
  return fresh.length;
}
