"use client";

import { type ClientUserSettings, setUserSettings } from "@/contexts/user-settings-context";
import { setTimeZone } from "@/lib/actions/user-settings";
import { callAction } from "@/lib/utils/stale-bundle";
import { useEffect } from "react";

/**
 * Puts the server's settings into the user-settings store, and fills the time
 * zone once from the browser while none is stored. It never changes a stored
 * zone: the user may have picked one on purpose (Settings offers the phone's
 * zone when they differ).
 */
export function UserSettingsHydrator({
  settings,
  fillTimeZone,
}: {
  settings: ClientUserSettings;
  fillTimeZone: boolean;
}) {
  const { timeZone } = settings;
  const { distance, swim } = settings.units;

  useEffect(() => {
    setUserSettings({ timeZone, units: { distance, swim } });
  }, [timeZone, distance, swim]);

  useEffect(() => {
    if (timeZone || !fillTimeZone) return;
    const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!browserZone) return;
    void (async () => {
      const result = await callAction(setTimeZone({ timeZone: browserZone, ifUnset: true }));
      if (result.success) setUserSettings({ timeZone: browserZone, units: { distance, swim } });
    })();
  }, [timeZone, fillTimeZone, distance, swim]);

  return null;
}
