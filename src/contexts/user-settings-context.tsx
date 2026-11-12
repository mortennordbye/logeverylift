"use client";

import { DEFAULT_UNITS, type Units } from "@/lib/utils/units";
import { useSyncExternalStore } from "react";

/**
 * The signed-in user's time zone and display units, for Client Components.
 *
 * A small store rather than a React context: a context provider has to wrap
 * the page in the root layout, and a client component around the page there
 * made the cacheComponents shell render each page twice in the DOM. The store
 * starts metric with no zone; UserSettingsLoader, streamed in beside the page,
 * fills it through UserSettingsHydrator.
 */

export type ClientUserSettings = { timeZone: string | null; units: Units };

const INITIAL: ClientUserSettings = { timeZone: null, units: DEFAULT_UNITS };

let current: ClientUserSettings = INITIAL;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** For UserSettingsHydrator only. A no-op when nothing changed. */
export function setUserSettings(next: ClientUserSettings) {
  if (
    next.timeZone === current.timeZone &&
    next.units.distance === current.units.distance &&
    next.units.swim === current.units.swim
  ) {
    return;
  }
  current = next;
  for (const l of listeners) l();
}

/**
 * Back to metric with no zone, for when nobody is signed in: the store lives
 * as long as the tab, so the next account must not see the last one's.
 */
export function resetUserSettings() {
  setUserSettings(INITIAL);
}

/** The user's settings; metric with no zone until they are loaded. */
export function useUserSettings(): ClientUserSettings {
  return useSyncExternalStore(subscribe, () => current, () => INITIAL);
}

/** The user's display units. */
export function useUnits(): Units {
  return useUserSettings().units;
}
