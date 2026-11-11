/**
 * Settings Page
 *
 * App settings including theme preferences and other configurations.
 */

import { SettingsClient } from "@/components/features/SettingsClient";
import { db } from "@/db";
import { garminConnections, users } from "@/db/schema";
import { env } from "@/lib/env";
import { requireSession } from "@/lib/utils/session";
import { eq } from "drizzle-orm";

export default async function SettingsPage() {
  const auth = await requireSession();
  const [pref] = await db
    .select({ missedWorkoutsEnabled: users.missedWorkoutsEnabled })
    .from(users)
    .where(eq(users.id, auth.user.id));
  const [garminConn] = env.GARMIN_KEY_ENCRYPTION_KEY
    ? await db
        .select({ lastSyncedAt: garminConnections.lastSyncedAt })
        .from(garminConnections)
        .where(eq(garminConnections.userId, auth.user.id))
    : [];

  return (
    <SettingsClient
      missedWorkoutsEnabled={pref?.missedWorkoutsEnabled ?? true}
      garmin={
        env.GARMIN_KEY_ENCRYPTION_KEY
          ? { connected: Boolean(garminConn), lastSyncedAt: garminConn?.lastSyncedAt?.toISOString() ?? null }
          : null
      }
    />
  );
}
