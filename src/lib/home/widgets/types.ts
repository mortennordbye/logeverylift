/**
 * The home widget contract (docs/home-widgets-audit.md, 6.5). A def is pure
 * data: no React, no database. The render side lives in
 * src/components/features/home/widgets/.
 */

import type { z } from "zod";

export type WidgetSize = "s" | "m" | "l";
export type WidgetKind = "header" | "widget";
export type WidgetGroup = "training" | "prs" | "stats" | "garmin" | "friends" | "actions" | "coach";
/** Who the user is, for which widgets they can have. `cycle`: an active training cycle. */
export type Audience = { endurance: boolean; garmin: boolean; cycle: boolean };

export type WidgetDef = {
  /** Stable, never reused; retired ids go to RETIRED_IDS. */
  id: string;
  kind: WidgetKind;
  group: WidgetGroup;
  title: string;
  /** One line in the gallery. */
  description: string;
  sizes: readonly WidgetSize[];
  defaultSize: WidgetSize;
  /** Holds a start entry: not hideable, put back if missing. */
  critical: boolean;
  /** May fill the height left over when it is the last widget. */
  stretch?: boolean;
  source: "core" | "stream";
  available: (a: Audience) => boolean;
  defaultVisible: (a: Audience) => boolean;
  /** Ids and numbers only. */
  settings?: z.ZodType;
};

export const SIZE_LABEL: Record<WidgetSize, string> = { s: "Small", m: "Medium", l: "Large" };
