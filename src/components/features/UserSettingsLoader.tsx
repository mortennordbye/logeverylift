import { UserSettingsHydrator } from "@/components/features/UserSettingsHydrator";
import { getUserSettings } from "@/lib/user-settings";
import { getOptionalSession } from "@/lib/utils/session";

/**
 * Streams the signed-in user's time zone and units into the user-settings
 * store, or resets the store when nobody is signed in.
 */
export async function UserSettingsLoader() {
  const session = await getOptionalSession();
  if (!session) return <UserSettingsHydrator settings={null} fillTimeZone={false} />;
  const { timeZone, units } = await getUserSettings(session.user.id);
  // An admin viewing as the user must not fill in the admin's own zone.
  // Only the zone and units go to the client, not the home layout.
  return <UserSettingsHydrator settings={{ timeZone, units }} fillTimeZone={!session.session.impersonatedBy} />;
}
