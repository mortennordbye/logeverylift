/**
 * Where a body signal sits on a published scale, the way Garmin rates VO2 max:
 * a row of bands from poor to great, the user's band, and the next one up.
 * Each scale names its source; nothing here is the app's own guess.
 *
 * - VO2 max: The Cooper Institute table Garmin prints in its manuals, by sex
 *   and age decade (Superior 95th percentile, Excellent 80th, Good 60th, Fair 40th).
 * - Sleep score and body battery: Garmin's own bands.
 * - HRV: Garmin's own baseline bands for this user (hrv daily summary), as no
 *   population norm is fair for HRV.
 * - Sleep hours: National Sleep Foundation (Hirshkowitz et al. 2015).
 * - Resting HR: 60 to 100 normal for adults, near 40 for very fit athletes (Mayo Clinic, AHA).
 * - Breathing: 12 to 20 breaths a minute at rest for adults.
 * - Body fat: the American Council on Exercise categories; BMI: WHO.
 * - Fitness age: against the user's own age.
 * - Deep and REM sleep share, wake-ups: Garmin's optimal range for that night
 *   (sleep score parts); sleep and day stress: Garmin's 0 to 100 stress bands.
 * - Blood oxygen asleep: 95 % or more is normal, below 90 % is low.
 * - Steps: Tudor-Locke step-defined activity categories (7-day average).
 * - Sleeping HR, sitting time, muscle mass, floors, distance, active time,
 *   calories, altitude, bone mass and body water have no fair population
 *   scale; they are judged only against the user's own normal.
 */

import type { BodyKey } from "../queries";

export type Tone = "poor" | "fair" | "ok" | "good" | "excellent" | "superior";

/**
 * A band covers from (inclusive) to `to` (exclusive); null is open-ended.
 * `edge` is the limit as the source prints it, where `from` had to move past
 * it to keep that limit inside the band below (resting HR 100 is normal).
 */
export type Band = { label: string; from: number | null; to: number | null; tone: Tone; edge?: number };

export type Rating = {
  bands: Band[];
  /** Index of the user's band in `bands`. */
  index: number;
  /** Where the value sits inside its band, 0 to 1, for the marker. */
  within: number;
  /** One sentence on how the value compares. */
  compare: string;
  /** The nearest better band, how far away it is, and whether it lies above or below the value. */
  next: { label: string; gap: number; dir: "up" | "down" } | null;
  source: string;
};

/** What a rating needs and the user has not given. */
export type RatingGap = { needs: "sex" | "age" };

export type RatingContext = {
  sex: "male" | "female" | null;
  age: number | null;
  /**
   * Garmin's HRV baseline for the day (below lowUpper is low, balancedLow to
   * balancedUpper is balanced) and the 7-day average Garmin rates against it.
   */
  hrvBaseline: { lowUpper: number; balancedLow: number; balancedUpper: number; weeklyAvg: number } | null;
  bodyFat: number | null;
  bmi: number | null;
  chronologicalAge: number | null;
  /** Garmin's optimal deep and REM share (%) and most wake-ups for the newest night. */
  sleepRanges: { deep: [number, number] | null; rem: [number, number] | null; awakeMax: number | null } | null;
};

const TONE_RANK: Record<Tone, number> = { poor: 0, fair: 1, ok: 2, good: 3, excellent: 4, superior: 5 };

/** Bands from ascending cut points: n cuts make n + 1 bands. `edges` gives the printed limit for a cut that is not it. */
function bands(cuts: number[], labels: string[], tones: Tone[], edges: Record<number, number> = {}): Band[] {
  return labels.map((label, i) => ({
    label,
    from: i === 0 ? null : cuts[i - 1],
    to: i === cuts.length ? null : cuts[i],
    tone: tones[i],
    ...(i > 0 && edges[i - 1] !== undefined ? { edge: edges[i - 1] } : {}),
  }));
}

