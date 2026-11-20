/**
 * Structured endurance workouts (docs/plans/workouts-and-compliance.md,
 * section 3; decision D9). One Zod schema for the app, MCP and export: a
 * workout is an ordered list of steps and one level of repeat blocks. Each
 * step has an end (time, distance or the lap button) and an optional target
 * relative to a threshold anchor or as an absolute range.
 *
 * The shape follows the research model ("Every workout format reduces to the
 * same tree", docs/research/endurance-training-reference.md). Targets are
 * stored relative to an anchor and resolved to watts, bpm or pace only when
 * shown, so a new threshold updates every future workout. Pace is stored as
 * speed (m/s), and a percent pace target is a percent of threshold speed,
 * because pace ranges invert.
 *
 * The schema check is never overridable (decision D3).
 */

import type { ThresholdKind } from "@/db/schema/athlete-profile";
import { minSec, paceUnitLabel, paceUnitMeters } from "@/lib/utils/thresholds";
import { DEFAULT_UNITS, METERS_PER_MILE, METERS_PER_YARD, type Units } from "@/lib/utils/units";
import { z } from "zod";

export const WORKOUT_SPORTS = ["swim", "bike", "run"] as const;
export const STEP_TYPES = ["warmup", "work", "recovery", "cooldown", "rest"] as const;
export const TARGET_METRICS = ["power", "hr", "pace", "cadence", "rpe"] as const;
export const TARGET_ANCHORS = ["ftp", "lthr", "max_hr", "threshold_pace", "css", "absolute"] as const;
export const SWIM_STROKES = ["free", "back", "breast", "fly", "im", "choice", "kick", "pull", "drill"] as const;
export const SWIM_EQUIPMENT = ["pull_buoy", "paddles", "fins", "kickboard", "snorkel"] as const;
/** FTP test rides a bike workout can be (docs/plans/bike-ride-logger.md, 4.9). */
export const RIDE_TESTS = ["ramp", "20min"] as const;
export type RideTest = (typeof RIDE_TESTS)[number];
/** The run threshold test (docs/plans/run-logger.md, 4.10), stored as protocol run_30min. */
export const RUN_TESTS = ["30min"] as const;
export type RunTest = (typeof RUN_TESTS)[number];
/** Every test a workout can be: bike tests on a bike, the run test on a run. */
export const WORKOUT_TESTS = [...RIDE_TESTS, ...RUN_TESTS] as const;
export type WorkoutTest = (typeof WORKOUT_TESTS)[number];
/** A workout's test when it is a bike test, for the readers of FTP tests. */
export const rideTestOf = (test: WorkoutTest | null | undefined): RideTest | undefined =>
  test === "ramp" || test === "20min" ? test : undefined;

export type WorkoutSport = (typeof WORKOUT_SPORTS)[number];

/** Limits of the schema check (section 3.2). */
export const WORKOUT_LIMITS = {
  nodes: 100,
  repeatSteps: 10,
  repeatCount: { min: 2, max: 50 },
  expandedSteps: 400,
  name: 80,
  description: 1000,
  note: 140,
  jsonBytes: 32 * 1024,
  seconds: { min: 5, max: 12 * 3600 },
  meters: { min: 10, max: 300_000 },
  poolLengthM: { min: 10, max: 100 },
  sendOffSeconds: { min: 20, max: 600 },
  // A treadmill step's incline in % and belt speed in km/h (docs/plans/run-logger.md, step 0).
  incline: { min: -3, max: 30 },
  belt: { min: 1, max: 25 },
} as const;

/** At most one decimal: 0.5 and 1.5 pass, 0.25 does not. */
const oneDecimal = (n: number) => Math.abs(Math.round(n * 10) - n * 10) < 1e-6;

/** A treadmill incline in %, -3 to 30 with one decimal, for a step and for a set. */
export const inclinePercentSchema = z
  .number()
  .min(WORKOUT_LIMITS.incline.min)
  .max(WORKOUT_LIMITS.incline.max)
  .refine(oneDecimal, "incline takes at most one decimal");
/** A treadmill step's belt speed in km/h, 1 to 25 with one decimal. */
export const beltKmhSchema = z.number().min(WORKOUT_LIMITS.belt.min).max(WORKOUT_LIMITS.belt.max).refine(oneDecimal, "belt takes at most one decimal");

/** Allowed target values per metric and anchor: percent of the anchor, or metric absolute units. */
const TARGET_RANGE: Record<string, { min: number; max: number; unit: string }> = {
  "power:ftp": { min: 30, max: 200, unit: "% FTP" },
  "power:absolute": { min: 20, max: 2000, unit: "W" },
  "hr:lthr": { min: 50, max: 110, unit: "% LTHR" },
  "hr:max_hr": { min: 40, max: 100, unit: "% max HR" },
  "hr:absolute": { min: 60, max: 230, unit: "bpm" },
  "pace:threshold_pace": { min: 50, max: 130, unit: "% threshold speed" },
  "pace:css": { min: 50, max: 130, unit: "% CSS speed" },
  "pace:absolute": { min: 0.3, max: 12, unit: "m/s" },
  "cadence:absolute": { min: 20, max: 200, unit: "rpm" },
  // By feel, for days with no meter or no thresholds (docs/plans/one-program-model.md, decision 6).
  "rpe:absolute": { min: 1, max: 10, unit: "RPE" },
};
const CSS_OFFSET = { min: -20, max: 60 };
const ZONES: Record<string, number> = { "power:ftp": 5, "hr:lthr": 5 };

