/**
 * Fueling rules (docs/plans/nutrition-and-race-day.md, section 2; research:
 * docs/research/endurance-training-reference.md, "Fueling is trained like a
 * fourth discipline"). Pure. Every number the app shows from here carries its
 * evidence label and NUTRITION_DISCLAIMER, and no rule gives more than the
 * research allows: carbs above 90 g/h only after a proved tolerance above 90,
 * fluid never above the sweat rate, sodium at most 1,000 mg/h, caffeine at
 * most 6 mg/kg.
 */

export type Evidence = "Study" | "Consensus" | "Coach convention" | "Inference" | string;

export const NUTRITION_DISCLAIMER = "A guide from published research, not medical advice. Test it in training.";
export const FLUID_SAFETY =
  "Never drink more than you sweat. Too much fluid, not too little sodium, causes hyponatremia.";

/** A fuel log counts for gut training from this session length (2.2). */
export const GUT_MIN_SECONDS = 90 * 60;
/** GI score (0 = no symptoms, 10 = worst) from which a session shows symptoms (research: 4/10). */
export const GI_SYMPTOM_SCORE = 4;
export const GUT_START_G_H = 60;
export const GUT_STEP_G_H = 10;
/** The consensus ceiling without a proved higher tolerance. */
export const CARB_CEILING_G_H = 90;
/** The top studied intake (Podlogar 2022): nothing above it is ever proved or shown. */
export const CARB_MAX_G_H = 120;
/** A logged rate above this is refused as a likely typo. */
export const CARB_LOG_MAX_G_H = 150;
/** Tolerated logs above 90 g/h needed before the ceiling passes 90 (90-120 only after weeks without symptoms). */
export const ABOVE_CEILING_LOGS = 2;
/** Race at about 80 % of the highest tolerance proved in training (coach convention). */
export const RACE_SHARE_OF_TOLERANCE = 0.8;

export type CarbTarget = {
  /** none: water is fine; optional: practise if key; practise: race fueling with race products. */
  kind: "none" | "optional" | "practise";
  /** g/h band for a practise session, by sport. Null for none and optional. */
  bike: [number, number] | null;
  run: [number, number] | null;
  ceiling: number;
  text: string;
  evidence: Evidence;
};

/** Carbs per hour for a session of this length (2.1). `proved` is the gut tolerance in g/h, if any. */
export function carbTarget(durationSeconds: number, proved: number | null = null): CarbTarget {
  const min = durationSeconds / 60;
  const ceiling = carbCeiling(proved);
  if (min < 90) return { kind: "none", bike: null, run: null, ceiling, text: "Under 90 minutes: water only is fine.", evidence: "Coach convention" };
  if (min <= 120) {
    return { kind: "optional", bike: null, run: null, ceiling, text: "90 minutes to 2 hours: fuel if it is a key session, to practise.", evidence: "Coach convention" };
  }
  const trained = proved != null && proved >= CARB_CEILING_G_H;
  if (min > 150 && trained) {
    return {
      kind: "practise",
      bike: [60, ceiling],
      run: [50, Math.min(70, proved!)],
      ceiling,
      text:
        ceiling > CARB_CEILING_G_H
          ? `Gut trained to ${proved} g/h: up to ${ceiling} g/h on the bike with about 1:0.8 glucose:fructose. Above 90 g/h shows no clear performance gain.`
          : "Gut trained to 90 g/h: up to 90 g/h on the bike, 2:1 glucose:fructose.",
      evidence: ceiling > CARB_CEILING_G_H ? "Study plus inference" : "Consensus",
    };
  }
  return {
    kind: "practise",
    bike: [60, 80],
    run: [50, 70],
    ceiling,
    text: "Practise race fueling with race products: bike 60-80 g/h, run 50-70 g/h, 2:1 glucose:fructose.",
    evidence: "Consensus plus study; the bike and run split is inference",
  };
}

