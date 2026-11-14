/**
 * Every home widget (docs/home-widgets-audit.md, 6.5). One import line per
 * widget; the order here is the gallery order. Ids are never reused: a removed
 * widget's id goes to RETIRED_IDS.
 */

import { bodyWeight } from "./body-weight";
import { cycle } from "./cycle";
import { enduranceToday } from "./endurance-today";
import { friendsActivity } from "./friends-activity";
import { garminReadiness } from "./garmin-readiness";
import { raceCountdown } from "./race-countdown";
import { recentPrs } from "./recent-prs";
import { streak } from "./streak";
import { title } from "./title";
import { today } from "./today";
import { trainingLoad } from "./training-load";
import type { WidgetDef } from "./types";
import { week } from "./week";
import { weeklyGoal } from "./weekly-goal";
import { weeklySets } from "./weekly-sets";

export const WIDGETS = {
  title,
  today,
  cycle,
  enduranceToday,
  week,
  weeklyGoal,
  raceCountdown,
  trainingLoad,
  recentPrs,
  streak,
  weeklySets,
  bodyWeight,
  friendsActivity,
  garminReadiness,
} as const satisfies Record<string, WidgetDef>;

export type WidgetId = keyof typeof WIDGETS;

export const RETIRED_IDS: readonly string[] = [];

export function isWidgetId(id: string): id is WidgetId {
  return Object.hasOwn(WIDGETS, id) && !RETIRED_IDS.includes(id);
}

/** The def, typed as the general contract. */
export function widgetDef(id: WidgetId): WidgetDef {
  return WIDGETS[id];
}
