import type { HomeContext } from "@/lib/home/core";
import { formBandLabel } from "@/lib/garmin/charts/load";
import { loadSummary } from "@/lib/home/widget-data";
import { getTrainingLoad } from "@/lib/training-load";

/**
 * Four weeks of daily load and the 7-day fatigue line, the load of the last
 * 7 days, and today's form and band (null when the newest data is older than
 * yesterday).
 */
export type TrainingLoadData = {
  loads: number[];
  fatigue: number[];
  form: number | null;
  formLabel: string | null;
  weekLoad: number;
  ramp: "normal" | "fast" | "warning" | null;
};

const DAYS = 28;

/**
 * From getTrainingLoad, which already picks the source: the stored Garmin
 * series when Garmin is allowed for this account (garminAllowedFor) and has
 * days, else the user's own endurance sessions. Both filter by userId. The
 * days are placed by date (loadSummary), since the Garmin series can miss days.
 * Null when the four weeks hold no load, for the empty state.
 */
export async function loadTrainingLoad(ctx: HomeContext): Promise<TrainingLoadData | null> {
  const t = await getTrainingLoad(ctx.userId, DAYS);
  const s = loadSummary(
    t.days.map((d) => ({ date: d.date, load: d.tracks?.total?.load, atl: d.tracks?.total?.atl, tsb: d.tracks?.total?.tsb })),
    ctx.today,
    DAYS,
  );
  if (!s) return null;
  return { ...s, formLabel: s.form === null ? null : formBandLabel(s.form), ramp: t.rampBand };
}
