/**
 * Settings Page
 *
 * App settings including theme preferences and other configurations.
 */

import { SettingsClient } from "@/components/features/SettingsClient";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireSession } from "@/lib/utils/session";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const auth = await requireSession();
  const [pref] = await db
    .select({ missedWorkoutsEnabled: users.missedWorkoutsEnabled })
    .from(users)
    .where(eq(users.id, auth.user.id));

  return (
    <SettingsClient
      missedWorkoutsEnabled={pref?.missedWorkoutsEnabled ?? true}
    />
  );
}