/** The highest rate a target may show: 90 g/h, or the proved tolerance above it, never above 120. */
export function carbCeiling(proved: number | null): number {
  return Math.min(CARB_MAX_G_H, proved != null && proved > CARB_CEILING_G_H ? proved : CARB_CEILING_G_H);
}

/** Why a fuel log is refused as a likely typo (over 150 g/h), or null. */
export function fuelLogError(log: Pick<GutLog, "durationS" | "carbsG">): string | null {
  const rate = carbsPerHour(log);
  return rate != null && rate > CARB_LOG_MAX_G_H ? `That is over ${CARB_LOG_MAX_G_H} g/h of carbohydrate. Check the numbers.` : null;
}

export type GutLog = { durationS: number | null; carbsG: number | null; giScore: number | null; day: string };

/** Carbohydrate per hour of one log, or null when it lacks the numbers. */
export function carbsPerHour(log: Pick<GutLog, "durationS" | "carbsG">): number | null {
  if (!log.durationS || log.durationS <= 0 || log.carbsG == null) return null;
  return Math.round(log.carbsG / (log.durationS / 3600));
}

export type GutTraining = {
  /** Highest g/h in a 90 min+ session with a GI score under 4. Null with none. */
  proved: number | null;
  /** The last fueled 90 min+ log with a GI score showed symptoms. */
  lastHadSymptoms: boolean;
  next: number;
  /** Race at 80 % of proved, rounded to 5 g, never above the ceiling. Null with nothing proved. */
  raceTarget: number | null;
  text: string;
  evidence: Evidence;
};

/** Gut-training progress from the user's fuel logs (2.2). */
export function gutTraining(logs: GutLog[]): GutTraining {
  const scored = logs
    .filter((l) => l.durationS != null && l.durationS >= GUT_MIN_SECONDS && l.giScore != null && carbsPerHour(l) != null)
    .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
  const clean = scored.filter((l) => l.giScore! < GI_SYMPTOM_SCORE).map((l) => carbsPerHour(l)!);
  // Above 90 g/h only after more than one tolerated session there, and never above 120.
  const above = clean.filter((r) => r > CARB_CEILING_G_H).length;
  const top = clean.length ? Math.max(...clean) : null;
  const proved = top == null ? null : Math.min(top, above >= ABOVE_CEILING_LOGS ? CARB_MAX_G_H : CARB_CEILING_G_H);
  const lastHadSymptoms = scored.length > 0 && scored[0].giScore! >= GI_SYMPTOM_SCORE;
  const ceiling = carbCeiling(proved);
  const raceTarget = proved != null ? Math.min(ceiling, Math.round((proved * RACE_SHARE_OF_TOLERANCE) / 5) * 5) : null;
  if (proved == null) {
    return {
      proved,
      lastHadSymptoms,
      next: GUT_START_G_H,
      raceTarget,
      text: `No fueled session of 90 minutes or more with a GI score yet. Start at ${GUT_START_G_H} g/h in 2-3 long sessions a week, with your race products.`,
      evidence: "Coach convention plus inference",
    };
  }
  if (lastHadSymptoms) {
    return {
      proved,
      lastHadSymptoms,
      next: proved,
      raceTarget,
      text: `Your last fueled session had a GI score of ${GI_SYMPTOM_SCORE} or more. Hold at ${proved} g/h, or step back ${GUT_STEP_G_H} g/h.`,
      evidence: "Inference",
    };
  }
  // Past 90 g/h only from a tolerance already proved past it.
  const next = proved >= CARB_CEILING_G_H ? Math.min(proved, CARB_MAX_G_H) : Math.min(CARB_CEILING_G_H, proved + GUT_STEP_G_H);
  return {
    proved,
    lastHadSymptoms,
    next,
    raceTarget,
    text:
      next > proved
        ? `Next step: ${next} g/h, for 1-2 weeks of 2-3 long sessions, before the next step.`
        : `You tolerate ${proved} g/h. Going past ${CARB_CEILING_G_H} g/h shows no clear performance gain.`,
    evidence: "Coach convention plus inference",
  };
}

// ── Sweat-rate test (2.3) ────────────────────────────────────────────────────

