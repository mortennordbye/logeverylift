/**
 * The render side of every home widget, by id (docs/home-widgets-audit.md,
 * 6.5). One import line per widget.
 */

import type { Renderer } from "@/components/features/home/define-widget";
import type { WidgetId } from "@/lib/home/widgets";
import { cycleWidget } from "./cycle/View";
import { enduranceTodayWidget } from "./endurance-today/View";
import { titleWidget } from "./title/View";
import { todayWidget } from "./today/View";
import { weekWidget } from "./week/View";
import { weeklyGoalWidget } from "./weekly-goal/View";

export const RENDERERS = {
  title: titleWidget,
  today: todayWidget,
  cycle: cycleWidget,
  enduranceToday: enduranceTodayWidget,
  week: weekWidget,
  weeklyGoal: weeklyGoalWidget,
} satisfies Partial<Record<WidgetId, Renderer>>;
