/**
 * Settings Page
 *
 * App settings including theme preferences and other configurations.
 */

import { SettingsClient } from "@/components/features/SettingsClient";
import { db } from "@/db";
import { garminConnections, users } from "@/db/schema";
import { requireSession } from "@/lib/utils/session";
import { eq } from "drizzle-orm";
import { garminAllowed } from "@/lib/garmin/access";

export default async function SettingsPage() {
  const auth = await requireSession();
  const [pref] = await db
    .select({
      missedWorkoutsEnabled: users.missedWorkoutsEnabled,
      timeZone: users.timeZone,
      distanceUnit: users.distanceUnit,
      swimUnit: users.swimUnit,
      enduranceEnabled: users.enduranceEnabled,
    })
    .from(users)
    .where(eq(users.id, auth.user.id));
  const garminOn = garminAllowed(auth.user.role);
  const [garminConn] = garminOn
    ? await db
        .select({ lastSyncedAt: garminConnections.lastSyncedAt })
        .from(garminConnections)
        .where(eq(garminConnections.userId, auth.user.id))
    : [];

  return (
    <SettingsClient
      missedWorkoutsEnabled={pref?.missedWorkoutsEnabled ?? true}
      unitsAndTime={{
        timeZone: pref?.timeZone ?? null,
        distanceUnit: pref?.distanceUnit ?? "km",
        swimUnit: pref?.swimUnit ?? "m",
        enduranceEnabled: pref?.enduranceEnabled ?? false,
      }}
      garmin={
        garminOn
          ? { connected: Boolean(garminConn), lastSyncedAt: garminConn?.lastSyncedAt?.toISOString() ?? null }
          : null
      }
    />
  );
}
