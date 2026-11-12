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
export const TARGET_METRICS = ["power", "hr", "pace", "cadence"] as const;
export const TARGET_ANCHORS = ["ftp", "lthr", "max_hr", "threshold_pace", "css", "absolute"] as const;
export const SWIM_STROKES = ["free", "back", "breast", "fly", "im", "choice", "kick", "pull", "drill"] as const;
export const SWIM_EQUIPMENT = ["pull_buoy", "paddles", "fins", "kickboard", "snorkel"] as const;

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
} as const;

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
};

const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,24}$/, "letters, digits, - or _, at most 24");

const endSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("time"), seconds: z.number().int().min(WORKOUT_LIMITS.seconds.min).max(WORKOUT_LIMITS.seconds.max) }),
  z.strictObject({ type: z.literal("distance"), meters: z.number().min(WORKOUT_LIMITS.meters.min).max(WORKOUT_LIMITS.meters.max) }),
  z.strictObject({ type: z.literal("lap") }),
]);

const targetSchema = z.strictObject({
  metric: z.enum(TARGET_METRICS),
  anchor: z.enum(TARGET_ANCHORS),
  low: z.number().optional(),
  high: z.number().optional(),
  zone: z.number().int().optional(),
  offsetLow: z.number().optional(),
  offsetHigh: z.number().optional(),
});

const rangeSchema = z.strictObject({ low: z.number(), high: z.number() });

const stepSchema = z.strictObject({
  id: idSchema.optional(),
  type: z.enum(STEP_TYPES),
  end: endSchema,
  target: targetSchema.optional(),
  cadence: rangeSchema.optional(),
  sendOffSeconds: z.number().int().min(WORKOUT_LIMITS.sendOffSeconds.min).max(WORKOUT_LIMITS.sendOffSeconds.max).optional(),
  stroke: z.enum(SWIM_STROKES).optional(),
  equipment: z.array(z.enum(SWIM_EQUIPMENT)).max(SWIM_EQUIPMENT.length).optional(),
  note: z.string().trim().min(1).max(WORKOUT_LIMITS.note).optional(),
});

const repeatSchema = z.strictObject({
  id: idSchema.optional(),
  type: z.literal("repeat"),
  count: z.number().int().min(WORKOUT_LIMITS.repeatCount.min).max(WORKOUT_LIMITS.repeatCount.max),
  steps: z.array(stepSchema).min(1).max(WORKOUT_LIMITS.repeatSteps),
});

const nodeSchema = z.discriminatedUnion("type", [stepSchema, repeatSchema]);

const baseWorkoutSchema = z.strictObject({
  v: z.literal(1),
  sport: z.enum(WORKOUT_SPORTS),
  name: z.string().trim().min(1).max(WORKOUT_LIMITS.name),
  description: z.string().trim().max(WORKOUT_LIMITS.description).optional(),
  poolLengthM: z.number().min(WORKOUT_LIMITS.poolLengthM.min).max(WORKOUT_LIMITS.poolLengthM.max).optional(),
  steps: z.array(nodeSchema).min(1).max(WORKOUT_LIMITS.nodes),
});

export type WorkoutStep = z.infer<typeof stepSchema>;
export type WorkoutRepeat = z.infer<typeof repeatSchema>;
export type WorkoutNode = z.infer<typeof nodeSchema>;
export type WorkoutTarget = z.infer<typeof targetSchema>;
export type Workout = z.infer<typeof baseWorkoutSchema>;

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

function isWholeLengths(meters: number, pool: number): boolean {
  const lengths = meters / pool;
  return Math.abs(lengths - Math.round(lengths)) * pool <= 0.01 && Math.round(lengths) >= 1;
}

function stepIssues(step: WorkoutStep, w: Workout, inRepeat: WorkoutRepeat | null): Issue[] {
  const out: Issue[] = [];
  if (step.target) for (const i of targetIssues(step.target, w.sport)) out.push({ path: ["target", ...i.path], message: i.message });
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
  if (JSON.stringify(w).length > WORKOUT_LIMITS.jsonBytes) add([], `the workout is larger than ${WORKOUT_LIMITS.jsonBytes / 1024} KB`);

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
export type ResolvedTarget = { low: number | null; high: number | null; unit: "W" | "bpm" | "m/s" | "rpm"; text: string; missing: ThresholdKind | null };

const UNIT_OF = { power: "W", hr: "bpm", pace: "m/s", cadence: "rpm" } as const;

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
  } else {
    const r = (n: number) => Math.round(n);
    text = low === null ? `up to ${r(high!)} ${unit}` : high === null ? `${r(low)} ${unit} or more` : r(low) === r(high) ? `${r(low)} ${unit}` : `${r(low)}-${r(high)} ${unit}`;
  }
  return { low, high, unit, text, missing: null };
}

export type ResolvedStep = WorkoutStep & { resolved: ResolvedTarget | null };
export type ResolvedNode = ResolvedStep | (Omit<WorkoutRepeat, "steps"> & { steps: ResolvedStep[] });

/** Each step's target in the user's numbers, and the anchors the workout needs but the user has not set. */
export function resolveWorkout(w: Workout, thresholds: ThresholdValues, units: Units = DEFAULT_UNITS): { steps: ResolvedNode[]; missingAnchors: ThresholdKind[] } {
  const missing = new Set<ThresholdKind>();
  const one = (s: WorkoutStep): ResolvedStep => {
    const resolved = s.target ? resolveTarget(s.target, w.sport, thresholds, units) : null;
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

/** Mid speed of a pace target, when it resolves. */
function targetSpeed(s: WorkoutStep, sport: WorkoutSport, thresholds: ThresholdValues): number | null {
  if (!s.target || s.target.metric !== "pace") return null;
  const r = resolveTarget(s.target, sport, thresholds);
  if (r.low === null || r.high === null) return r.low ?? r.high;
  return (r.low + r.high) / 2;
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
function hardTarget(t: WorkoutTarget, sport: WorkoutSport, thresholds: ThresholdValues): boolean {
  if (t.zone !== undefined) return t.zone >= 4;
  if (t.offsetLow !== undefined) return t.offsetLow <= HARD_FROM.cssOffset;
  if (t.metric === "cadence") return false;
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
  const hardStep = (s: WorkoutStep) => s.type === "work" && s.target !== undefined && hardTarget(s.target, w.sport, thresholds);
  return w.steps.some((n) => (n.type === "repeat" ? n.steps.some((s) => s.type === "work") : hardStep(n)));
}