/** Which sports may use a metric and anchor pair. */
const SPORTS_FOR: Record<string, readonly WorkoutSport[]> = {
  "power:ftp": ["bike"],
  "power:absolute": ["bike"],
  "hr:lthr": ["bike", "run"],
  "hr:max_hr": ["swim", "bike", "run"],
  "hr:absolute": ["swim", "bike", "run"],
  "pace:threshold_pace": ["run"],
  "pace:css": ["swim"],
  "pace:absolute": ["swim", "bike", "run"],
  "cadence:absolute": ["bike", "run"],
  "rpe:absolute": ["swim", "bike", "run"],
};

const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,24}$/, "letters, digits, - or _, at most 24");

const endSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("time"), seconds: z.number().int().min(WORKOUT_LIMITS.seconds.min).max(WORKOUT_LIMITS.seconds.max) }),
  z.strictObject({ type: z.literal("distance"), meters: z.number().min(WORKOUT_LIMITS.meters.min).max(WORKOUT_LIMITS.meters.max) }),
  z.strictObject({ type: z.literal("lap") }),
]);

const targetSchema = z.strictObject({
  // Said plainly for the mistakes an assistant makes (bike-ride-logger, D12): a set list reaches only this check.
  metric: z.enum(TARGET_METRICS, {
    error: `metric must be ${TARGET_METRICS.join(", ")}. A gradient is never a target: write the climb in the step's note. Speed is a result, not a target`,
  }),
  anchor: z.enum(TARGET_ANCHORS),
  low: z.number().optional(),
  high: z.number().optional(),
  zone: z.number().int().optional(),
  offsetLow: z.number().optional(),
  offsetHigh: z.number().optional(),
});

const rangeSchema = z.strictObject({ low: z.number(), high: z.number() });

/**
 * A bike power target that moves evenly from `from` to `to` over the step
 * (docs/plans/bike-ride-logger.md, step 0), in % FTP or watts. It is the
 * step's main target, in place of `target`.
 */
const rampSchema = z.strictObject({ anchor: z.enum(["ftp", "absolute"]), from: z.number(), to: z.number() });

/**
 * The step fields of a program set (docs/plans/one-program-model.md, 1.1), as
 * an input shape. Shapes only: the ranges and the rules across steps are
 * checked on the whole exercise by checkStepRows (src/lib/utils/program-steps.ts).
 */
export const stepTargetsSchema = z.array(targetSchema).min(1).max(2);
export const programStepFieldsSchema = z.object({
  stepKind: z.enum(STEP_TYPES).nullable().optional(),
  endsOnLap: z.boolean().optional(),
  targets: stepTargetsSchema.nullable().optional(),
  cadenceLow: z.number().int().min(0).max(300).nullable().optional(),
  cadenceHigh: z.number().int().min(0).max(300).nullable().optional(),
  blockId: z.number().int().min(1).max(1000).nullable().optional(),
  blockRound: z.number().int().min(1).max(WORKOUT_LIMITS.repeatCount.max).nullable().optional(),
  stroke: z.enum(SWIM_STROKES).nullable().optional(),
  equipment: z.array(z.enum(SWIM_EQUIPMENT)).max(SWIM_EQUIPMENT.length).nullable().optional(),
  sendOffSeconds: z.number().int().min(WORKOUT_LIMITS.sendOffSeconds.min).max(WORKOUT_LIMITS.sendOffSeconds.max).nullable().optional(),
  note: z.string().trim().min(1).max(WORKOUT_LIMITS.note).nullable().optional(),
  ramp: rampSchema.nullable().optional(),
  free: z.boolean().optional(),
  outdoorTarget: targetSchema.nullable().optional(),
  beltKmh: beltKmhSchema.nullable().optional(),
});

const stepSchema = z.strictObject({
  id: idSchema.optional(),
  type: z.enum(STEP_TYPES),
  end: endSchema,
  target: targetSchema.optional(),
  // A second target that caps the first (for example power with an HR cap).
  target2: targetSchema.optional(),
  cadence: rangeSchema.optional(),
  sendOffSeconds: z.number().int().min(WORKOUT_LIMITS.sendOffSeconds.min).max(WORKOUT_LIMITS.sendOffSeconds.max).optional(),
  stroke: z.enum(SWIM_STROKES).optional(),
  equipment: z.array(z.enum(SWIM_EQUIPMENT)).max(SWIM_EQUIPMENT.length).optional(),
  note: z.string().trim().min(1).max(WORKOUT_LIMITS.note).optional(),
  // Bike only (docs/plans/bike-ride-logger.md, step 0): a ramp in place of the
  // target, a free spin with no target, and the target for an outdoor ride.
  ramp: rampSchema.optional(),
  free: z.literal(true).optional(),
  outdoor: targetSchema.optional(),
  // Run only (docs/plans/run-logger.md, step 0): the treadmill incline in %
  // and the belt speed in km/h written on the step.
  incline: inclinePercentSchema.optional(),
  belt: beltKmhSchema.optional(),
});

