import { describe, expect, it } from "vitest";
import {
  computeAdaptationFactor,
  deloadCadenceForLevel,
  formatPeriodizationSummary,
  intervalPhaseRecipe,
  periodizedLoad,
  phaseLayout,
  scaledDuration,
  strengthPhaseRecipe,
  uncoupledAcwr,
  type PeriodizationSummaryInput,
  type TrainingGoal,
} from "@/lib/utils/periodization";

describe("phaseLayout", () => {
  it("caps taper at 3 weeks and uses 2 peak weeks for long blocks", () => {
    expect(phaseLayout(52)).toEqual({ taperWeeks: 3, peakWeeks: 2, rampWeeks: 47 });
    expect(phaseLayout(24)).toEqual({ taperWeeks: 3, peakWeeks: 2, rampWeeks: 19 });
  });

  it("degrades gracefully for short blocks", () => {
    expect(phaseLayout(4)).toEqual({ taperWeeks: 1, peakWeeks: 1, rampWeeks: 2 });
  });
});

describe("periodizedLoad — maintain", () => {
  it("is flat 1.0 every week", () => {
    for (const w of [1, 5, 12, 24]) {
      const load = periodizedLoad(w, 24, "maintain");
      expect(load.multiplier).toBe(1);
      expect(load.phase).toBe("maintain");
      expect(load.isDeload).toBe(false);
    }
  });
});

describe("periodizedLoad — build (24-week block)", () => {
  const load = (w: number) => periodizedLoad(w, 24, "build");

  it("starts in base at the ramp-start fraction", () => {
    expect(load(1)).toMatchObject({ phase: "base", multiplier: 0.6, isDeload: false });
  });

  it("hits full volume at peak", () => {
    expect(load(20)).toMatchObject({ phase: "peak", multiplier: 1 });
    expect(load(21)).toMatchObject({ phase: "peak", multiplier: 1 });
  });

  it("tapers down into race week", () => {
    expect(load(22).phase).toBe("taper");
    expect(load(22).multiplier).toBe(0.6);
    expect(load(24)).toMatchObject({ phase: "taper", multiplier: 0.35 });
    // strictly decreasing across the taper
    expect(load(22).multiplier).toBeGreaterThan(load(23).multiplier);
    expect(load(23).multiplier).toBeGreaterThan(load(24).multiplier);
  });

  it("inserts recovery deload weeks that dip below their neighbours", () => {
    const wk4 = load(4);
    expect(wk4.isDeload).toBe(true);
    expect(wk4.multiplier).toBeLessThan(load(3).multiplier);
    expect(wk4.multiplier).toBeLessThan(load(5).multiplier);
  });

  it("never exceeds peak and never collapses to zero", () => {
    for (let w = 1; w <= 24; w++) {
      const m = load(w).multiplier;
      expect(m).toBeGreaterThanOrEqual(0.3);
      expect(m).toBeLessThanOrEqual(1);
    }
  });
});

describe("periodizedLoad — short block (4 weeks)", () => {
  it("still ramps and tapers", () => {
    const g: TrainingGoal = "build";
    expect(periodizedLoad(1, 4, g).multiplier).toBe(0.6);
    expect(periodizedLoad(3, 4, g).phase).toBe("peak");
    expect(periodizedLoad(4, 4, g)).toMatchObject({ phase: "taper", multiplier: 0.35 });
  });
});

describe("deloadCadenceForLevel", () => {
  it("recovers novices every 3rd week and others every 4th", () => {
    expect(deloadCadenceForLevel("novice")).toBe(3);
    expect(deloadCadenceForLevel("intermediate")).toBe(4);
    expect(deloadCadenceForLevel("advanced")).toBe(4);
    expect(deloadCadenceForLevel(null)).toBe(4);
    expect(deloadCadenceForLevel(undefined)).toBe(4);
  });

  it("shifts where deload weeks land in the ramp", () => {
    const novice = (w: number) => periodizedLoad(w, 24, "build", 3);
    const adv = (w: number) => periodizedLoad(w, 24, "build", 4);
    // Novice deloads at week 3 (not 4); advanced deloads at week 4 (not 3).
    expect(novice(3).isDeload).toBe(true);
    expect(novice(4).isDeload).toBe(false);
    expect(adv(3).isDeload).toBe(false);
    expect(adv(4).isDeload).toBe(true);
  });
});