export type SweatTestInput = { durationS: number; preKg: number; postKg: number; fluidMl: number; urineMl?: number | null };

export type SweatResult = {
  mlPerHour: number;
  /** (post - pre) / pre x 100. Negative is a loss. */
  massChangePct: number;
  flags: string[];
};

/** Why a test entry is refused as a likely typo, or null when it is fine. */
export function sweatTestError(t: SweatTestInput): string | null {
  const min = t.durationS / 60;
  if (!(min >= 30 && min <= 240)) return "A sweat test lasts 30 to 240 minutes.";
  if (!(t.preKg >= 30 && t.preKg <= 250) || !(t.postKg >= 30 && t.postKg <= 250)) return "Weights are 30 to 250 kg.";
  if (Math.abs(t.postKg - t.preKg) / t.preKg > 0.05) return "The weight changed by more than 5 %. Check the numbers.";
  if (t.fluidMl < 0 || (t.urineMl ?? 0) < 0) return "Fluid and urine are 0 or more.";
  const rate = rawSweatRate(t);
  if (rate < 0 || rate > 4000) return "That gives a sweat rate outside 0 to 4,000 ml/h. Check the numbers.";
  return null;
}

function rawSweatRate(t: SweatTestInput): number {
  const lossMl = (t.preKg - t.postKg) * 1000 + t.fluidMl - (t.urineMl ?? 0);
  return lossMl / (t.durationS / 3600);
}

/** Sweat rate = (pre - post + fluid - urine) / hours, 1 kg = 1,000 ml (inference from the consensus method). */
export function sweatRate(t: SweatTestInput): SweatResult {
  const mlPerHour = Math.round(rawSweatRate(t));
  const massChangePct = Math.round(((t.postKg - t.preKg) / t.preKg) * 1000) / 10;
  const flags: string[] = [];
  if (t.postKg > t.preKg) flags.push("You gained weight: a red flag for drinking too much. Drink less next time.");
  else if (massChangePct < -3) flags.push("You lost more than 3 % of body mass. Drink a little more next time, never more than you sweat.");
  return { mlPerHour, massChangePct, flags };
}

// ── Fluid, sodium, caffeine (2.4) ────────────────────────────────────────────

export type Band = { low: number; high: number; text: string; evidence: Evidence };

export const DEFAULT_FLUID: [number, number] = [400, 900];
export const SODIUM_DEFAULT: [number, number] = [300, 600];
export const SODIUM_MAX_MG_H = 1000;

const round50 = (n: number) => Math.round(n / 50) * 50;

/** Fluid per hour: 50-80 % of the measured sweat rate, never above it; the default band without a test. */
export function fluidPlan(sweatMlPerHour: number | null): Band {
  if (sweatMlPerHour == null) {
    return {
      low: DEFAULT_FLUID[0],
      high: DEFAULT_FLUID[1],
      text: `Usually ${DEFAULT_FLUID[0]}-${DEFAULT_FLUID[1]} ml/h. Do a sweat test for your own number. ${FLUID_SAFETY}`,
      evidence: "Consensus plus inference",
    };
  }
  // A measured rate of 0, a gain, or one too small to split into a 50 ml band: no band above it.
  if (sweatMlPerHour < 100) {
    const high = Math.max(0, Math.floor(sweatMlPerHour / 10) * 10);
    return {
      low: 0,
      high,
      text: `Your test showed ${sweatMlPerHour <= 0 ? "no sweat loss" : `only ${sweatMlPerHour} ml/h of sweat loss`}. Drink to thirst, never more than you lose, and retest in race-like heat. ${FLUID_SAFETY}`,
      evidence: "Consensus plus inference",
    };
  }
  const low = Math.min(sweatMlPerHour, round50(sweatMlPerHour * 0.5));
  const high = Math.min(sweatMlPerHour, round50(sweatMlPerHour * 0.8));
  return {
    low,
    high,
    text: `${low}-${high} ml/h: 50-80 % of your sweat rate of ${sweatMlPerHour} ml/h. ${FLUID_SAFETY}`,
    evidence: "Consensus plus inference",
  };
}