const repeatSchema = z.strictObject({
  id: idSchema.optional(),
  type: z.literal("repeat"),
  count: z.number().int().min(WORKOUT_LIMITS.repeatCount.min).max(WORKOUT_LIMITS.repeatCount.max),
  steps: z.array(stepSchema).min(1).max(WORKOUT_LIMITS.repeatSteps),
});

const nodeSchema = z.discriminatedUnion("type", [stepSchema, repeatSchema]);

const baseWorkoutSchema = z.strictObject({
  // Version 2 added ramp, free, outdoor and test. A version 1 tree is still
  // read, and comes back as version 2.
  v: z.union([z.literal(1), z.literal(2)]).transform((): 2 => 2),
  sport: z.enum(WORKOUT_SPORTS),
  name: z.string().trim().min(1).max(WORKOUT_LIMITS.name),
  description: z.string().trim().max(WORKOUT_LIMITS.description).optional(),
  poolLengthM: z.number().min(WORKOUT_LIMITS.poolLengthM.min).max(WORKOUT_LIMITS.poolLengthM.max).optional(),
  test: z.enum(WORKOUT_TESTS).optional(),
  steps: z.array(nodeSchema).min(1).max(WORKOUT_LIMITS.nodes),
});

export type WorkoutStep = z.infer<typeof stepSchema>;
export type WorkoutRepeat = z.infer<typeof repeatSchema>;
export type WorkoutNode = z.infer<typeof nodeSchema>;
export type WorkoutTarget = z.infer<typeof targetSchema>;
export type WorkoutRamp = z.infer<typeof rampSchema>;
export type Workout = z.infer<typeof baseWorkoutSchema>;

/** A ramp as one power range, its ends in order, for the readers that need one range. */
export function rampTarget(r: WorkoutRamp): WorkoutTarget {
  return { metric: "power", anchor: r.anchor, low: Math.min(r.from, r.to), high: Math.max(r.from, r.to) };
}

/** A step's main target: its target, else its ramp as one range. */
export function mainTarget(s: Pick<WorkoutStep, "target" | "ramp">): WorkoutTarget | undefined {
  return s.target ?? (s.ramp ? rampTarget(s.ramp) : undefined);
}

/** The same for a stored step row: its first target, else its ramp. */
export function rowMainTarget(r: { targets?: unknown; ramp?: unknown }): WorkoutTarget | undefined {
  const first = Array.isArray(r.targets) ? (r.targets[0] as WorkoutTarget | undefined) : undefined;
  return first ?? (r.ramp != null ? rampTarget(r.ramp as WorkoutRamp) : undefined);
}

type Issue = { path: (string | number)[]; message: string };

function targetIssues(t: WorkoutTarget, sport: WorkoutSport): { path: string[]; message: string }[] {
  const out: { path: string[]; message: string }[] = [];
  const key = `${t.metric}:${t.anchor}`;
  const range = TARGET_RANGE[key];
  if (!range) return [{ path: ["anchor"], message: `${t.metric} cannot use anchor ${t.anchor}` }];
  if (!SPORTS_FOR[key].includes(sport)) out.push({ path: ["anchor"], message: `${t.metric} with anchor ${t.anchor} is not allowed on a ${sport}` });

  const hasRange = t.low !== undefined || t.high !== undefined;
  const hasZone = t.zone !== undefined;
  const hasOffset = t.offsetLow !== undefined || t.offsetHigh !== undefined;
  const forms = [hasRange, hasZone, hasOffset].filter(Boolean).length;
  if (forms !== 1) return [...out, { path: [], message: "give exactly one of low/high, zone, or offsetLow/offsetHigh" }];

  if (hasZone) {
    const max = ZONES[key];
    if (!max) out.push({ path: ["zone"], message: `zones are only for power with ftp or hr with lthr` });
    else if (t.zone! < 1 || t.zone! > max) out.push({ path: ["zone"], message: `must be 1-${max}` });
    return out;
  }
  if (hasOffset) {
    if (key !== "pace:css") return [...out, { path: ["offsetLow"], message: "offsets are only for pace with anchor css" }];
    if (t.offsetLow === undefined || t.offsetHigh === undefined) return [...out, { path: [], message: "give both offsetLow and offsetHigh" }];
    for (const f of ["offsetLow", "offsetHigh"] as const) {
      if (t[f]! < CSS_OFFSET.min || t[f]! > CSS_OFFSET.max) out.push({ path: [f], message: `must be ${CSS_OFFSET.min} to ${CSS_OFFSET.max} s per 100 m` });
    }
    if (t.offsetLow! > t.offsetHigh!) out.push({ path: ["offsetLow"], message: "must be at most offsetHigh" });
    return out;
  }
  if (t.low === undefined || t.high === undefined) return [...out, { path: [], message: "give both low and high" }];
  for (const f of ["low", "high"] as const) {
    if (t[f]! < range.min || t[f]! > range.max) out.push({ path: [f], message: `must be ${range.min}-${range.max} ${range.unit}` });
  }
  if (t.low! > t.high!) out.push({ path: ["low"], message: "must be at most high" });
  return out;
}