/** Width used for the marker inside an open-ended band. */
function within(b: Band, v: number, span: number): number {
  const from = b.from ?? (b.to !== null ? b.to - span : v);
  const to = b.to ?? (b.from !== null ? b.from + span : v);
  return to > from ? Math.min(1, Math.max(0, (v - from) / (to - from))) : 0.5;
}

function place(bs: Band[], v: number, compare: (b: Band) => string, source: string, span: number): Rating {
  const index = Math.max(0, bs.findIndex((b) => (b.from === null || v >= b.from) && (b.to === null || v < b.to)));
  const b = bs[index];
  // The nearest band with a better tone, on either side (resting HR and sleep improve in both directions).
  let next: Rating["next"] = null;
  for (const [i, dir] of [
    [index + 1, 1],
    [index - 1, -1],
  ] as const) {
    const n = bs[i];
    if (!n || TONE_RANK[n.tone] <= TONE_RANK[b.tone]) continue;
    const gap = Math.round((dir === 1 ? n.from! - v : v - n.to!) * 10) / 10;
    if (!next || gap < next.gap) next = { label: n.label, gap, dir: dir === 1 ? "up" : "down" };
  }
  return { bands: bs, index, within: within(b, v, span), compare: compare(b), next, source };
}

// ── VO2 max: The Cooper Institute, as printed in Garmin's manuals ───────────

const VO2_DECADES = [20, 30, 40, 50, 60, 70] as const;
/** Fair, Good, Excellent, Superior cut points per decade 20-29 .. 70-79. */
const VO2_CUTS: Record<"male" | "female", number[][]> = {
  male: [
    [41.7, 45.4, 51.1, 55.4],
    [40.5, 44, 48.3, 54],
    [38.5, 42.4, 46.4, 52.5],
    [35.6, 39.2, 43.4, 48.9],
    [32.3, 35.5, 39.5, 45.7],
    [29.4, 32.3, 36.7, 42.1],
  ],
  female: [
    [36.1, 39.5, 43.9, 49.6],
    [34.4, 37.8, 42.4, 47.4],
    [33, 36.3, 39.7, 45.3],
    [30.1, 33, 36.7, 41.1],
    [27.5, 30, 33, 37.8],
    [25.9, 28.1, 30.9, 36.7],
  ],
};
const VO2_SHARE = ["the bottom 40 %", "better than 40 to 60 %", "better than 60 to 80 %", "better than 80 to 95 %", "the top 5 %"];

function decadeIndex(age: number) {
  return Math.min(VO2_DECADES.length - 1, Math.max(0, Math.floor((age - 20) / 10)));
}

export function vo2Rating(v: number, sex: "male" | "female", age: number): Rating {
  const d = decadeIndex(age);
  const bs = bands(VO2_CUTS[sex][d], ["Poor", "Fair", "Good", "Excellent", "Superior"], ["poor", "fair", "good", "excellent", "superior"]);
  const group = `${sex === "male" ? "men" : "women"} aged ${VO2_DECADES[d]}–${VO2_DECADES[d] + 9}`;
  return place(bs, v, (b) => `${b.label} for ${group}: ${VO2_SHARE[bs.indexOf(b)]} of them.`, "The Cooper Institute norms, as Garmin uses them", 5);
}

// ── The other scales ────────────────────────────────────────────────────────

const SLEEP_SCORE = bands([60, 80, 90], ["Poor", "Fair", "Good", "Excellent"], ["poor", "fair", "good", "excellent"]);
const BODY_BATTERY = bands([26, 51, 76], ["Very low", "Low", "Medium", "High"], ["poor", "fair", "good", "excellent"]);
const RESTING_HR = bands([40, 60, 101], ["Very low", "Athletic", "Normal", "High"], ["fair", "excellent", "good", "poor"], { 2: 100 });
const BREATHING = bands([12, 20.5], ["Low", "Normal", "High"], ["fair", "good", "poor"], { 1: 20 });
const BMI = bands([18.5, 25, 30], ["Underweight", "Normal", "Overweight", "Obese"], ["fair", "good", "ok", "poor"]);
const BODY_FAT: Record<"male" | "female", Band[]> = {
  male: bands([6, 14, 18, 25], ["Essential", "Athletes", "Fitness", "Average", "Obese"], ["fair", "excellent", "good", "ok", "poor"]),
  female: bands([14, 21, 25, 32], ["Essential", "Athletes", "Fitness", "Average", "Obese"], ["fair", "excellent", "good", "ok", "poor"]),
};

