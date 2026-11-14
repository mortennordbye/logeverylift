import type { HomeContext } from "@/lib/home/core";
import { formBandLabel } from "@/lib/garmin/charts/load";
import { getTrainingLoad } from "@/lib/training-load";

/** Four weeks of daily load and the 7-day fatigue line, today's form and band, and this week's load. */
export type TrainingLoadData = {
  loads: number[];
  fatigue: number[];
  form: number;
  formLabel: string;
  weekLoad: number;
  ramp: "normal" | "fast" | "warning" | null;
};

const DAYS = 28;

/**
 * From getTrainingLoad, which already picks the source: the stored Garmin
 * series when Garmin is allowed for this account (garminAllowedFor) and has
 * days, else the user's own endurance sessions. Both filter by userId.
 * Null when the four weeks hold no load, for the empty state.
 */
export async function loadTrainingLoad(ctx: HomeContext): Promise<TrainingLoadData | null> {
  const t = await getTrainingLoad(ctx.userId, DAYS);
  const days = t.days.slice(-DAYS);
  const total = days.map((d) => d.tracks?.total);
  const loads = total.map((p) => Math.max(0, Math.round(p?.load ?? 0)));
  if (!loads.some((l) => l > 0)) return null;
  const last = total.at(-1);
  const form = Math.round(last?.tsb ?? 0);
  return {
    loads,
    fatigue: total.map((p) => Math.max(0, p?.atl ?? 0)),
    form,
    formLabel: formBandLabel(form),
    weekLoad: loads.slice(-7).reduce((a, b) => a + b, 0),
    ramp: t.rampBand,
  };
}