/**
 * Program sets store whole metres, so a yard pool distance (100 yd = 91.44 m)
 * is rounded on write; up to 0.5 m off a whole number of lengths is accepted
 * (docs/plans/one-program-model.md, 1.1).
 */
function isWholeLengths(meters: number, pool: number): boolean {
  const lengths = meters / pool;
  return Math.abs(lengths - Math.round(lengths)) * pool <= 0.5 && Math.round(lengths) >= 1;
}

function stepIssues(step: WorkoutStep, w: Workout, inRepeat: WorkoutRepeat | null): Issue[] {
  const out: Issue[] = [];
  if (step.target) for (const i of targetIssues(step.target, w.sport)) out.push({ path: ["target", ...i.path], message: i.message });
  // A ramp takes no cap: program_sets.targets holds the target and its cap.
  if (step.target2) {
    if (step.ramp && !step.target) out.push({ path: ["target2"], message: "a ramp takes no cap" });
    else if (!step.target) out.push({ path: ["target2"], message: "a second target needs a first one" });
    else if (step.target2.metric === step.target.metric) out.push({ path: ["target2", "metric"], message: "the second target must use another metric" });
    for (const i of targetIssues(step.target2, w.sport)) out.push({ path: ["target2", ...i.path], message: i.message });
  }
  for (const f of ["ramp", "free"] as const) {
    if (step[f] !== undefined && w.sport !== "bike") out.push({ path: [f], message: `${f} is only for bike steps` });
  }
  if (step.outdoor !== undefined && w.sport === "swim") out.push({ path: ["outdoor"], message: "outdoor is only for bike and run steps" });
  for (const f of ["incline", "belt"] as const) {
    if (step[f] !== undefined && w.sport !== "run") out.push({ path: [f], message: `${f} is only for run steps` });
  }
  if (step.ramp) {
    if (step.target) out.push({ path: ["ramp"], message: "give a target or a ramp, not both" });
    const range = TARGET_RANGE[`power:${step.ramp.anchor}`];
    for (const f of ["from", "to"] as const) {
      if (step.ramp[f] < range.min || step.ramp[f] > range.max) out.push({ path: ["ramp", f], message: `must be ${range.min}-${range.max} ${range.unit}` });
    }
  }
  if (step.free && (step.target || step.target2 || step.ramp)) out.push({ path: ["free"], message: "a free step has no target" });
  if (step.outdoor) for (const i of targetIssues(step.outdoor, w.sport)) out.push({ path: ["outdoor", ...i.path], message: i.message });
  if (step.cadence) {
    if (w.sport === "swim") out.push({ path: ["cadence"], message: "cadence is only for bike and run" });
    const r = TARGET_RANGE["cadence:absolute"];
    for (const f of ["low", "high"] as const) {
      if (step.cadence[f] < r.min || step.cadence[f] > r.max) out.push({ path: ["cadence", f], message: `must be ${r.min}-${r.max} rpm` });
    }
    if (step.cadence.low > step.cadence.high) out.push({ path: ["cadence", "low"], message: "must be at most high" });
  }
  if (w.sport !== "swim") {
    for (const f of ["stroke", "equipment", "sendOffSeconds"] as const) {
      if (step[f] !== undefined) out.push({ path: [f], message: `${f} is only for swims` });
    }
  } else {
    if (step.equipment && new Set(step.equipment).size !== step.equipment.length) out.push({ path: ["equipment"], message: "each item once" });
    if (w.poolLengthM !== undefined && step.end.type === "distance" && !isWholeLengths(step.end.meters, w.poolLengthM)) {
      out.push({ path: ["end", "meters"], message: `must be a whole number of ${w.poolLengthM} m lengths` });
    }
    if (step.sendOffSeconds !== undefined) {
      if (step.type !== "work" || !inRepeat) out.push({ path: ["sendOffSeconds"], message: "only on a work step inside a repeat" });
      else if (inRepeat.steps.some((s) => s.type === "rest")) {
        out.push({ path: ["sendOffSeconds"], message: "a repeat with a send-off holds no rest step: the send-off includes the rest" });
      }
    }
  }
  return out;
}

