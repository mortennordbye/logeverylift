"use client";

import { type ClientUserSettings, resetUserSettings, setUserSettings } from "@/contexts/user-settings-context";
import { setTimeZone } from "@/lib/actions/user-settings";
import { callAction } from "@/lib/utils/stale-bundle";
import { useEffect } from "react";

/**
 * Puts the server's settings into the user-settings store, and fills the time
 * zone once from the browser while none is stored. It never changes a stored
 * zone: the user may have picked one on purpose (Settings offers the phone's
 * zone when they differ). With no signed-in user (`settings` null) it resets
 * the store, so a next account in the same tab starts from metric.
 */
export function UserSettingsHydrator({
  settings,
  fillTimeZone,
}: {
  settings: ClientUserSettings | null;
  fillTimeZone: boolean;
}) {
  const signedIn = settings != null;
  const timeZone = settings?.timeZone ?? null;
  const distance = settings?.units.distance ?? "km";
  const swim = settings?.units.swim ?? "m";

  useEffect(() => {
    if (!signedIn) {
      resetUserSettings();
      return;
    }
    setUserSettings({ timeZone, units: { distance, swim } });
  }, [signedIn, timeZone, distance, swim]);

  useEffect(() => {
    if (!signedIn || timeZone || !fillTimeZone) return;
    const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!browserZone) return;
    void (async () => {
      const result = await callAction(setTimeZone({ timeZone: browserZone, ifUnset: true }));
      if (result.success) setUserSettings({ timeZone: browserZone, units: { distance, swim } });
    })();
  }, [signedIn, timeZone, fillTimeZone, distance, swim]);

  return null;
}