const STRESS = bands([26, 51, 76], ["Rest", "Low", "Medium", "High"], ["excellent", "good", "fair", "poor"]);
const SPO2 = bands([90, 95], ["Very low", "Low", "Normal"], ["poor", "fair", "good"]);
const STEPS = bands([5000, 7500, 10000, 12500], ["Sedentary", "Low active", "Somewhat active", "Active", "Highly active"], ["poor", "fair", "ok", "good", "excellent"]);

/** Garmin's optimal share of a sleep stage: under it, inside it, over it. */
function stageBands([lo, hi]: [number, number]): Band[] {
  return bands([lo, hi + 1], ["Below optimal", "Optimal", "Above optimal"], ["fair", "good", "ok"], { 1: hi });
}

/** One minute, so a band's upper hour is still inside it (9 h is recommended). */
const MIN_H = 1 / 60;

/** NSF: 7 to 9 h recommended for adults 18 to 64 (7 to 8 h at 65+); 6 h and up to 11 h (18 to 25) or 10 h (26 to 64) may suit some. */
function sleepBands(age: number | null): { bands: Band[]; low: number; high: number } {
  const labels = ["Too short", "Short", "Recommended", "Long", "Too long"];
  const tones: Tone[] = ["poor", "ok", "good", "ok", "poor"];
  if (age !== null && age >= 65) return { bands: bands([5, 7, 8 + MIN_H, 9 + MIN_H], labels, tones, { 2: 8, 3: 9 }), low: 7, high: 8 };
  const max = age !== null && age <= 25 ? 11 : 10;
  return { bands: bands([6, 7, 9 + MIN_H, max + MIN_H], labels, tones, { 2: 9, 3: max }), low: 7, high: 9 };
}

/**
 * The rating for one tile, a gap when it needs the user's sex or age, or null
 * for a signal with no scale.
 */