const workoutSchema = baseWorkoutSchema.superRefine((w, ctx) => {
  const add = (path: Issue["path"], message: string) => ctx.addIssue({ code: "custom", path, message });

  if (w.poolLengthM !== undefined && w.sport !== "swim") add(["poolLengthM"], "only for swims");
  if (w.test !== undefined) {
    const allowed: readonly string[] = w.sport === "bike" ? RIDE_TESTS : w.sport === "run" ? RUN_TESTS : [];
    if (!allowed.includes(w.test)) add(["test"], allowed.length ? `a ${w.sport} test is ${allowed.join(" or ")}` : "only for bike and run workouts");
  }
  if (new TextEncoder().encode(JSON.stringify(w)).length > WORKOUT_LIMITS.jsonBytes) add([], `the workout is larger than ${WORKOUT_LIMITS.jsonBytes / 1024} KB`);

  let expanded = 0;
  const ids = new Set<string>();
  const seeId = (id: string | undefined, path: Issue["path"]) => {
    if (id === undefined) return;
    if (ids.has(id)) add([...path, "id"], `id "${id}" is used twice`);
    ids.add(id);
  };
  w.steps.forEach((node, i) => {
    seeId(node.id, ["steps", i]);
    if (node.type === "repeat") {
      expanded += node.count * node.steps.length;
      node.steps.forEach((s, j) => {
        seeId(s.id, ["steps", i, "steps", j]);
        for (const issue of stepIssues(s, w, node)) add(["steps", i, "steps", j, ...issue.path], issue.message);
      });
    } else {
      expanded += 1;
      for (const issue of stepIssues(node, w, null)) add(["steps", i, ...issue.path], issue.message);
    }
  });
  if (expanded > WORKOUT_LIMITS.expandedSteps) add(["steps"], `${expanded} steps once repeats are expanded; at most ${WORKOUT_LIMITS.expandedSteps}`);
});

export type WorkoutParseResult =
  | { ok: true; workout: Workout }
  | { ok: false; errors: { path: string; message: string }[] };

/** "steps[1].steps[0].target.low" */
function pathText(path: PropertyKey[]): string {
  return path.reduce<string>((acc, p) => (typeof p === "number" ? `${acc}[${p}]` : acc ? `${acc}.${String(p)}` : String(p)), "");
}

/** Give every node without an id the next free `s1`, `s2`, ... and keep the given ones. */
function fillIds(w: Workout): Workout {
  const used = new Set<string>();
  for (const n of w.steps) {
    if (n.id) used.add(n.id);
    if (n.type === "repeat") for (const s of n.steps) if (s.id) used.add(s.id);
  }
  let next = 1;
  const fresh = () => {
    while (used.has(`s${next}`)) next++;
    used.add(`s${next}`);
    return `s${next}`;
  };
  return {
    ...w,
    steps: w.steps.map((n) =>
      n.type === "repeat"
        ? { ...n, id: n.id ?? fresh(), steps: n.steps.map((s) => ({ ...s, id: s.id ?? fresh() })) }
        : { ...n, id: n.id ?? fresh() },
    ),
  };
}

/**
 * The schema check. Every problem comes back with its path, in one pass. On
 * success, every node has an id. There is no way to skip it (D3).
 */
export function parseWorkout(input: unknown): WorkoutParseResult {
  const r = workoutSchema.safeParse(input);
  if (!r.success) return { ok: false, errors: r.error.issues.map((i) => ({ path: pathText(i.path), message: i.message })) };
  return { ok: true, workout: fillIds(r.data) };
}

// ── Zones (research, "Store anchors, derive zones") ──────────────────────────

/** Percent bounds per zone; null is an open end. Coggan power %FTP, Friel %LTHR. */
const POWER_ZONES: [number | null, number | null][] = [[null, 54], [55, 74], [75, 89], [90, 104], [105, 120]];
const RUN_HR_ZONES: [number | null, number | null][] = [[null, 84], [85, 89], [90, 94], [95, 99], [100, null]];
const BIKE_HR_ZONES: [number | null, number | null][] = [[null, 80], [81, 89], [90, 93], [94, 99], [100, null]];

/** The run heart rate zone (1 to 5, Friel) of a heart rate in % of run LTHR. */
export function runHrZoneOf(pctLthr: number): number {
  const i = RUN_HR_ZONES.findIndex(([, high]) => high === null || pctLthr < high + 1);
  return i + 1;
}

/**
 * Run pace zones (Friel), as % of threshold pace *time*: a higher number is
 * slower (docs/plans/run-logger.md, 4.2). [fast, slow]; null is an open end.
 * Z5 has three parts. Friel's bounds overlap at Z4 and Z5a; kept as he gives them.
 */
export const RUN_PACE_ZONES = {
  "1": [130, null],
  "2": [114, 129],
  "3": [106, 113],
  "4": [99, 105],
  "5a": [97, 100],
  "5b": [90, 96],
  "5c": [null, 89],
} as const satisfies Record<string, readonly [number | null, number | null]>;
export type RunPaceZone = keyof typeof RUN_PACE_ZONES;

/**
 * The one speed (m/s) a run pace zone stands for: its slow end, as 4.2 uses
 * for a heart rate step's belt (Z2 is 7:17 /km at a 5:39 threshold). Z1 has
 * no slow end: it stands at Z1_PACE_PCT, so a Z1 step is slower than a Z2 one.
 */