/** Sodium per hour: the default band, or fluid x a lab sweat sodium value, clamped to 300-1,000 mg/h. */
export function sodiumPlan(fluid: Pick<Band, "low" | "high">, sweatSodiumMgL: number | null = null): Band {
  if (sweatSodiumMgL == null || sweatSodiumMgL <= 0) {
    return {
      low: SODIUM_DEFAULT[0],
      high: SODIUM_DEFAULT[1],
      text: `About ${SODIUM_DEFAULT[0]}-${SODIUM_DEFAULT[1]} mg/h (500-1,000 mg per litre you drink). More for salty sweaters in heat.`,
      evidence: "Consensus (variation) plus inference (doses)",
    };
  }
  const clamp = (n: number) => Math.min(SODIUM_MAX_MG_H, Math.max(SODIUM_DEFAULT[0], Math.round(n / 10) * 10));
  const rawHigh = (fluid.high / 1000) * sweatSodiumMgL;
  const low = clamp((fluid.low / 1000) * sweatSodiumMgL);
  const high = clamp(rawHigh);
  return {
    low,
    high,
    text: `${low}-${high} mg/h from your sweat sodium of ${sweatSodiumMgL} mg/L.${rawHigh > SODIUM_MAX_MG_H ? ` Capped at ${SODIUM_MAX_MG_H} mg/h: for more, ask a professional.` : ""}`,
    evidence: "Consensus (variation) plus inference (doses)",
  };
}

export type CaffeinePlan = { preMg: number; lateMg: [number, number]; totalMaxMg: number; text: string; evidence: Evidence };

/** Caffeine from body weight: 3 mg/kg early, 1-3 mg/kg late, at most 6 mg/kg in all. Null without a weight. */
export function caffeinePlan(weightKg: number | null): CaffeinePlan | null {
  if (!weightKg || weightKg <= 0) return null;
  const preMg = Math.round(weightKg * 3);
  const lateMg: [number, number] = [Math.round(weightKg), Math.round(weightKg * 3)];
  const totalMaxMg = Math.round(weightKg * 6);
  return {
    preMg,
    lateMg,
    totalMaxMg,
    text: `About ${preMg} mg before the start or early on the bike, then ${lateMg[0]}-${lateMg[1]} mg late in the bike or run; at most ${totalMaxMg} mg in all. Test it in training.`,
    evidence: "Consensus plus inference",
  };
}

/** Race morning and the two days before, from body weight (consensus). */
export function raceMorning(weightKg: number | null): { text: string; evidence: Evidence }[] {
  const g = (lo: number, hi: number) => (weightKg ? ` (${Math.round(weightKg * lo)}-${Math.round(weightKg * hi)} g)` : "");
  return [
    { text: `The two days before: 8-12 g carbohydrate per kg a day${g(8, 12)}, low fibre and low fat. A 1-2 kg weight gain is normal.`, evidence: "Consensus plus inference" },
    { text: `Race morning: 1-3 g carbohydrate per kg${g(1, 3)}, 2-3 hours before the start, familiar and low fibre.`, evidence: "Consensus" },
  ];
}

export type FuelItem = { productId: number; name: string; count: number; carbsG: number | null; sodiumMg: number | null; caffeineMg: number | null; fluidMl: number | null };
export type FuelTotals = { carbsG: number | null; fluidMl: number | null; sodiumMg: number | null; caffeineMg: number | null };

/** The totals of a log's products. A field no product has stays null. */
export function itemTotals(items: FuelItem[]): FuelTotals {
  const sum = (k: "carbsG" | "fluidMl" | "sodiumMg" | "caffeineMg") =>
    items.some((i) => i[k] != null) ? Math.round(items.reduce((s, i) => s + (i[k] ?? 0) * i.count, 0)) : null;
  return { carbsG: sum("carbsG"), fluidMl: sum("fluidMl"), sodiumMg: sum("sodiumMg"), caffeineMg: sum("caffeineMg") };
}
