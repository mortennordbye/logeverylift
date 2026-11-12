"use client";

import { DEFAULT_UNITS, type Units } from "@/lib/utils/units";
import { createContext, useContext, useState } from "react";

/**
 * The signed-in user's time zone and display units, for Client Components.
 * The root layout cannot wait for the session (it would lose its static
 * shell), so the provider starts metric with no zone and
 * UserSettingsLoader, streamed in beside the page, fills it in through
 * UserSettingsHydrator.
 */

export type ClientUserSettings = { timeZone: string | null; units: Units };

type Ctx = ClientUserSettings & { set: (s: ClientUserSettings) => void };

const UserSettingsContext = createContext<Ctx | null>(null);

export function UserSettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<ClientUserSettings>({ timeZone: null, units: DEFAULT_UNITS });
  return (
    <UserSettingsContext.Provider value={{ ...settings, set: setSettings }}>{children}</UserSettingsContext.Provider>
  );
}

/** The user's settings; metric with no zone outside the provider or before it is filled. */
export function useUserSettings(): ClientUserSettings {
  const ctx = useContext(UserSettingsContext);
  return ctx ? { timeZone: ctx.timeZone, units: ctx.units } : { timeZone: null, units: DEFAULT_UNITS };
}

/** The user's display units. */
export function useUnits(): Units {
  return useUserSettings().units;
}

/** The provider's setter, for UserSettingsHydrator only. */
export function useSetUserSettings(): ((s: ClientUserSettings) => void) | undefined {
  return useContext(UserSettingsContext)?.set;
}