export function runZoneSpeed(zone: RunPaceZone, thresholdSpeed: number): number {
  const [, slow] = RUN_PACE_ZONES[zone];
  return (thresholdSpeed * 100) / (slow ?? Z1_PACE_PCT);
}
/** Where the open Z1 stands, in % of threshold pace time: 7:55 /km at a 5:39 threshold, 7.6 km/h. */
export const Z1_PACE_PCT = 140;

function zoneBounds(t: WorkoutTarget, sport: WorkoutSport): [number | null, number | null] {
  const table = t.metric === "power" ? POWER_ZONES : sport === "bike" ? BIKE_HR_ZONES : RUN_HR_ZONES;
  return table[(t.zone ?? 1) - 1];
}

/** Low end of zone 4, in percent of the anchor: where "hard" starts. */
const HARD_FROM = { power: 90, hrBike: 94, hrRun: 95, pace: 97, cssOffset: 3 } as const;

// ── Resolving targets to the user's numbers ─────────────────────────────────

/** Current threshold values (metric), by kind. */
export type ThresholdValues = Partial<Record<ThresholdKind, number>>;

export function anchorKind(t: WorkoutTarget, sport: WorkoutSport): ThresholdKind | null {
  switch (t.anchor) {
    case "ftp":
      return "ftp";
    case "lthr":
      return sport === "bike" ? "lthr_bike" : "lthr_run";
    case "max_hr":
      return "max_hr";
    case "threshold_pace":
      return "run_threshold_pace";
    case "css":
      return "swim_css";
    default:
      return null;
  }
}

/** A resolved target: metric bounds (W, bpm, m/s or rpm; null is open) and text in the user's units. */
export type ResolvedTarget = { low: number | null; high: number | null; unit: "W" | "bpm" | "m/s" | "rpm" | "RPE"; text: string; missing: ThresholdKind | null };

const UNIT_OF = { power: "W", hr: "bpm", pace: "m/s", cadence: "rpm", rpe: "RPE" } as const;

/** Bounds as a percent (or absolute) before the anchor is applied. */
function relativeBounds(t: WorkoutTarget, sport: WorkoutSport): [number | null, number | null] {
  if (t.zone !== undefined) return zoneBounds(t, sport);
  return [t.low ?? null, t.high ?? null];
}

/** Speed (m/s) from CSS plus seconds per 100 m. */
function cssOffsetSpeed(css: number, offset: number): number {
  return 100 / (100 / css + offset);
}

function paceText(speed: number, sport: WorkoutSport, units: Units): string {
  const measure = sport === "swim" ? "swimPace" : "runPace";
  return `${minSec(paceUnitMeters(measure, units) / speed)}${paceUnitLabel(measure, units)}`;
}

/** What the target says with no threshold: "88-93% FTP", "Z2 HR", "CSS +2 to +5 s/100m". */
export function targetLabel(t: WorkoutTarget, sport: WorkoutSport, units: Units = DEFAULT_UNITS): string {
  if (t.zone !== undefined) return `Z${t.zone} ${t.metric === "power" ? "power" : "HR"}`;
  if (t.offsetLow !== undefined) {
    const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
    return `CSS ${sign(t.offsetLow)} to ${sign(t.offsetHigh!)} s/100m`;
  }
  const range = (a: number, b: number, unit: string) => (a === b ? `${a}${unit}` : `${a}-${b}${unit}`);
  const label: Record<string, string> = {
    "power:ftp": "% FTP",
    "hr:lthr": "% LTHR",
    "hr:max_hr": "% max HR",
    "pace:threshold_pace": "% threshold pace",
    "pace:css": "% CSS",
  };
  const key = `${t.metric}:${t.anchor}`;
  if (label[key]) return range(t.low!, t.high!, label[key]);
  if (t.metric === "rpe") return `RPE ${range(t.low!, t.high!, "")}`;
  if (t.metric === "pace") return `${paceText(t.low!, sport, units)} to ${paceText(t.high!, sport, units)}`;
  return range(t.low!, t.high!, ` ${UNIT_OF[t.metric]}`);
}

/** A target in watts, bpm, pace or rpm from the current thresholds. */
export function resolveTarget(t: WorkoutTarget, sport: WorkoutSport, thresholds: ThresholdValues, units: Units = DEFAULT_UNITS): ResolvedTarget {
  const unit = UNIT_OF[t.metric];
  const kind = anchorKind(t, sport);
  const anchor = kind ? thresholds[kind] : undefined;
  if (kind && anchor === undefined) {
    return { low: null, high: null, unit, text: `${targetLabel(t, sport, units)} (no ${kind} set)`, missing: kind };
  }

  let low: number | null;
  let high: number | null;
  if (t.offsetLow !== undefined) {
    // A larger offset is slower: offsetHigh gives the low speed.
    low = cssOffsetSpeed(anchor!, t.offsetHigh!);
    high = cssOffsetSpeed(anchor!, t.offsetLow);
  } else {
    const [a, b] = relativeBounds(t, sport);
    const scale = (p: number | null) => (p === null ? null : kind ? (anchor! * p) / 100 : p);
    low = scale(a);
    high = scale(b);
  }

  let text: string;
  if (t.metric === "pace") {
    // Faster pace (higher speed) first, as runners read it: "4:27-4:42/km".
    const fast = high !== null ? paceText(high, sport, units) : null;
    const slow = low !== null ? paceText(low, sport, units) : null;
    text = fast && slow ? `${fast.replace(/\/.*$/, "")}-${slow}` : (fast ?? slow ?? "");
  } else if (t.metric === "rpe") {
    text = targetLabel(t, sport, units);
  } else {
    const r = (n: number) => Math.round(n);
    text = low === null ? `up to ${r(high!)} ${unit}` : high === null ? `${r(low)} ${unit} or more` : r(low) === r(high) ? `${r(low)} ${unit}` : `${r(low)}-${r(high)} ${unit}`;
  }
  return { low, high, unit, text, missing: null };
}

