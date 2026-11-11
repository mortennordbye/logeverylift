/**
 * Morning readiness, 0 to 100 (docs/plans/garmin-insights-design.md, 2.6).
 * Each contributor is scored 0 to 100 against the athlete's own baseline and
 * shown on its own, so a low score names its cause. A missing contributor is
 * left out and the others are scaled up; under 3 signals there is no score.
 */

import type { HrvState } from "./recovery";

export type ContributorKey = "hrv" | "restingHr" | "sleep" | "sleepDebt" | "form" | "feel";

export const CONTRIBUTOR_WEIGHT: Record<ContributorKey, number> = { hrv: 30, restingHr: 15, sleep: 15, sleepDebt: 10, form: 20, feel: 10 };
export const CONTRIBUTOR_LABEL: Record<ContributorKey, string> = {
  hrv: "HRV",
  restingHr: "Resting HR",
  sleep: "Sleep last night",
  sleepDebt: "Sleep debt",
  form: "Form",
  feel: "How you feel",
};

export type Contributor = { key: ContributorKey; score: number; detail: string };
export type ReadinessBand = "go_hard" | "as_planned" | "easy" | "rest";
export type Readiness = { score: number; band: ReadinessBand; contributors: Contributor[]; signals: number; capped: boolean };

export const READINESS_BAND_LABEL: Record<ReadinessBand, string> = { go_hard: "Go hard", as_planned: "Train as planned", easy: "Keep it easy", rest: "Rest" };

const clamp = (v: number) => Math.max(0, Math.min(100, v));

/** 0 at x0, 100 at x1, straight line between, clamped. */
function scale(x: number, x0: number, x1: number) {
  return clamp(((x - x0) / (x1 - x0)) * 100);
}

/** Form: 100 at TSB +10 or more, 50 at -10, 0 at -35. */
export function formScore(tsb: number): number {
  if (tsb >= 10) return 100;
  if (tsb >= -10) return 50 + ((tsb + 10) / 20) * 50;
  return clamp(((tsb + 35) / 25) * 50);
}

export type ReadinessInput = {
  hrv: { lastNight: number | null; mean7: number | null; bandLow: number | null; bandHigh: number | null; state: HrvState };
  restingHr: { today: number | null; baseline: number | null; sd: number | null; flag: boolean };
  sleep: { seconds: number | null; needSeconds: number | null };
  sleepDebtS: number | null;
  tsb: number | null;
  /** LogEveryLift readiness (1 to 5) logged on the last 2 days. */
  feel: number[];
};

export function readiness(input: ReadinessInput): Readiness | null {
  const out: Contributor[] = [];
  const { hrv, restingHr, sleep } = input;

  if (hrv.mean7 && hrv.bandLow && hrv.bandHigh && hrv.bandHigh > hrv.bandLow) {
    // The band is the baseline mean ± 0.75 SD on ln, so one SD is its ln width / 1.5.
    const sd = (Math.log(hrv.bandHigh) - Math.log(hrv.bandLow)) / 1.5;
    const centre = (Math.log(hrv.bandHigh) + Math.log(hrv.bandLow)) / 2;
    const zWeek = (Math.log(hrv.mean7) - centre) / sd;
    const zNight = hrv.lastNight ? (Math.log(hrv.lastNight) - Math.log(hrv.mean7)) / sd : 0;
    const z = 0.7 * zWeek + 0.3 * zNight;
    out.push({ key: "hrv", score: clamp(50 + (z / 1.5) * 50), detail: `7-day ${Math.round(hrv.mean7)} ms, band ${Math.round(hrv.bandLow)}–${Math.round(hrv.bandHigh)}` });
  }
  if (restingHr.today && restingHr.baseline) {
    const sd = Math.max(restingHr.sd ?? 0, 1.5);
    const z = (restingHr.today - restingHr.baseline) / sd;
    out.push({ key: "restingHr", score: clamp(50 - (z / 1.5) * 50), detail: `${Math.round(restingHr.today)} bpm, normal ${Math.round(restingHr.baseline)}` });
  }
  if (sleep.seconds) {
    const need = sleep.needSeconds ?? 8 * 3600;
    const ratio = sleep.seconds / need;
    out.push({ key: "sleep", score: scale(ratio, 0.5, 1), detail: `${Math.round(ratio * 100)} % of need` });
  }
  if (input.sleepDebtS !== null) {
    out.push({ key: "sleepDebt", score: clamp(100 - (input.sleepDebtS / (8 * 3600)) * 100), detail: `${(input.sleepDebtS / 3600).toFixed(1)} h over 14 nights` });
  }
  if (input.tsb !== null) {
    out.push({ key: "form", score: formScore(input.tsb), detail: `TSB ${input.tsb >= 0 ? "+" : ""}${Math.round(input.tsb)}` });
  }
  const feel = input.feel.filter((f) => f >= 1 && f <= 5);
  if (feel.length) {
    const mean = feel.reduce((a, b) => a + b, 0) / feel.length;
    out.push({ key: "feel", score: scale(mean, 1, 5), detail: `${mean.toFixed(1)} of 5 logged` });
  }

  if (out.length < 3) return null;
  const weight = out.reduce((s, c) => s + CONTRIBUTOR_WEIGHT[c.key], 0);
  let score = out.reduce((s, c) => s + c.score * CONTRIBUTOR_WEIGHT[c.key], 0) / weight;
  const capped = (hrv.state === "fatigued" || hrv.state === "strained") && restingHr.flag && score > 45;
  if (capped) score = 45;
  score = Math.round(score);
  const band: ReadinessBand = score >= 75 ? "go_hard" : score >= 50 ? "as_planned" : score >= 30 ? "easy" : "rest";
  return { score, band, contributors: out.map((c) => ({ ...c, score: Math.round(c.score) })), signals: out.length, capped };
}
