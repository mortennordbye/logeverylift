/**
 * Triathlon plan generator — pure blueprint builder (no DB access, fully testable).
 *
 * Produces one weekly template (7 day-of-week slots) mixing swim / bike / run
 * with two maintenance strength days. The distances picked are the *peak*
 * (race-prep) week; each endurance set stores that peak so the active cycle's
 * periodization (see periodization.ts) can scale the week-to-week volume —
 * Base → Build → Peak → Taper for "build", flat for "maintain". Endurance uses
 * `manual` progression because the periodization curve, not reactive
 * +increment suggestions, drives the load.
 *
 * Strength is three sessions a week (Lower / Upper-Push / Upper-Pull) built to
 * maintain and build muscle alongside the endurance load, not just support economy.
 * The four lower-body / posterior-chain compound mains (Squat, RDL, Hip Thrust,
 * Bulgarian Split Squat) stay tagged sessionRole = "strength" so the active cycle
 * periodizes their reps/rest by phase (see strengthPhaseRecipe) — they carry the
 * economy stimulus and still maintain muscle. The full-body hypertrophy work added
 * around them (chest/shoulders/back/arms/calves) runs in fixed 8–12 rep ranges with
 * "weight"/"reps" progressive overload, so the history-based suggestion engine
 * auto-adds load week to week; these accessories carry no sessionRole, so the weekly
 * sync leaves their rep targets stable. Plyometric and core work is held constant.
 * The standalone endurance swim is folded onto the Upper-Push day so no swim/bike/run
 * volume is lost when the third strength day is added.
 */

import type { ExerciseType } from "@/lib/utils/exercise-type";
import {
  deloadCadenceForLevel,
  periodizedLoad,
  scaledDistance,
  type AthleteLevel,
  type TrainingGoal,
} from "@/lib/utils/periodization";

export type PlanProgressionMode = "manual" | "distance" | "weight" | "reps";

export type PlanSet = {
  targetReps?: number;
  weightKg?: number;
  distanceMeters?: number;
  /** Peak (race-prep) distance this endurance set ramps toward. */
  peakDistanceMeters?: number;
  durationSeconds?: number;
  /** Target HR zone (1–5) — drives the polarized 80/20 intensity prescription. */
  targetHeartRateZone?: number;
  /** "work" = a hard interval rep the active cycle phase-swaps (zone/rest) by block phase. */
  sessionRole?: string;
  /** "warmup" excludes the set from progression; defaults to "working". */
  setType?: "working" | "warmup";
  /** Prescribed reps-in-reserve cap (the stricter floor of a range). */
  targetRir?: number;
  restTimeSeconds: number;
};

export type PlanExercise = {
  /** Exercise name — resolved to an exercises row at persist time. */
  name: string;
  progressionMode: PlanProgressionMode;
  /** Doubles as the meters increment for distance mode (see programExercises). */
  overloadIncrementReps: number;
  /** Per-session weight increment (kg) for "weight" mode progressive overload. */
  overloadIncrementKg?: number;
  /** The exercise's role in this program — persisted as the program_exercise type override. */
  exerciseType?: ExerciseType;
  sets: PlanSet[];
};

export type PlanDay = {
  /** 1 = Monday … 7 = Sunday. */
  dayOfWeek: number;
  /** Program name for this day. */
  label: string;
  /** Empty = rest day (no program created for this slot). */
  exercises: PlanExercise[];
};

export type PlanBlueprint = {
  cycleName: string;
  durationWeeks: number;
  goal: TrainingGoal;
  level: AthleteLevel;
  days: PlanDay[];
};

export type BuildTriathlonPlanParams = {
  /** Desired length; snapped to the nearest cycle-supported value. */
  weeks: number;
  /**
   * Rest days, 1 = Monday … 7 = Sunday (max 2). Rest days don't simply blank
   * whatever session sits there — the lightest sessions drop and the key long
   * sessions slide onto the remaining training days. See the rest logic below.
   */
  restDays?: number[];
  /** "build" ramps to a race peak then tapers; "maintain" holds flat. Default "build". */
  goal?: TrainingGoal;
  /** Experience tier — scales peak volumes and deload cadence. Default "intermediate". */
  level?: AthleteLevel;
};

const ALLOWED_WEEKS = [4, 6, 8, 10, 12, 16, 24, 36, 52];

/** Peak (race-prep) per-session distances in meters for each endurance slot. */
type PeakVolumes = {
  swimLong: number;
  swimShort: number;
  bikeMid: number;
  bikeLong: number;
  runTempo: number;
  runBrick: number;
  runLong: number;
};