/**
 * A step's main target in the user's numbers. A ramp gives its range, with
 * its ends in the ride's order: "90 to 135 W", or "ramp 50 to 75% FTP"
 * without an FTP.
 */
export function resolveStepTarget(s: Pick<WorkoutStep, "target" | "ramp">, sport: WorkoutSport, thresholds: ThresholdValues, units: Units = DEFAULT_UNITS): ResolvedTarget | null {
  const main = mainTarget(s);
  if (!main) return null;
  const r = resolveTarget(main, sport, thresholds, units);
  if (!s.ramp || s.target) return r;
  if (r.missing) return { ...r, text: `${rampLabel(s.ramp)} (no ${r.missing} set)` };
  const ftp = s.ramp.anchor === "ftp" ? thresholds.ftp! : null;
  const w = (p: number) => Math.round(ftp ? (ftp * p) / 100 : p);
  return { ...r, text: `${w(s.ramp.from)} to ${w(s.ramp.to)} W` };
}

/** "ramp 50 to 75% FTP", "ramp 100 to 200 W". */
function rampLabel(r: WorkoutRamp): string {
  return `ramp ${r.from} to ${r.to}${r.anchor === "ftp" ? "% FTP" : " W"}`;
}

export type ResolvedStep = WorkoutStep & { resolved: ResolvedTarget | null };
export type ResolvedNode = ResolvedStep | (Omit<WorkoutRepeat, "steps"> & { steps: ResolvedStep[] });

/** Each step's target in the user's numbers, and the anchors the workout needs but the user has not set. */
export function resolveWorkout(w: Workout, thresholds: ThresholdValues, units: Units = DEFAULT_UNITS): { steps: ResolvedNode[]; missingAnchors: ThresholdKind[] } {
  const missing = new Set<ThresholdKind>();
  const one = (s: WorkoutStep): ResolvedStep => {
    const resolved = resolveStepTarget(s, w.sport, thresholds, units);
    if (resolved?.missing) missing.add(resolved.missing);
    return { ...s, resolved };
  };
  const steps = w.steps.map((n) => (n.type === "repeat" ? { ...n, steps: n.steps.map(one) } : one(n)));
  return { steps, missingAnchors: [...missing] };
}

// ── Estimate ─────────────────────────────────────────────────────────────────

export type WorkoutEstimate = {
  durationSeconds: number;
  distanceMeters: number;
  /** False when a lap step, or a distance step with no known speed, leaves time out. */
  durationComplete: boolean;
  /** False when a lap step, or a time step with no known speed, leaves distance out. */
  distanceComplete: boolean;
};

/** Mid speed (m/s) of a pace target, when it resolves; null for any other target. */
export function paceTargetSpeed(t: WorkoutTarget | undefined, sport: WorkoutSport, thresholds: ThresholdValues): number | null {
  if (!t || t.metric !== "pace") return null;
  const r = resolveTarget(t, sport, thresholds);
  if (r.low === null || r.high === null) return r.low ?? r.high;
  return (r.low + r.high) / 2;
}

function targetSpeed(s: WorkoutStep, sport: WorkoutSport, thresholds: ThresholdValues): number | null {
  return paceTargetSpeed(s.target, sport, thresholds);
}

/** Total time and distance, from the steps and, where a pace target resolves, its speed. */
export function estimateWorkout(w: Workout, thresholds: ThresholdValues = {}): WorkoutEstimate {
  const est: WorkoutEstimate = { durationSeconds: 0, distanceMeters: 0, durationComplete: true, distanceComplete: true };
  const add = (s: WorkoutStep, times: number) => {
    const speed = targetSpeed(s, w.sport, thresholds);
    if (s.end.type === "lap") {
      est.durationComplete = false;
      est.distanceComplete = false;
    } else if (s.end.type === "time") {
      est.durationSeconds += s.end.seconds * times;
      if (speed) est.distanceMeters += s.end.seconds * speed * times;
      else if (s.type !== "rest") est.distanceComplete = false;
    } else {
      est.distanceMeters += s.end.meters * times;
      if (s.sendOffSeconds !== undefined) est.durationSeconds += s.sendOffSeconds * times;
      else if (speed) est.durationSeconds += (s.end.meters / speed) * times;
      else est.durationComplete = false;
    }
  };
  for (const n of w.steps) {
    if (n.type === "repeat") for (const s of n.steps) add(s, n.count);
    else add(n, 1);
  }
  est.durationSeconds = Math.round(est.durationSeconds);
  est.distanceMeters = Math.round(est.distanceMeters);
  return est;
}