describe("uncoupledAcwr — injury-risk guardrail", () => {
  it("returns 1 for the first week and excludes the current week from the denominator", () => {
    const acwr = uncoupledAcwr([0.5, 0.6, 0.7]);
    expect(acwr[0]).toBe(1);
    expect(acwr[1]).toBeCloseTo(0.6 / 0.5, 5); // chronic = mean of weeks before it
    expect(acwr[2]).toBeCloseTo(0.7 / ((0.5 + 0.6) / 2), 5);
  });

  it("keeps every generated build curve under the 1.30 ceiling, including out of deloads", () => {
    for (const weeks of [12, 16, 24, 36, 52]) {
      for (const cadence of [3, 4]) {
        const loads = Array.from({ length: weeks }, (_, i) =>
          periodizedLoad(i + 1, weeks, "build", cadence).multiplier,
        );
        const max = Math.max(...uncoupledAcwr(loads));
        expect(max, `weeks=${weeks} cadence=${cadence}`).toBeLessThanOrEqual(1.3);
      }
    }
  });
});

describe("intervalPhaseRecipe — quality session evolves by phase", () => {
  it("ramps the work-rep zone aerobic → threshold → VO₂ across the block", () => {
    expect(intervalPhaseRecipe("base").zone).toBe(3);
    expect(intervalPhaseRecipe("build").zone).toBe(4);
    expect(intervalPhaseRecipe("peak").zone).toBe(5);
    expect(intervalPhaseRecipe("taper").zone).toBe(4);
    expect(intervalPhaseRecipe("maintain").zone).toBe(4);
  });

  it("gives harder reps more recovery", () => {
    expect(intervalPhaseRecipe("peak").restSeconds).toBeGreaterThan(intervalPhaseRecipe("base").restSeconds);
    expect(intervalPhaseRecipe("build").restSeconds).toBeGreaterThanOrEqual(intervalPhaseRecipe("base").restSeconds);
  });
});

describe("strengthPhaseRecipe — strength periodizes alongside endurance", () => {
  it("drops reps as load rises base → build → peak → taper", () => {
    expect(strengthPhaseRecipe("base").reps).toBeGreaterThan(strengthPhaseRecipe("build").reps);
    expect(strengthPhaseRecipe("build").reps).toBeGreaterThanOrEqual(strengthPhaseRecipe("peak").reps);
    expect(strengthPhaseRecipe("peak").reps).toBeGreaterThanOrEqual(strengthPhaseRecipe("taper").reps);
  });

  it("cuts taper to low-rep work while holding heavy intensity (long rest)", () => {
    expect(strengthPhaseRecipe("taper").reps).toBeLessThanOrEqual(3);
    expect(strengthPhaseRecipe("taper").restSeconds).toBeGreaterThanOrEqual(150);
  });

  it("gives the heavy max-strength block longer rest than the adaptation base", () => {
    expect(strengthPhaseRecipe("build").restSeconds).toBeGreaterThan(strengthPhaseRecipe("base").restSeconds);
  });

  it("covers every phase with a positive rep and rest prescription", () => {
    for (const phase of ["base", "build", "peak", "taper", "maintain"] as const) {
      const r = strengthPhaseRecipe(phase);
      expect(r.reps).toBeGreaterThan(0);
      expect(r.restSeconds).toBeGreaterThan(0);
      expect(r.intent.length).toBeGreaterThan(0);
    }
  });
});

describe("computeAdaptationFactor — no-wearable nudge", () => {
  it("eases when behind on the plan", () => {
    expect(computeAdaptationFactor({ adherence: 0.4, avgReadiness: null, avgRpe: null }).pct).toBe(90);
  });

  it("eases when readiness is low", () => {
    expect(computeAdaptationFactor({ adherence: 1, avgReadiness: 2, avgRpe: 5 }).pct).toBe(92);
  });

  it("boosts on a strong, consistent, comfortable week", () => {
    expect(computeAdaptationFactor({ adherence: 1, avgReadiness: 4.5, avgRpe: 5 }).pct).toBe(105);
  });

  it("stays neutral when there's no clear signal", () => {
    expect(computeAdaptationFactor({ adherence: 0.75, avgReadiness: null, avgRpe: null }).pct).toBe(100);
    expect(computeAdaptationFactor({ adherence: 0.75, avgReadiness: 3, avgRpe: 7 }).pct).toBe(100);
  });

  it("never moves beyond a tight ±band", () => {
    for (const a of [0, 0.3, 0.6, 0.9, 1]) {
      for (const r of [null, 1, 3, 5]) {
        const { pct } = computeAdaptationFactor({ adherence: a, avgReadiness: r, avgRpe: null });
        expect(pct).toBeGreaterThanOrEqual(90);
        expect(pct).toBeLessThanOrEqual(105);
      }
    }
  });
});

