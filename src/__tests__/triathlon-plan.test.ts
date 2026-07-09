import { describe, expect, it } from "vitest";
import {
  buildTriathlonPlan,
  planExerciseNames,
  snapWeeks,
} from "@/lib/utils/triathlon-plan";

describe("snapWeeks", () => {
  it("snaps to the nearest cycle-supported value", () => {
    expect(snapWeeks(12)).toBe(12);
    expect(snapWeeks(13)).toBe(12);
    expect(snapWeeks(11)).toBe(10); // exact tie (10 vs 12) resolves to the lower
    expect(snapWeeks(5)).toBe(4);
    expect(snapWeeks(1)).toBe(4);
  });

  it("supports long Ironman builds up to 12 months", () => {
    expect(snapWeeks(52)).toBe(52); // 12 months
    expect(snapWeeks(36)).toBe(36); // 9 months
    expect(snapWeeks(24)).toBe(24); // 6 months
    expect(snapWeeks(50)).toBe(52);
    expect(snapWeeks(100)).toBe(52); // clamps to the longest supported block
  });
});

describe("buildTriathlonPlan", () => {
  it("produces 7 day-of-week slots", () => {
    const plan = buildTriathlonPlan({ weeks: 12 });
    expect(plan.days.map((d) => d.dayOfWeek)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(plan.durationWeeks).toBe(12);
  });

  it("snaps weeks into the cycle name", () => {
    const plan = buildTriathlonPlan({ weeks: 9 });
    expect(plan.durationWeeks).toBe(8);
    expect(plan.cycleName).toContain("8 wk");
  });

  it("peak-anchors endurance sets and scales week 1 below peak for a build", () => {
    const plan = buildTriathlonPlan({ weeks: 12, goal: "build" });
    const enduranceSets = plan.days
      .flatMap((d) => d.exercises)
      .filter((e) => e.sets.some((s) => s.peakDistanceMeters))
      .flatMap((e) => e.sets);
    expect(enduranceSets.length).toBeGreaterThan(0);
    for (const s of enduranceSets) {
      expect(s.peakDistanceMeters!).toBeGreaterThan(0);
      expect(s.distanceMeters!).toBeGreaterThan(0);
      // Week 1 of a build starts below peak.
      expect(s.distanceMeters!).toBeLessThan(s.peakDistanceMeters!);
    }
  });

  it("maintain anchors week 1 at the peak (flat)", () => {
    const plan = buildTriathlonPlan({ weeks: 12, goal: "maintain" });
    expect(plan.goal).toBe("maintain");
    const swim = plan.days
      .flatMap((d) => d.exercises)
      .find((e) => e.name === "Swim")!;
    expect(swim.sets[0].distanceMeters).toBe(swim.sets[0].peakDistanceMeters);
  });

  it("includes two flat strength days (Workout A & B)", () => {
    const plan = buildTriathlonPlan({ weeks: 12 });
    const strengthDays = plan.days.filter((d) =>
      d.exercises.some((e) => e.exerciseType != null),
    );
    expect(strengthDays.map((d) => d.label)).toEqual([
      "Workout A — Squat & Horizontal",
      "Workout B — Hinge & Vertical",
    ]);
  });

  it("makes Sunday the long bike + brick (bike then run in one session)", () => {
    const plan = buildTriathlonPlan({ weeks: 12 });
    const sun = plan.days.find((d) => d.dayOfWeek === 7)!;
    expect(sun.label).toBe("Long Bike + Brick Run");
    expect(sun.exercises.map((e) => e.name)).toEqual(["Bike", "Run"]);
    // Saturday holds the standalone long run.
    const sat = plan.days.find((d) => d.dayOfWeek === 6)!;
    expect(sat.label).toBe("Long Run");
  });

  it("turns a chosen rest day into an empty rest slot", () => {
    // Resting Friday (recovery swim) is the lightest session — it just drops.
    const plan = buildTriathlonPlan({ weeks: 12, restDays: [5] });
    const rest = plan.days.find((d) => d.dayOfWeek === 5)!;
    expect(rest.exercises).toEqual([]);
    expect(rest.label).toBe("Rest");
  });

  it("relocates a key session off a rest day instead of deleting it", () => {
    // Fri + Sat rest: the two lightest sessions (recovery swim, run intervals)
    // drop, the long run slides off Saturday onto a freed training day, and the
    // long bike+brick keeps Sunday.
    const plan = buildTriathlonPlan({ weeks: 12, restDays: [5, 6] });
    const byDay = (n: number) => plan.days.find((d) => d.dayOfWeek === n)!;

    expect(byDay(5).label).toBe("Rest");
    expect(byDay(6).label).toBe("Rest");
    expect(byDay(5).exercises).toEqual([]);
    expect(byDay(6).exercises).toEqual([]);

    // Sunday keeps the long bike+brick; strength days untouched.
    expect(byDay(7).label).toBe("Long Bike + Brick Run");
    expect(byDay(7).exercises.map((e) => e.name)).toEqual(["Bike", "Run"]);
    expect(byDay(1).label).toBe("Workout A — Squat & Horizontal");
    expect(byDay(4).label).toBe("Workout B — Hinge & Vertical");

    // The long run survives — relocated onto Tuesday (the freed interval slot).
    const longRun = plan.days.find((d) => d.label === "Long Run")!;
    expect(longRun).toBeTruthy();
    expect(longRun.dayOfWeek).toBe(2);

    // Exactly two empty (rest) slots; everything else keeps real sessions.
    const restSlots = plan.days.filter((d) => d.exercises.length === 0);
    expect(restSlots.map((d) => d.dayOfWeek)).toEqual([5, 6]);
  });

  it("references swim, bike, and run exercises", () => {
    const names = planExerciseNames(buildTriathlonPlan({ weeks: 12 }));
    expect(names).toContain("Swim");
    expect(names).toContain("Bike");
    expect(names).toContain("Run");
  });

  // peakDistanceMeters is the authored race-prep peak (the curve scales
  // distanceMeters below it); it reflects the level table directly.
  const longRunPeak = (level: "novice" | "intermediate" | "advanced") => {
    const plan = buildTriathlonPlan({ weeks: 24, level });
    const sat = plan.days.find((d) => d.dayOfWeek === 6)!; // Long Run
    return sat.exercises[0].sets[0].peakDistanceMeters!;
  };
  const longBikePeak = (level: "novice" | "intermediate" | "advanced") => {
    const plan = buildTriathlonPlan({ weeks: 24, level });
    const sun = plan.days.find((d) => d.dayOfWeek === 7)!; // Long Bike + Brick
    return sun.exercises.find((e) => e.name === "Bike")!.sets[0].peakDistanceMeters!;
  };

  it("scales peak volumes up with athlete level", () => {
    expect(longRunPeak("novice")).toBeLessThan(longRunPeak("intermediate"));
    expect(longRunPeak("intermediate")).toBeLessThan(longRunPeak("advanced"));
    expect(longBikePeak("novice")).toBeLessThan(longBikePeak("intermediate"));
    expect(longBikePeak("intermediate")).toBeLessThan(longBikePeak("advanced"));
  });

  it("respects the long-session biological ceilings even at advanced", () => {
    // Run ≤ ~30 km, bike ≤ ~180 km — the durability ceilings from the brief.
    expect(longRunPeak("advanced")).toBeLessThanOrEqual(30000);
    expect(longBikePeak("advanced")).toBeLessThanOrEqual(180000);
  });

  it("prescribes a polarized 80/20 split — one structured Z4 interval session, the rest easy Z2", () => {
    const plan = buildTriathlonPlan({ weeks: 24 });
    const enduranceExercises = plan.days
      .flatMap((d) => d.exercises)
      .filter((e) => e.sets.some((s) => s.peakDistanceMeters != null));

    // Every endurance set carries a Z2/Z4 target zone.
    const allZones = enduranceExercises.flatMap((e) => e.sets.map((s) => s.targetHeartRateZone));
    expect(allZones.every((z) => z === 2 || z === 4)).toBe(true);

    // Exactly one session contains the hard Z4 work (the threshold-interval run).
    const hardSessions = enduranceExercises.filter((e) => e.sets.some((s) => s.targetHeartRateZone === 4));
    expect(hardSessions).toHaveLength(1);

    // That session is a real interval workout: a Z2 warmup, ≥2 Z4 reps with rest, a Z2 cooldown.
    const intervals = hardSessions[0].sets;
    expect(intervals[0].targetHeartRateZone).toBe(2); // warmup
    expect(intervals[intervals.length - 1].targetHeartRateZone).toBe(2); // cooldown
    const z4 = intervals.filter((s) => s.targetHeartRateZone === 4);
    expect(z4.length).toBeGreaterThanOrEqual(2);
    expect(z4.every((s) => s.restTimeSeconds > 0)).toBe(true); // recovery between reps

    // Every other endurance session is entirely easy Z2.
    for (const e of enduranceExercises.filter((e) => e !== hardSessions[0])) {
      expect(e.sets.every((s) => s.targetHeartRateZone === 2)).toBe(true);
    }

    // Strength sets stay unzoned.
    const strengthSets = plan.days
      .flatMap((d) => d.exercises)
      .filter((e) => e.sets.some((s) => s.targetReps != null))
      .flatMap((e) => e.sets);
    expect(strengthSets.every((s) => s.targetHeartRateZone == null)).toBe(true);
  });

  it("tags only the interval run's hard reps as phase-varying 'work' sets", () => {
    const plan = buildTriathlonPlan({ weeks: 24 });
    const quality = plan.days.find((d) => d.label === "Run — Threshold Intervals")!;
    const sets = quality.exercises[0].sets;
    // Warmup (first) and cooldown (last) are not work; the middle reps are.
    expect(sets[0].sessionRole).toBeUndefined();
    expect(sets[sets.length - 1].sessionRole).toBeUndefined();
    const work = sets.filter((s) => s.sessionRole === "work");
    expect(work.length).toBeGreaterThanOrEqual(2);
    expect(work.every((s) => s.targetHeartRateZone === 4)).toBe(true);
    // No other session carries "work" reps (strength sets are unzoned and roleless).
    const others = plan.days
      .flatMap((d) => d.exercises)
      .filter((e) => e !== quality.exercises[0])
      .flatMap((e) => e.sets);
    expect(others.every((s) => s.sessionRole !== "work")).toBe(true);
  });

  it("prescribes the Workout A and Workout B exercises", () => {
    const names = planExerciseNames(buildTriathlonPlan({ weeks: 24, goal: "build" }));
    for (const n of [
      // Workout A — Squat & Horizontal
      "Front Squat", "Dumbbell Bench Press", "Pendlay Row", "Bulgarian Split Squat",
      "Seated Calf Raise", "Pallof Press",
      // Workout B — Hinge & Vertical
      "Romanian Deadlift", "Weighted Pull-up", "Dumbbell Shoulder Press",
      "Seated Leg Curl", "Face Pull", "Ab Wheel Rollout",
    ]) {
      expect(names).toContain(n);
    }
  });

  it("classifies each strength lift (compound / isolation / isometric)", () => {
    const plan = buildTriathlonPlan({ weeks: 24 });
    const byName = new Map(
      plan.days.flatMap((d) => d.exercises).map((e) => [e.name, e.exerciseType]),
    );
    expect(byName.get("Front Squat")).toBe("compound");
    expect(byName.get("Seated Calf Raise")).toBe("isolation");
    expect(byName.get("Pallof Press")).toBe("isometric");
    expect(byName.get("Ab Wheel Rollout")).toBe("isometric");
    // Endurance exercises carry no strength type.
    expect(byName.get("Swim")).toBeUndefined();
  });

  it("runs flat straight sets capped at the prescribed RIR", () => {
    const plan = buildTriathlonPlan({ weeks: 12 });
    const strength = plan.days
      .flatMap((d) => d.exercises)
      .filter((e) => e.exerciseType != null);
    expect(strength.length).toBeGreaterThan(0);
    for (const e of strength) {
      const working = e.sets.filter((s) => s.setType !== "warmup");
      // Flat: every working set shares one target reps value (or all are timed holds).
      const reps = working.map((s) => s.targetReps);
      expect(new Set(reps).size).toBe(1);
      // Rep-based working sets carry an RIR cap; isometric holds don't.
      for (const s of working) {
        if (s.durationSeconds == null) {
          expect(s.targetRir).toBeGreaterThanOrEqual(1);
          expect(s.targetRir).toBeLessThanOrEqual(5);
        }
      }
    }
  });

  it("maps the spec's smart mode to weight so flat reps stay static", () => {
    const plan = buildTriathlonPlan({ weeks: 24, goal: "build" });
    const ex = plan.days.flatMap((d) => d.exercises);
    // Compound strength lifts progress on weight (never smart) with a positive increment.
    const compounds = ex.filter((e) => e.exerciseType === "compound");
    expect(compounds.length).toBeGreaterThan(0);
    for (const e of compounds) {
      expect(e.progressionMode).toBe("weight");
      expect(e.overloadIncrementKg).toBeGreaterThan(0);
    }
  });

  it("starts each compound with a warmup set, then flat working sets", () => {
    const plan = buildTriathlonPlan({ weeks: 12 });
    const frontSquat = plan.days.flatMap((d) => d.exercises).find((e) => e.name === "Front Squat")!;
    expect(frontSquat.sets[0].setType).toBe("warmup");
    const working = frontSquat.sets.filter((s) => s.setType !== "warmup");
    expect(working).toHaveLength(3);
    expect(working.every((s) => s.targetReps === 8 && s.targetRir === 2)).toBe(true);
  });

  it("models Pallof Press as timed isometric holds (no reps)", () => {
    const plan = buildTriathlonPlan({ weeks: 12 });
    const pallof = plan.days.flatMap((d) => d.exercises).find((e) => e.name === "Pallof Press")!;
    expect(pallof.sets.every((s) => s.durationSeconds === 15 && s.targetReps == null)).toBe(true);
  });

  it("keeps both swims after dropping to two strength days", () => {
    const plan = buildTriathlonPlan({ weeks: 24, goal: "build" });
    const swims = plan.days
      .flatMap((d) => d.exercises)
      .filter((e) => e.name === "Swim");
    // Endurance swim (multi-segment, peak-anchored) + recovery swim — both survive.
    expect(swims.length).toBe(2);
    expect(swims.some((e) => e.sets.length > 1)).toBe(true); // multi-segment endurance swim
  });

  it("runs strength flat — no phase-periodization sessionRole on strength sets", () => {
    const plan = buildTriathlonPlan({ weeks: 24, goal: "build" });
    const strengthSets = plan.days
      .flatMap((d) => d.exercises)
      .filter((e) => e.exerciseType != null)
      .flatMap((e) => e.sets);
    expect(strengthSets.length).toBeGreaterThan(0);
    expect(strengthSets.every((s) => s.sessionRole == null)).toBe(true);
  });

  it("keeps strength reps static regardless of goal (flat maintenance block)", () => {
    for (const goal of ["build", "maintain"] as const) {
      const plan = buildTriathlonPlan({ weeks: 24, goal });
      const rdl = plan.days.flatMap((d) => d.exercises).find((e) => e.name === "Romanian Deadlift")!;
      const working = rdl.sets.filter((s) => s.setType !== "warmup");
      expect(working).toHaveLength(3);
      expect(working.every((s) => s.targetReps === 8)).toBe(true);
    }
  });

  it("defaults to the intermediate level and records it on the blueprint", () => {
    expect(buildTriathlonPlan({ weeks: 24 }).level).toBe("intermediate");
    expect(buildTriathlonPlan({ weeks: 24, level: "advanced" }).level).toBe("advanced");
  });
});