/**
 * Ironman-distance peak volumes per athlete tier. Anchored to the longest-session
 * biological ceilings from the research brief — run ≤ ~30 km, bike ≤ ~180 km,
 * swim ≤ ~4.2 km — since long-session durability, not single-week mileage, is
 * what carries an age-grouper through 140.6. Weekly totals land a touch under the
 * high end of published ranges because this is a fixed two-swim / two-ride /
 * three-run week with no double days; the periodization curve scales every figure
 * below these toward race week. The brick run is held short (15–30 min) by design.
 */
const PEAK_VOLUMES: Record<AthleteLevel, PeakVolumes> = {
  novice:       { swimLong: 3000, swimShort: 1500, bikeMid: 40000, bikeLong: 90000,  runTempo: 6000,  runBrick: 3000, runLong: 18000 },
  intermediate: { swimLong: 3800, swimShort: 2000, bikeMid: 50000, bikeLong: 130000, runTempo: 8000,  runBrick: 4000, runLong: 26000 },
  advanced:     { swimLong: 4200, swimShort: 2500, bikeMid: 60000, bikeLong: 160000, runTempo: 10000, runBrick: 5000, runLong: 30000 },
};

const LEVEL_LABELS: Record<AthleteLevel, string> = {
  novice: "Novice",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

/** Snap an arbitrary week count to the nearest cycle-supported value. */
export function snapWeeks(weeks: number): number {
  return ALLOWED_WEEKS.reduce((best, v) =>
    Math.abs(v - weeks) < Math.abs(best - weeks) ? v : best,
  );
}

/**
 * Build a balanced Triathlon week. The `peakMeters` is the race-prep volume; the
 * stored `distanceMeters` is the week-1 prescription (scaled by the periodization
 * curve) and `peakDistanceMeters` is the anchor the active cycle ramps toward.
 * Two strength days (Mon/Thu) run a flat, RIR-capped hypertrophy/maintenance block
 * (Workout A / Workout B); the rest of the week is the polarized endurance schedule.
 */
export function buildTriathlonPlan({ weeks, restDays, goal = "build", level = "intermediate" }: BuildTriathlonPlanParams): PlanBlueprint {
  const durationWeeks = snapWeeks(weeks);
  const week1Load = periodizedLoad(1, durationWeeks, goal, deloadCadenceForLevel(level));
  const week1Multiplier = week1Load.multiplier;
  const v = PEAK_VOLUMES[level];

  // Compound-press/row increment vs isolation increment for progressive overload.
  const INC_COMPOUND = 2.5;
  const INC_ISOLATION = 1.25;

  // ── Strength block (flat straight sets, RIR-capped) ─────────────────────────
  // A maintenance/hypertrophy block run alongside the endurance load. Sets are
  // FLAT — the same target reps across every working set, no phase re-prescription
  // (no sessionRole "strength") and no top-set pyramiding — to spare the CNS so the
  // endurance quality sessions aren't compromised. Weight is left at 0 for the
  // athlete to load to the target reps at the prescribed RIR cap. The spec's `smart`
  // mode is mapped to `weight`: smart nudges reps via a 1RM estimate, which would
  // break the strictly-static rep scheme.
  type StrengthSetSpec = {
    reps?: number;
    durationSeconds?: number;
    rest: number;
    warmup?: boolean;
    targetRir?: number;
  };
  const lift = (
    name: string,
    mode: PlanProgressionMode,
    type: ExerciseType,
    sets: StrengthSetSpec[],
    incrementKg?: number,
  ): PlanExercise => ({
    name,
    progressionMode: mode,
    exerciseType: type,
    overloadIncrementReps: 0,
    overloadIncrementKg: incrementKg,
    sets: sets.map((s) => ({
      targetReps: s.durationSeconds != null ? undefined : s.reps,
      durationSeconds: s.durationSeconds,
      weightKg: 0,
      restTimeSeconds: s.rest,
      setType: s.warmup ? "warmup" : "working",
      targetRir: s.targetRir,
    })),
  });

  const W = (reps: number, rest: number, targetRir?: number): StrengthSetSpec => ({ reps, rest, targetRir });
  const WU = (reps: number): StrengthSetSpec => ({ reps, rest: 90, warmup: true });
  const HOLD = (rest: number): StrengthSetSpec => ({ durationSeconds: 15, rest });

  // Workout A — Squat & Horizontal: quad drive for the bike, horizontal push/pull to
  // reverse aero hunch, anti-rotation trunk stability.
  const workoutA: PlanExercise[] = [
    lift("Front Squat", "weight", "compound", [WU(8), W(8, 150, 2), W(8, 150, 2), W(8, 150, 2)], INC_COMPOUND),
    lift("Dumbbell Bench Press", "weight", "compound", [WU(10), W(10, 150, 2), W(10, 150, 2), W(10, 150, 2)], INC_COMPOUND),
    lift("Pendlay Row", "weight", "compound", [W(10, 150, 2), W(10, 150, 2), W(10, 150, 2)], INC_COMPOUND),
    lift("Bulgarian Split Squat", "weight", "compound", [W(10, 90, 2), W(10, 90, 2)], INC_ISOLATION),
    lift("Seated Calf Raise", "manual", "isolation", [W(15, 90, 1), W(15, 90, 1)]),
    lift("Pallof Press", "manual", "isometric", [HOLD(60), HOLD(60), HOLD(60)]),
  ];

  // Workout B — Hinge & Vertical: posterior chain for run power, vertical pull for the
  // swim catch, structural shoulder/rotator-cuff longevity, anti-extension core.
  const workoutB: PlanExercise[] = [
    lift("Romanian Deadlift", "weight", "compound", [WU(8), W(8, 150, 2), W(8, 150, 2), W(8, 150, 2)], INC_COMPOUND),
    lift("Weighted Pull-up", "weight", "compound", [W(8, 150, 2), W(8, 150, 2), W(8, 150, 2)], INC_COMPOUND),
    lift("Dumbbell Shoulder Press", "weight", "compound", [W(10, 150, 2), W(10, 150, 2), W(10, 150, 2)], INC_COMPOUND),
    lift("Seated Leg Curl", "manual", "isolation", [W(12, 90, 1), W(12, 90, 1)]),
    lift("Face Pull", "manual", "isolation", [W(15, 90, 1), W(15, 90, 1)]),
    lift("Ab Wheel Rollout", "manual", "isometric", [W(10, 60, 1), W(10, 60, 1)]),
  ];

  // Each session is built from structured segments — not one distance blob — so it
  // reads like a real workout. Easy Z2 warmup/cooldown bracket the work; the single
  // weekly quality run is genuine Z4 threshold intervals (you don't run 8 km flat
  // out), and the endurance swim is broken into repeats to hold stroke mechanics.
  // Polarized 80/20: only the interval reps are Z4, everything else easy Z2 —
  // keeping the athlete out of the Z3 "grey zone" the research brief warns against.
  const Z2 = 2;
  const Z4 = 4;

  type Segment = { meters: number; zone: number; restSeconds: number; role?: string };
  const sessionFrom = (name: string, segments: Segment[]): PlanExercise => ({
    name,
    progressionMode: "manual",
    overloadIncrementReps: 0,
    sets: segments.map((s) => ({
      distanceMeters: scaledDistance(s.meters, week1Multiplier),
      peakDistanceMeters: s.meters,
      targetHeartRateZone: s.zone,
      sessionRole: s.role,
      restTimeSeconds: s.restSeconds,
    })),
  });

  // Steady continuous aerobic effort — one easy Z2 set (long ride/run, recovery swim).
  const steady = (name: string, peakMeters: number): PlanExercise =>
    sessionFrom(name, [{ meters: peakMeters, zone: Z2, restSeconds: 0 }]);

  // Round a segment to a clean 100 m step so prescriptions read nicely and a
  // maintain week (multiplier 1.0) lands exactly on the peak anchor.
  const r100 = (m: number) => Math.max(100, Math.round(m / 100) * 100);

  // Threshold-interval run: Z2 warmup, `reps` hard Z4 efforts with jog recovery,
  // Z2 cooldown. Distances ≈ the session's peak so periodization/level scaling
  // are unchanged; each segment carries its own peak anchor.
  const intervalRun = (name: string, peakMeters: number, reps: number): PlanExercise => {
    const warm = r100(peakMeters * 0.2);
    const cool = r100(peakMeters * 0.15);
    const per = r100((peakMeters - warm - cool) / reps);
    return sessionFrom(name, [
      { meters: warm, zone: Z2, restSeconds: 90 },
      ...Array.from({ length: reps }, () => ({ meters: per, zone: Z4, restSeconds: 120, role: "work" })),
      { meters: cool, zone: Z2, restSeconds: 0 },
    ]);
  };

  // Endurance swim broken into Z2 repeats (vs one continuous blob) with short rest.
  const swimEndurance = (name: string, peakMeters: number, reps: number): PlanExercise => {
    const warm = r100(peakMeters * 0.12);
    const cool = r100(peakMeters * 0.12);
    const per = r100((peakMeters - warm - cool) / reps);
    return sessionFrom(name, [
      { meters: warm, zone: Z2, restSeconds: 30 },
      ...Array.from({ length: reps }, () => ({ meters: per, zone: Z2, restSeconds: 20 })),
      { meters: cool, zone: Z2, restSeconds: 0 },
    ]);
  };

  const days: PlanDay[] = [
    {
      dayOfWeek: 1,
      label: "Workout A — Squat & Horizontal",
      exercises: workoutA,
    },
    {
      dayOfWeek: 2,
      label: "Run — Threshold Intervals",
      exercises: [intervalRun("Run", v.runTempo, 4)],
    },
    {
      dayOfWeek: 3,
      // The endurance swim freed from the old 3-strength-day week rides alongside
      // the mid bike here, keeping total swim volume unchanged.
      label: "Bike — Endurance + Swim",
      exercises: [steady("Bike", v.bikeMid), swimEndurance("Swim", v.swimLong, 5)],
    },
    {
      dayOfWeek: 4,
      label: "Workout B — Hinge & Vertical",
      exercises: workoutB,
    },
    {
      dayOfWeek: 5,
      label: "Recovery Swim",
      exercises: [steady("Swim", v.swimShort)],
    },
    {
      dayOfWeek: 6,
      label: "Long Run",
      exercises: [steady("Run", v.runLong)],
    },
    {
      dayOfWeek: 7,
      // The long bike + brick is the week's longest session, so it sits on Sunday
      // (the day with the most time). Resting Saturday relocates the long run.
      label: "Long Bike + Brick Run",
      exercises: [steady("Bike", v.bikeLong), steady("Run", v.runBrick)],
    },
  ];

  // Apply rest days. Rather than blanking whatever session happens to sit on a
  // rest day (which could delete a key long session), keep the most important
  // sessions and let the lightest ones fall away. Importance, most → least:
  // long bike + brick (Sun), long run (Sat), the two strength days, the bike+swim
  // endurance day, run intervals, recovery swim. With N rest days the N least-
  // important sessions drop; any surviving session whose natural weekday is now a
  // rest day slides onto a freed training day. The long bike + brick keeps Sunday.
  const restSet = new Set((restDays ?? []).filter((d) => d >= 1 && d <= 7));
  if (restSet.size > 0) {
    const importance: Record<number, number> = { 7: 6, 6: 5, 1: 4, 4: 3, 3: 2, 2: 1, 5: 0 };
    const keptDays = days.map((d) => d.dayOfWeek).filter((dow) => !restSet.has(dow));
    const keptSessions = [...days]
      .sort((a, b) => importance[b.dayOfWeek] - importance[a.dayOfWeek])
      .slice(0, keptDays.length);

    // Snapshot label+exercises up front so blanking a source day can't clobber a
    // session already relocated onto another day (they'd share the array ref).
    const assignment = new Map<number, { label: string; exercises: PlanExercise[] }>();
    for (const s of keptSessions) {
      if (keptDays.includes(s.dayOfWeek)) assignment.set(s.dayOfWeek, { label: s.label, exercises: s.exercises });
    }
    const freeDays = keptDays.filter((dow) => !assignment.has(dow)).sort((a, b) => a - b);
    keptSessions
      .filter((s) => !keptDays.includes(s.dayOfWeek))
      .forEach((s, i) => assignment.set(freeDays[i], { label: s.label, exercises: s.exercises }));

    for (const d of days) {
      const s = assignment.get(d.dayOfWeek);
      if (s) {
        d.label = s.label;
        d.exercises = s.exercises;
      } else {
        d.label = "Rest";
        d.exercises = [];
      }
    }
  }

  const goalLabel = goal === "maintain" ? "Maintain" : "Build";
  return {
    cycleName: `Triathlon ${goalLabel} · ${LEVEL_LABELS[level]} — ${durationWeeks} wk`,
    durationWeeks,
    goal,
    level,
    days,
  };
}

/** Distinct exercises referenced by a blueprint, in first-seen order. */
export function planExerciseNames(plan: PlanBlueprint): string[] {
  const seen = new Set<string>();
  for (const day of plan.days) {
    for (const ex of day.exercises) seen.add(ex.name);
  }
  return [...seen];
}