// ── Summary text ─────────────────────────────────────────────────────────────

const STEP_WORD: Record<WorkoutStep["type"], string> = {
  warmup: "warm-up",
  work: "",
  recovery: "easy",
  cooldown: "cool-down",
  rest: "rest",
};

function durationText(seconds: number): string {
  if (seconds % 3600 === 0) return `${seconds / 3600} h`;
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)} h ${Math.round((seconds % 3600) / 60)} min`;
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return seconds < 60 ? `${seconds} s` : minSec(seconds);
}

function distanceText(meters: number, sport: WorkoutSport, units: Units): string {
  if (sport === "swim") {
    return units.swim === "yd" ? `${Math.round(meters / METERS_PER_YARD)} yd` : `${Math.round(meters)} m`;
  }
  if (units.distance === "mi") return `${+(meters / METERS_PER_MILE).toFixed(2)} mi`;
  return meters < 1000 ? `${Math.round(meters)} m` : `${+(meters / 1000).toFixed(2)} km`;
}

function stepText(s: WorkoutStep, sport: WorkoutSport, units: Units): string {
  const end = s.end.type === "time" ? durationText(s.end.seconds) : s.end.type === "distance" ? distanceText(s.end.meters, sport, units) : "to lap";
  const parts = [end];
  if (STEP_WORD[s.type]) parts.push(STEP_WORD[s.type]);
  if (s.stroke && s.stroke !== "free") parts.push(s.stroke);
  if (s.target) parts.push(targetLabel(s.target, sport, units));
  else if (s.ramp) parts.push(rampLabel(s.ramp));
  else if (s.free) parts.push("free");
  if (s.sendOffSeconds !== undefined) parts.push(`on ${minSec(s.sendOffSeconds)}`);
  return parts.join(" ");
}

/** One line: "15 min warm-up 50-70% FTP · 3 × (10 min 88-93% FTP, 5 min easy Z1 power) · to lap cool-down Z1 HR". */
export function describeWorkout(w: Workout, units: Units = DEFAULT_UNITS): string {
  return w.steps
    .map((n) =>
      n.type === "repeat"
        ? `${n.count} × ${n.steps.length === 1 ? stepText(n.steps[0], w.sport, units) : `(${n.steps.map((s) => stepText(s, w.sport, units)).join(", ")})`}`
        : stepText(n, w.sport, units),
    )
    .join(" · ");
}

// ── Hard workout (next to isHardSession in src/lib/utils/training-limits.ts) ─

/** Whether one target's low end is in zone 4 or above. Pace bounds are inference: the research table has no pace zones. */
export function hardTarget(t: WorkoutTarget, sport: WorkoutSport, thresholds: ThresholdValues): boolean {
  if (t.zone !== undefined) return t.zone >= 4;
  // The slow end, as for percent targets: a larger offset is slower (review 11).
  if (t.offsetHigh !== undefined) return t.offsetHigh <= HARD_FROM.cssOffset;
  if (t.metric === "cadence") return false;
  // RPE 7 or more is hard on the 1-10 scale (inference, as the zone bounds are).
  if (t.metric === "rpe") return t.low! >= 7;
  let pct: number | null;
  if (t.anchor === "absolute") {
    const kind: ThresholdKind | null = t.metric === "power" ? "ftp" : t.metric === "hr" ? (sport === "bike" ? "lthr_bike" : sport === "run" ? "lthr_run" : null) : sport === "run" ? "run_threshold_pace" : sport === "swim" ? "swim_css" : null;
    const anchor = kind ? thresholds[kind] : undefined;
    pct = anchor ? (t.low! / anchor) * 100 : null;
  } else if (t.anchor === "max_hr") {
    return false;
  } else {
    pct = t.low!;
  }
  if (pct === null) return false;
  if (t.metric === "power") return pct >= HARD_FROM.power;
  if (t.metric === "hr") return pct >= (sport === "bike" ? HARD_FROM.hrBike : HARD_FROM.hrRun);
  return pct >= HARD_FROM.pace;
}

/**
 * A workout is hard when it has intervals (a repeat holding a work step) or a
 * work step targets zone 4 or above, as isHardSession does for program sets
 * (a "work" rep, or zone 4-5). Which sessions count as hard is inference
 * (owner decision 2 in docs/plans/ai-coach.md).
 */
export function isHardWorkout(w: Workout, thresholds: ThresholdValues = {}): boolean {
  const hardStep = (s: WorkoutStep) => {
    const main = mainTarget(s);
    return s.type === "work" && main !== undefined && hardTarget(main, w.sport, thresholds);
  };
  return w.steps.some((n) => (n.type === "repeat" ? n.steps.some((s) => s.type === "work") : hardStep(n)));
}
