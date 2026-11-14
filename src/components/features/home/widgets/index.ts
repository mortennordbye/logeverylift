/**
 * The render side of every home widget, by id (docs/home-widgets-audit.md,
 * 6.5). One import line per widget. `satisfies Record<WidgetId, Renderer>`
 * makes tsc fail when a def in src/lib/home/widgets has no renderer.
 */

import type { Renderer } from "@/components/features/home/define-widget";
import type { WidgetId } from "@/lib/home/widgets";
import { bodyWeightWidget } from "./body-weight/View";
import { cycleWidget } from "./cycle/View";
import { dateWidget } from "./date/View";
import { enduranceTodayWidget } from "./endurance-today/View";
import { friendsActivityWidget } from "./friends-activity/View";
import { garminReadinessWidget } from "./garmin-readiness/View";
import { raceCountdownWidget } from "./race-countdown/View";
import { recentPrsWidget } from "./recent-prs/View";
import { streakWidget } from "./streak/View";
import { titleWidget } from "./title/View";
import { todayWidget } from "./today/View";
import { trainingLoadWidget } from "./training-load/View";
import { weekWidget } from "./week/View";
import { weeklyGoalWidget } from "./weekly-goal/View";
import { weeklySetsWidget } from "./weekly-sets/View";

export const RENDERERS = {
  title: titleWidget,
  today: todayWidget,
  cycle: cycleWidget,
  enduranceToday: enduranceTodayWidget,
  week: weekWidget,
  weeklyGoal: weeklyGoalWidget,
  recentPrs: recentPrsWidget,
  friendsActivity: friendsActivityWidget,
  garminReadiness: garminReadinessWidget,
  streak: streakWidget,
  bodyWeight: bodyWeightWidget,
  trainingLoad: trainingLoadWidget,
  weeklySets: weeklySetsWidget,
  raceCountdown: raceCountdownWidget,
  date: dateWidget,
} satisfies Record<WidgetId, Renderer>;
