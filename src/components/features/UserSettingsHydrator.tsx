"use client";

import { type ClientUserSettings, useSetUserSettings } from "@/contexts/user-settings-context";
import { setTimeZone } from "@/lib/actions/user-settings";
import { callAction } from "@/lib/utils/stale-bundle";
import { useEffect } from "react";

/**
 * Puts the server's settings into UserSettingsProvider, and fills the time
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
  const set = useSetUserSettings();
  const { timeZone } = settings;
  const { distance, swim } = settings.units;

  useEffect(() => {
    set?.({ timeZone, units: { distance, swim } });
  }, [set, timeZone, distance, swim]);

  useEffect(() => {
    if (timeZone || !fillTimeZone) return;
    const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!browserZone) return;
    void (async () => {
      const result = await callAction(setTimeZone({ timeZone: browserZone, ifUnset: true }));
      if (result.success) set?.({ timeZone: browserZone, units: { distance, swim } });
    })();
  }, [timeZone, fillTimeZone, set, distance, swim]);

  return null;
}
