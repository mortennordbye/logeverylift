/**
 * HRV-guided training (2.4) and resting and sleeping heart rate (2.5).
 */

export type HrvNight = { date: string; ms: number | null; garminLow?: number | null; garminHigh?: number | null };

export type HrvState = "balanced" | "high" | "strained" | "fatigued" | "unsettled" | "calibrating";

export type HrvDay = {
  date: string;
  ms: number | null;
  /** 7-day mean of ln(ms), shown as ms (exp). Needs 4 of 7 nights. */
  mean7: number | null;
  /** Baseline band in ms. Ours after 30 nights (60-day mean ± 0.75 SD on ln), Garmin's before. */
  bandLow: number | null;
  bandHigh: number | null;
  bandSource: "ours" | "garmin" | null;
  /** SD / mean of the last 7 nights' raw ms, in percent. */
  cv7: number | null;
  state: HrvState;
};

function mean(xs: number[]) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function sd(xs: number[]) {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}

/** Nights must be consecutive dates, oldest first (missing nights as ms null). */
export function hrvSeries(nights: HrvNight[]): HrvDay[] {
  const out: HrvDay[] = [];
  nights.forEach((night, i) => {
    const last7 = nights.slice(Math.max(0, i - 6), i + 1).map((n) => n.ms).filter((v): v is number => v !== null && v > 0);
    const last60 = nights.slice(Math.max(0, i - 59), i + 1).map((n) => n.ms).filter((v): v is number => v !== null && v > 0);
    const mean7 = last7.length >= 4 ? Math.exp(mean(last7.map(Math.log))) : null;
    const cv7 = last7.length >= 4 ? (sd(last7) / mean(last7)) * 100 : null;

    let bandLow: number | null = null;
    let bandHigh: number | null = null;
    let bandSource: HrvDay["bandSource"] = null;
    if (last60.length >= 30) {
      const logs = last60.map(Math.log);
      bandLow = Math.exp(mean(logs) - 0.75 * sd(logs));
      bandHigh = Math.exp(mean(logs) + 0.75 * sd(logs));
      bandSource = "ours";
    } else if (night.garminLow && night.garminHigh) {
      bandLow = night.garminLow;
      bandHigh = night.garminHigh;
      bandSource = "garmin";
    }

    // CV rising: higher than three days ago, for three days in a row.
    const cvHistory = [out[i - 1]?.cv7, out[i - 2]?.cv7, out[i - 3]?.cv7];
    const cvRising = cv7 !== null && cvHistory.every((c) => c !== null && c !== undefined) && cv7 > cvHistory[0]! && cvHistory[0]! > cvHistory[1]! && cvHistory[1]! > cvHistory[2]!;

    let state: HrvState = "calibrating";
    if (mean7 !== null && bandLow !== null && bandHigh !== null) {
      if (mean7 > bandHigh) state = "high";
      else if (mean7 < bandLow) state = cvRising ? "strained" : "fatigued";
      else state = cvRising ? "unsettled" : "balanced";
    }
    out.push({ date: night.date, ms: night.ms, mean7, bandLow, bandHigh, bandSource, cv7, state });
  });
  return out;
}

export type RestingHrDay = { date: string; bpm: number | null; mean7: number | null; baseline: number | null; flag: boolean };

/**
 * 7-day mean against a 60-day baseline; +5 bpm or +2 SD above it is a flag.
 * The SD rule needs a rise of at least 2 bpm, so a flat baseline (SD near 0)
 * doesn't flag a week that hasn't changed.
 */
export function restingHrSeries(days: { date: string; bpm: number | null }[]): RestingHrDay[] {
  return days.map((day, i) => {
    const last7 = days.slice(Math.max(0, i - 6), i + 1).map((d) => d.bpm).filter((v): v is number => v !== null && v > 0);
    const last60 = days.slice(Math.max(0, i - 59), i + 1).map((d) => d.bpm).filter((v): v is number => v !== null && v > 0);
    const mean7 = last7.length >= 4 ? mean(last7) : null;
    const baseline = last60.length >= 14 ? mean(last60) : null;
    const limit = baseline !== null ? Math.min(baseline + 5, baseline + Math.max(2 * sd(last60), 2)) : null;
    return { date: day.date, bpm: day.bpm, mean7, baseline, flag: mean7 !== null && limit !== null && mean7 >= limit };
  });
}

export type SleepingLow = { bpm: number; at: number; fractionOfNight: number };

/**
 * Lowest 30-minute rolling mean HR inside the sleep window (timestamps in ms),
 * and when in the night it fell. Null with under 3 hours of samples.
 */
export function sleepingLow(values: [number, number | null][], start: number, end: number): SleepingLow | null {
  const inWindow = values.filter(([ts, bpm]) => ts >= start && ts <= end && bpm !== null && bpm > 0) as [number, number][];
  if (inWindow.length < 2 || inWindow.at(-1)![0] - inWindow[0][0] < 3 * 3600_000) return null;
  let best: SleepingLow | null = null;
  let lo = 0;
  let sum = 0;
  for (let hi = 0; hi < inWindow.length; hi++) {
    sum += inWindow[hi][1];
    while (inWindow[hi][0] - inWindow[lo][0] > 30 * 60_000) {
      sum -= inWindow[lo][1];
      lo++;
    }
    if (inWindow[hi][0] - inWindow[lo][0] >= 25 * 60_000) {
      const m = sum / (hi - lo + 1);
      if (!best || m < best.bpm) {
        const at = (inWindow[lo][0] + inWindow[hi][0]) / 2;
        best = { bpm: m, at, fractionOfNight: (at - start) / (end - start) };
      }
    }
  }
  return best;
}