describe("periodizedLoad — bounds", () => {
  it("clamps out-of-range weeks", () => {
    expect(periodizedLoad(0, 12, "build").week).toBe(1);
    expect(periodizedLoad(99, 12, "build").week).toBe(12);
  });
});

describe("formatPeriodizationSummary", () => {
  // Build a summary input from the canonical curve so the phrasing tests track
  // the real load function rather than hand-picked numbers.
  const summary = (week: number, totalWeeks: number, goal: TrainingGoal) => {
    const load = periodizedLoad(week, totalWeeks, goal);
    const { rampWeeks, peakWeeks } = phaseLayout(totalWeeks);
    const input: PeriodizationSummaryInput = {
      goal,
      phase: load.phase,
      phaseLabel: load.phase.charAt(0).toUpperCase() + load.phase.slice(1),
      currentWeek: load.week,
      totalWeeks,
      multiplier: load.multiplier,
      isDeload: load.isDeload,
      weeksUntilPeak: Math.max(0, rampWeeks + 1 - load.week),
      weeksUntilTaper: Math.max(0, rampWeeks + peakWeeks + 1 - load.week),
    };
    return formatPeriodizationSummary(input);
  };

  it("describes a ramping build week with weeks-until-peak and percent", () => {
    const { headline, note } = summary(1, 24, "build");
    expect(headline).toBe("Base · Week 1 of 24");
    expect(note).toBe("Peak in 19 wks · this week ~60% of peak volume.");
  });

  it("flags deload weeks in the headline", () => {
    const { headline } = summary(4, 24, "build");
    expect(headline).toContain("· deload");
  });

  it("singularizes the week unit when peak is one week away", () => {
    const { note } = summary(19, 24, "build"); // rampWeeks=19 → peak at 20
    expect(note).toBe("Peak in 1 wk · this week ~100% of peak volume.");
  });

  it("announces taper countdown once at peak", () => {
    const { note } = summary(20, 24, "build");
    expect(note).toBe("At peak · taper in 2 wks.");
  });

  it("describes the taper phase", () => {
    const { note } = summary(24, 24, "build");
    expect(note).toBe("Tapering into race week - easing volume to arrive fresh.");
  });

  it("holds steady for maintain goal", () => {
    const { headline, note } = summary(5, 24, "maintain");
    expect(headline).toBe("Maintain · Week 5 of 24");
    expect(note).toBe("Endurance held steady; strength at maintenance.");
  });

  it("appends the no-wearable adaptation note when present", () => {
    const base = periodizedLoad(5, 24, "build");
    const { rampWeeks, peakWeeks } = phaseLayout(24);
    const input: PeriodizationSummaryInput = {
      goal: "build",
      phase: base.phase,
      phaseLabel: "Base",
      currentWeek: 5,
      totalWeeks: 24,
      multiplier: base.multiplier,
      isDeload: base.isDeload,
      weeksUntilPeak: Math.max(0, rampWeeks + 1 - 5),
      weeksUntilTaper: Math.max(0, rampWeeks + peakWeeks + 1 - 5),
      adaptationNote: "Eased ~10% — under half of last week's sessions were completed.",
    };
    expect(formatPeriodizationSummary(input).note).toContain("Eased ~10%");
  });
});

describe("scaledDuration", () => {
  it("scales a peak duration by the multiplier, rounded to 30 s", () => {
    // 3600 s peak at 60% = 2160 → already a 30 s multiple
    expect(scaledDuration(3600, 0.6)).toBe(2160);
    // 3600 at 100% = peak
    expect(scaledDuration(3600, 1)).toBe(3600);
  });

  it("rounds to the nearest 30 s step", () => {
    // 3600 * 0.61 = 2196 → nearest 30 = 2190
    expect(scaledDuration(3600, 0.61)).toBe(2190);
  });

  it("never goes below 30 s", () => {
    expect(scaledDuration(60, 0.1)).toBe(30);
    expect(scaledDuration(3600, 0)).toBe(30);
  });
});
