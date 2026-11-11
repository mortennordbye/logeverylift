import type { Sport } from "../analytics/sport";

/** Colours the chart builders use, read from the CSS --viz-* roles (globals.css). */
export type VizTheme = {
  text: string;
  textMuted: string;
  grid: string;
  surface: string;
  sport: Record<Sport, string>;
  band: { low: string; mid: string; high: string };
  positive: string;
  negative: string;
  status: { good: string; warning: string; serious: string; critical: string };
};

/** One-letter marks so a sport is never told by colour alone (3.1). */
export const SPORT_MARK: Record<Sport, string> = { swim: "S", bike: "B", run: "R", strength: "G", other: "O" };
export const SPORT_LABEL: Record<Sport, string> = { swim: "Swim", bike: "Bike", run: "Run", strength: "Strength", other: "Other" };
