/**
 * Rule-based insights (docs/plans/garmin-insights-design.md, 4.1): explainable
 * findings from the daily series. Each rule has fixed thresholds, a minimum
 * amount of data, and a sentence with one fact and one action. Second person,
 * present tense, numbers with units, training framing only, never medical.
 */

import type { DailyMetrics } from "./daily";
import { SPORTS } from "./sport";

// Thresholds, with their source.
/** Ramp rate above this (CTL points per week) raises injury risk (Coggan/Allen; 2.3). */
const RAMP_WARNING = 8;
/** Uncoupled ACWR ceiling, the same one periodization.ts tests against. */
const ACWR_CEILING = 1.3;
/** Foster's monotony: above 2.0 with a high week is a strain risk. */
const MONOTONY_LIMIT = 2;
/** Mid ("grey zone") share above this, two weeks running, crowds out easy and hard work (Seiler). */
const MID_SHARE_LIMIT = 0.3;
/** Weeks of training with no time above LTHR before we point it out. */
const NO_HIGH_WEEKS = 4;
/** Sleep debt over 14 nights, in hours. */
const SLEEP_DEBT_H = 5;
/** Sleep regularity index under this, or onset spread above SPREAD_MIN minutes. */
const REGULARITY_LIMIT = 70;
const SPREAD_MIN = 60;
/** Readiness and form for "good day for the hard session". */
const FRESH_READINESS = 75;
const FRESH_TSB = 5;

export type Severity = "warning" | "caution" | "good" | "info";
export type InsightTarget = "today" | "load" | "sleep";

export type Insight = {
  id: string;
  severity: Severity;
  text: string;
  /** The numbers the sentence uses, for the info sheet. */
  numbers: Record<string, number>;
  target: InsightTarget;
};

const SEVERITY_RANK: Record<Severity, number> = { warning: 0, caution: 1, good: 2, info: 3 };

function weekSums(days: DailyMetrics[]) {
  const total = (d: DailyMetrics) => SPORTS.reduce((s, sp) => s + (d.pmc[sp]?.load ?? 0), 0);
  const weeks: { load: number; low: number; mid: number; high: number }[] = [];
  // Rolling 7-day blocks back from the newest day, newest last.
  for (let end = days.length; end - 7 >= 0; end -= 7) {
    const block = days.slice(end - 7, end);
    weeks.unshift({
      load: block.reduce((s, d) => s + total(d), 0),
      low: block.reduce((s, d) => s + d.bands.low, 0),
      mid: block.reduce((s, d) => s + d.bands.mid, 0),
      high: block.reduce((s, d) => s + d.bands.high, 0),
    });
  }
  return weeks;
}

const round = (n: number, d = 0) => Math.round(n * 10 ** d) / 10 ** d;