export function rateSignal(key: BodyKey, v: number, ctx: RatingContext): Rating | RatingGap | null {
  switch (key) {
    case "vo2max":
      if (!ctx.sex) return { needs: "sex" };
      if (ctx.age === null) return { needs: "age" };
      return vo2Rating(v, ctx.sex, ctx.age);
    case "sleepScore":
      return place(SLEEP_SCORE, v, (b) => `${b.label} on Garmin's scale.`, "Garmin's sleep score bands", 10);
    case "bodyBattery":
      return place(BODY_BATTERY, v, (b) => `${b.label} reserve energy on Garmin's scale.`, "Garmin's body battery levels", 25);
    case "restingHr":
      return place(
        RESTING_HR,
        v,
        (b) =>
          b.label === "Athletic"
            ? "Below the 60 to 100 adults usually have, as is common with endurance training."
            : b.label === "Normal"
              ? "In the 60 to 100 most adults have."
              : b.label === "Very low"
                ? "Lower than most athletes. Fine for a very fit athlete; otherwise ask a doctor."
                : "Above 100 at rest. Ask a doctor if it stays there.",
        "Mayo Clinic and the American Heart Association",
        20,
      );
    case "respiration":
      return place(BREATHING, v, (b) => (b.label === "Normal" ? "In the 12 to 20 breaths a minute adults have at rest." : `${b.label} for an adult at rest (12 to 20 is normal).`), "Common clinical range for adults at rest", 4);
    case "sleep": {
      const s = sleepBands(ctx.age);
      const rec = `${s.low} to ${s.high} hours recommended for your age`;
      return place(s.bands, v, (b) => (b.label === "Recommended" ? `In the ${rec}.` : `${b.label} against the ${rec}.`), "National Sleep Foundation", 1);
    }
    case "hrv": {
      // Garmin rates the 7-day average, not one night; so does this, to agree with Garmin's status.
      const h = ctx.hrvBaseline;
      if (!h) return null;
      const bs = bands([h.lowUpper, h.balancedLow, h.balancedUpper + 1], ["Low", "Unbalanced", "Balanced", "Unbalanced"], ["poor", "fair", "good", "fair"], { 2: h.balancedUpper });
      return place(bs, h.weeklyAvg, (b) => `Your 7-day average, ${h.weeklyAvg} ms, is ${b.label.toLowerCase()} against your baseline of ${h.balancedLow} to ${h.balancedUpper} ms.`, "Garmin's HRV baseline for you", 10);
    }
    case "fitnessAge": {
      const own = ctx.chronologicalAge ?? ctx.age;
      if (own === null) return { needs: "age" };
      // Lower is better: 5 or more years under your age is "much younger".
      const bs = bands([own - 4.5, own - 1.5, own + 1.5, own + 4.5], ["Much younger", "Younger", "Your age", "Older", "Much older"], ["excellent", "good", "ok", "fair", "poor"]);
      const diff = Math.round(own - v);
      return place(bs, v, () => (diff === 0 ? `The same as your age, ${own}.` : `${Math.abs(diff)} years ${diff > 0 ? "younger" : "older"} than your age, ${own}.`), "Garmin's fitness age against your age", 3);
    }
    case "deepSleep":
    case "remSleep": {
      const range = key === "deepSleep" ? ctx.sleepRanges?.deep : ctx.sleepRanges?.rem;
      if (!range) return null;
      const stage = key === "deepSleep" ? "deep" : "REM";
      return place(stageBands(range), v, (b) => `${b.label} for ${stage} sleep: Garmin's range for your night is ${range[0]} to ${range[1]} %.`, "Garmin's sleep score optimal range", 5);
    }
    case "awakeCount": {
      const max = ctx.sleepRanges?.awakeMax;
      if (max === null || max === undefined) return null;
      const bs = bands([max + 1], ["Optimal", "More than optimal"], ["good", "fair"], { 0: max });
      return place(bs, v, (b) => `${b.label}: Garmin counts ${max} or fewer awake periods in a night as optimal.`, "Garmin's sleep score optimal range", 3);
    }
    case "sleepStress":
    case "stress":
      return place(STRESS, v, (b) => `${b.label} stress on Garmin's 0 to 100 scale${key === "sleepStress" ? ", averaged while asleep" : ", averaged over the day"}.`, "Garmin's stress levels", 25);
    case "spo2":
      return place(SPO2, v, (b) => (b.label === "Normal" ? "In the 95 to 100 % normal while asleep." : `${b.label}: 95 to 100 % is normal while asleep. A wrist reading is not a medical test; ask a doctor if it stays low.`), "Common clinical range", 5);
    case "steps":
      return place(STEPS, v, (b) => `${b.label}: a 7-day average of ${Math.round(v).toLocaleString("en-GB")} steps a day.`, "Tudor-Locke step-defined activity categories", 2500);
    case "sleepHr":
    case "sedentary":
    case "muscleMass":
    case "floors":
    case "distance":
    case "activeTime":
    case "calories":
    case "altitude":
    case "boneMass":
    case "bodyWater":
      return null;
    case "weight": {
      if (ctx.bodyFat !== null && ctx.sex) {
        return place(BODY_FAT[ctx.sex], ctx.bodyFat, (b) => `Body fat ${ctx.bodyFat} %: ${b.label.toLowerCase()} for ${ctx.sex === "male" ? "men" : "women"}.`, "American Council on Exercise body fat categories", 4);
      }
      if (ctx.bmi !== null) {
        return place(BMI, ctx.bmi, (b) => `BMI ${ctx.bmi}: ${b.label.toLowerCase()}. BMI reads muscle as fat, so body fat says more for an athlete.`, "WHO BMI categories", 5);
      }
      return ctx.bodyFat !== null ? { needs: "sex" } : null;
    }
  }
}

export const isGap = (r: Rating | RatingGap | null): r is RatingGap => r !== null && "needs" in r;
