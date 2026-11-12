import { UserSettingsHydrator } from "@/components/features/UserSettingsHydrator";
import { getUserSettings } from "@/lib/user-settings";
import { getOptionalSession } from "@/lib/utils/session";

/** Streams the signed-in user's time zone and units into UserSettingsProvider. */
export async function UserSettingsLoader() {
  const session = await getOptionalSession();
  if (!session) return null;
  const settings = await getUserSettings(session.user.id);
  // An admin viewing as the user must not fill in the admin's own zone.
  return <UserSettingsHydrator settings={settings} fillTimeZone={!session.session.impersonatedBy} />;
}