/** Insights for the newest day in `days` (oldest first, up to 90 days), ranked by severity. */
export function insightsFor(days: DailyMetrics[]): Insight[] {
  const today = days.at(-1);
  if (!today) return [];
  const out: Insight[] = [];

  // HRV under its band.
  if (today.hrv.state === "fatigued" || today.hrv.state === "strained") {
    let n = 0;
    for (let i = days.length - 1; i >= 0 && (days[i].hrv.state === "fatigued" || days[i].hrv.state === "strained"); i--) n++;
    out.push({
      id: "hrv_low_week",
      severity: "warning",
      text: `HRV has been under your normal range for ${n} day${n === 1 ? "" : "s"}. Keep today easy.`,
      numbers: { days: n, mean7: round(today.hrv.mean7 ?? 0), bandLow: round(today.hrv.bandLow ?? 0) },
      target: "sleep",
    });
  }

  // Resting HR raised two days running.
  const yesterday = days.at(-2);
  if (today.restingHr.flag && yesterday?.restingHr.flag && today.restingHr.mean7 && today.restingHr.baseline) {
    const over = today.restingHr.mean7 - today.restingHr.baseline;
    out.push({
      id: "rhr_up",
      severity: "caution",
      text: `Resting HR is ${round(over)} bpm over your 60-day normal for the second day. Hold back on intensity.`,
      numbers: { over: round(over, 1), baseline: round(today.restingHr.baseline) },
      target: "sleep",
    });
  }

  // Fitness rising too fast.
  if (!today.calibrating && today.ramp !== null && today.ramp > RAMP_WARNING) {
    out.push({
      id: "ramp_fast",
      severity: "warning",
      text: `Fitness rose ${round(today.ramp, 1)} points this week. Over ${RAMP_WARNING} raises injury risk. Hold volume next week.`,
      numbers: { ramp: round(today.ramp, 1) },
      target: "load",
    });
  }

  const weeks = weekSums(days);
  // This week against the three before (uncoupled ACWR).
  if (weeks.length >= 4) {
    const prior = weeks.slice(-4, -1);
    const chronic = prior.reduce((s, w) => s + w.load, 0) / 3;
    const acwr = chronic > 0 ? weeks.at(-1)!.load / chronic : 0;
    if (acwr > ACWR_CEILING) {
      out.push({
        id: "acwr_high",
        severity: "warning",
        text: `This week's load is ${round(acwr, 1)} x your last three weeks. Keep the next days easy.`,
        numbers: { acwr: round(acwr, 2) },
        target: "load",
      });
    }
    // Same medium day, every day.
    const mean4 = weeks.slice(-4).reduce((s, w) => s + w.load, 0) / 4;
    if (today.monotony !== null && today.monotony > MONOTONY_LIMIT && weeks.at(-1)!.load > mean4) {
      out.push({
        id: "monotony",
        severity: "caution",
        text: "Every day this week was a similar medium day. Make easy days easier and hard days harder.",
        numbers: { monotony: round(today.monotony, 1) },
        target: "load",
      });
    }
  }

  // Too much grey zone, two weeks running.
  const share = (w: { low: number; mid: number; high: number }) => {
    const t = w.low + w.mid + w.high;
    return t > 0 ? w.mid / t : null;
  };
  const last2 = weeks.slice(-2).map(share);
  if (last2.length === 2 && last2.every((s) => s !== null && s > MID_SHARE_LIMIT)) {
    out.push({
      id: "too_much_mid",
      severity: "caution",
      text: `${round(last2[1]! * 100)} % of your time was between easy and threshold. Aim for under 20 %.`,
      numbers: { midShare: round(last2[1]! * 100) },
      target: "load",
    });
  }

  // Weeks of training without any high-intensity time.
  const recent = weeks.slice(-NO_HIGH_WEEKS);
  if (recent.length === NO_HIGH_WEEKS && recent.every((w) => w.low + w.mid > 3600 && w.high < 300)) {
    out.push({
      id: "no_high",
      severity: "info",
      text: `No time above threshold in ${NO_HIGH_WEEKS} weeks. Add one short interval session a week if your plan is in build.`,
      numbers: { weeks: NO_HIGH_WEEKS },
      target: "load",
    });
  }

  // Sleep debt.
  if (today.sleepDebtS !== null && today.sleepDebtS / 3600 > SLEEP_DEBT_H) {
    out.push({
      id: "sleep_debt",
      severity: "caution",
      text: `You are ${round(today.sleepDebtS / 3600, 1)} h short on sleep over two weeks. Go to bed earlier for a few nights.`,
      numbers: { debtH: round(today.sleepDebtS / 3600, 1) },
      target: "sleep",
    });
  }

  // Irregular sleep.
  const spread = today.timing.onsetSpread;
  if ((today.regularity !== null && today.regularity < REGULARITY_LIMIT) || (spread !== null && spread > SPREAD_MIN)) {
    out.push({
      id: "sleep_irregular",
      severity: "info",
      text: spread !== null ? `Your bedtime moves by ${round(spread)} min night to night. A steady bedtime helps recovery.` : `Your sleep regularity is ${round(today.regularity ?? 0)} of 100. A steady bedtime helps recovery.`,
      numbers: { regularity: round(today.regularity ?? 0), onsetSpread: round(spread ?? 0) },
      target: "sleep",
    });
  }

  // A good day for the hard session.
  const tsb = today.pmc.total.tsb;
  if (today.readiness && today.readiness.score >= FRESH_READINESS && tsb > FRESH_TSB) {
    out.push({
      id: "fresh",
      severity: "good",
      text: `Readiness ${today.readiness.score} and form +${round(tsb)}. Good day for the hard session.`,
      numbers: { readiness: today.readiness.score, tsb: round(tsb) },
      target: "today",
    });
  }

  return out.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}
