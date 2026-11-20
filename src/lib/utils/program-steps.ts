/**
 * Endurance steps stored as program sets (docs/plans/one-program-model.md).
 *
 * A program set with a `stepKind` is one step of a structured endurance
 * session. The rows are the storage; the step tree in workout-steps.ts is the
 * model the rest of the app reads. This module converts between the two, so
 * the existing schema check (`parseWorkout`), the estimate, the hard flag and
 * the guided player work on programs unchanged.
 *
 * A repeat block is stored one row per round: rows of one block share
 * `blockId` inside the exercise and carry `blockRound` 1..N. Every round holds
 * the same steps in the same order.
 *
 * Pure: no database access.
 */

import type { StepKind } from "@/db/schema/programs";
import type { ProgramWorkout } from "@/lib/program-workouts";
import { plannedRows, type PlannedRow } from "@/lib/utils/step-results";
import { DEFAULT_UNITS, type Units } from "@/lib/utils/units";
import { flattenWorkout, type PlayStep } from "@/lib/utils/workout-player";
import {
  WORKOUT_LIMITS,
  parseWorkout,
  type Workout,
  type WorkoutNode,
  type WorkoutSport,
  type WorkoutStep,
  type ThresholdValues,
  type WorkoutRamp,
  type WorkoutTarget,
} from "@/lib/utils/workout-steps";

/** The program_sets fields a step reads. */
export type StepRow = {
  id?: number;
  setNumber: number;
  stepKind: StepKind | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
  endsOnLap: boolean;
  targets: unknown;
  cadenceLow: number | null;
  cadenceHigh: number | null;
  blockId: number | null;
  blockRound: number | null;
  stroke: string | null;
  equipment: string[] | null;
  sendOffSeconds: number | null;
  note: string | null;
  // Bike only (docs/plans/bike-ride-logger.md, step 0).
  ramp: unknown;
  free: boolean;
  outdoorTarget: unknown;
  // Run only (docs/plans/run-logger.md, step 0): a treadmill step's incline in % and its belt in km/h.
  inclinePercent: number | null;
  beltKmh: number | null;
};

/** The step fields of a row, as written: everything StepRow has except id and setNumber. */
export type StepFields = Omit<StepRow, "id" | "setNumber">;

/** A strength (or legacy endurance) set: no step fields. */
export const EMPTY_STEP_FIELDS: StepFields = {
  stepKind: null,
  durationSeconds: null,
  distanceMeters: null,
  endsOnLap: false,
  targets: null,
  cadenceLow: null,
  cadenceHigh: null,
  blockId: null,
  blockRound: null,
  stroke: null,
  equipment: null,
  sendOffSeconds: null,
  note: null,
  ramp: null,
  free: false,
  outdoorTarget: null,
  inclinePercent: null,
  beltKmh: null,
};

/** The program_sets columns that make a row a step, for every path that copies sets field by field. */
export const STEP_FIELD_KEYS = [
  "stepKind",
  "endsOnLap",
  "targets",
  "cadenceLow",
  "cadenceHigh",
  "blockId",
  "blockRound",
  "stroke",
  "equipment",
  "sendOffSeconds",
  "note",
  "ramp",
  "free",
  "outdoorTarget",
  "beltKmh",
] as const satisfies readonly (keyof StepFields)[];

/** The step columns of a row (the end columns are copied with the set's own fields). */
export function stepFieldsOf(r: Pick<StepRow, (typeof STEP_FIELD_KEYS)[number]>): Pick<StepFields, (typeof STEP_FIELD_KEYS)[number]> {
  return Object.fromEntries(STEP_FIELD_KEYS.map((k) => [k, r[k]])) as Pick<StepFields, (typeof STEP_FIELD_KEYS)[number]>;
}

export function isStepRow(r: { stepKind: string | null }): boolean {
  return r.stepKind != null;
}

export type StepProblem = { setNumber: number | null; message: string };

type Built = { workout: Workout; nodeSets: number[][] } | { problems: StepProblem[] };

function targetsOf(r: StepRow): { target?: WorkoutTarget; target2?: WorkoutTarget } {
  if (r.targets == null) return {};
  // Shape is checked by parseWorkout; here only the list form is read.
  const list = Array.isArray(r.targets) ? (r.targets as WorkoutTarget[]) : [];
  return {
    ...(list[0] !== undefined && { target: list[0] }),
    ...(list[1] !== undefined && { target2: list[1] }),
  };
}

/**
 * One row as a tree step. Problems with the end are returned, not thrown. A
 * row's incline and belt are run step fields; another sport's row keeps its
 * incline to itself, as it did before steps had one.
 */
function rowStep(r: StepRow, sport: WorkoutSport | null): { step: WorkoutStep } | { problem: string } {
  const ends = [r.endsOnLap, r.durationSeconds != null && r.durationSeconds > 0, r.distanceMeters != null && r.distanceMeters > 0].filter(Boolean).length;
  if (ends !== 1) return { problem: "give exactly one end: time, distance or lap" };
  const end: WorkoutStep["end"] = r.endsOnLap
    ? { type: "lap" }
    : r.durationSeconds != null && r.durationSeconds > 0
      ? { type: "time", seconds: r.durationSeconds }
      : { type: "distance", meters: r.distanceMeters! };
  const step: WorkoutStep = {
    type: r.stepKind!,
    end,
    ...targetsOf(r),
    ...(r.cadenceLow != null && r.cadenceHigh != null && { cadence: { low: r.cadenceLow, high: r.cadenceHigh } }),
    ...(r.sendOffSeconds != null && { sendOffSeconds: r.sendOffSeconds }),
    ...(r.stroke != null && { stroke: r.stroke as WorkoutStep["stroke"] }),
    ...(r.equipment != null && r.equipment.length > 0 && { equipment: r.equipment as WorkoutStep["equipment"] }),
    ...(r.note != null && { note: r.note }),
    ...(r.ramp != null && { ramp: r.ramp as WorkoutRamp }),
    ...(r.free && { free: true as const }),
    ...(r.outdoorTarget != null && { outdoor: r.outdoorTarget as WorkoutTarget }),
    ...(sport === "run" && r.inclinePercent != null && { incline: r.inclinePercent }),
    ...(sport === "run" && r.beltKmh != null && { belt: r.beltKmh }),
  };
  if ((r.cadenceLow == null) !== (r.cadenceHigh == null)) return { problem: "give both cadence bounds" };
  return { step };
}

/** One step row as a tree step, or null when its end is broken. `sport` is the exercise's: only a run step reads incline and belt. */
export function stepOfRow(r: StepRow, sport: WorkoutSport | null = null): WorkoutStep | null {
  if (r.stepKind == null) return null;
  const s = rowStep(r, sport);
  return "step" in s ? s.step : null;
}

/**
 * What a logged step keeps of its plan (workout_sets.plannedStep): the step,
 * its place in a repeat block and the threshold values its targets resolved
 * with, so a later edit, the weekly sync or a retest never changes it.
 */
export type PlannedStepSnapshot = {
  // 2 from the bike ride logger: the step can hold ramp, free and outdoor.
  v: 1 | 2;
  sport: WorkoutSport;
  step: WorkoutStep;
  blockId: number | null;
  blockRound: number | null;
  thresholds: Partial<Record<string, number>>;
};

/** Same step content (round copies must match). */
function sameStep(a: WorkoutStep, b: WorkoutStep): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Build the step tree from the step rows of one exercise (any order; sorted by
 * setNumber). `nodeSets[i]` lists the setNumbers behind tree node i, so a
 * schema problem can name the set. Structural problems (an end, a block that
 * is split or whose rounds differ) come back as problems.
 */
export function buildWorkout(
  rows: StepRow[],
  meta: { sport: WorkoutSport; name: string; poolLengthM?: number | null; description?: string | null; test?: Workout["test"] | null },
): Built {
  const sorted = [...rows].sort((a, b) => a.setNumber - b.setNumber);
  const problems: StepProblem[] = [];
  const nodes: WorkoutNode[] = [];
  const nodeSets: number[][] = [];
  const seenBlocks = new Set<number>();

  let i = 0;
  while (i < sorted.length) {
    const r = sorted[i];
    if (r.stepKind == null) {
      problems.push({ setNumber: r.setNumber, message: "every set of a structured exercise needs a step kind" });
      i++;
      continue;
    }
    if (r.blockId == null) {
      if (r.blockRound != null) problems.push({ setNumber: r.setNumber, message: "a round needs a block" });
      const s = rowStep(r, meta.sport);
      if ("problem" in s) problems.push({ setNumber: r.setNumber, message: s.problem });
      else {
        nodes.push(s.step);
        nodeSets.push([r.setNumber]);
      }
      i++;
      continue;
    }

    // A block: the run of rows with this blockId.
    const blockId = r.blockId;
    if (seenBlocks.has(blockId)) {
      problems.push({ setNumber: r.setNumber, message: "the sets of a repeat block must be next to each other" });
    }
    seenBlocks.add(blockId);
    let j = i;
    while (j < sorted.length && sorted[j].blockId === blockId) j++;
    const run = sorted.slice(i, j);
    i = j;

    const rounds = new Map<number, StepRow[]>();
    for (const x of run) {
      if (x.blockRound == null || x.blockRound < 1) {
        problems.push({ setNumber: x.setNumber, message: "a set in a repeat block needs its round" });
        continue;
      }
      rounds.set(x.blockRound, [...(rounds.get(x.blockRound) ?? []), x]);
    }
    const count = rounds.size;
    const roundNos = [...rounds.keys()];
    if (roundNos.some((n, k) => roundNos[k - 1] !== undefined && n < roundNos[k - 1])) {
      problems.push({ setNumber: run[0].setNumber, message: "the rounds of a repeat block must be in order" });
    }
    if (count > 0 && Math.max(...roundNos) !== count) {
      problems.push({ setNumber: run[0].setNumber, message: "the rounds of a repeat block must be 1, 2, 3 and so on" });
    }
    const first = rounds.get(1) ?? [];
    const firstSteps: WorkoutStep[] = [];
    for (const x of first) {
      const s = rowStep(x, meta.sport);
      if ("problem" in s) problems.push({ setNumber: x.setNumber, message: s.problem });
      else firstSteps.push(s.step);
    }
    for (const [n, list] of rounds) {
      if (n === 1) continue;
      const same = list.length === first.length && list.every((x, k) => {
        const s = rowStep(x, meta.sport);
        return "step" in s && firstSteps[k] !== undefined && sameStep(s.step, firstSteps[k]);
      });
      if (!same) problems.push({ setNumber: list[0].setNumber, message: `round ${n} of the repeat block differs from round 1` });
    }
    if (count < 2) problems.push({ setNumber: run[0].setNumber, message: "a repeat block needs at least 2 rounds" });
    nodes.push({ type: "repeat", count: Math.max(count, 2), steps: firstSteps });
    nodeSets.push(run.map((x) => x.setNumber));
  }

  if (sorted.length === 0) problems.push({ setNumber: null, message: "a structured exercise needs at least one step" });
  if (problems.length) return { problems };
  return {
    workout: {
      v: 2,
      sport: meta.sport,
      name: meta.name.trim().slice(0, 80) || "Session",
      ...(meta.description ? { description: meta.description.slice(0, 1000) } : {}),
      ...(meta.poolLengthM != null ? { poolLengthM: meta.poolLengthM } : {}),
      ...(meta.test != null ? { test: meta.test } : {}),
      steps: nodes,
    },
    nodeSets,
  };
}

/** "steps[2].steps[0].target.low" → the set it points at, plus the field part. */
function locate(path: string, nodeSets: number[][]): { setNumber: number | null; field: string } {
  const m = /^steps\[(\d+)\](?:\.steps\[(\d+)\])?\.?(.*)$/.exec(path);
  if (!m) return { setNumber: null, field: path };
  const sets = nodeSets[Number(m[1])] ?? [];
  const inner = m[2] !== undefined ? Number(m[2]) : 0;
  return { setNumber: sets[inner] ?? sets[0] ?? null, field: m[3] };
}

/**
 * The whole-exercise check: every rule of the structured workout schema
 * (one end per step, targets allowed per sport, whole pool lengths, send-off
 * only in a repeat with no rest step, the size limits) plus the block rules.
 * An empty list means the rows are valid.
 */
export function checkStepRows(
  rows: StepRow[],
  meta: { sport: WorkoutSport | null; name: string; poolLengthM?: number | null; test?: Workout["test"] | null },
): StepProblem[] {
  const steps = rows.filter(isStepRow);
  if (steps.length === 0) return [];
  if (!meta.sport) return [{ setNumber: steps[0].setNumber, message: "only a swim, bike or run exercise can hold steps" }];
  if (steps.length !== rows.length) {
    const plain = rows.find((r) => !isStepRow(r))!;
    return [{ setNumber: plain.setNumber, message: "every set of a structured exercise needs a step kind" }];
  }
  const built = buildWorkout(steps, { sport: meta.sport, name: meta.name, poolLengthM: meta.poolLengthM, test: meta.test });
  if ("problems" in built) return built.problems;
  const parsed = parseWorkout(built.workout);
  if (parsed.ok) return [];
  return parsed.errors.map((e) => {
    const at = locate(e.path, built.nodeSets);
    return { setNumber: at.setNumber, message: at.field ? `${at.field} ${e.message}` : e.message };
  });
}

/** One line per problem, for an action's error text: "Set 3: target.low must be 30-200 % FTP". */
export function stepProblemText(problems: StepProblem[]): string {
  return problems
    .slice(0, 5)
    .map((p) => (p.setNumber != null ? `Set ${p.setNumber}: ${p.message}` : p.message))
    .join(". ");
}

/**
 * A step tree as program set rows, setNumber from 1. Repeat blocks get
 * blockId 1, 2, ... and one row per round. Used by the assistant's tree input,
 * the readiness swap and tests.
 */
export function workoutToRows(w: Workout): (StepFields & { setNumber: number })[] {
  const out: (StepFields & { setNumber: number })[] = [];
  const fields = (s: WorkoutStep): StepFields => ({
    ...EMPTY_STEP_FIELDS,
    stepKind: s.type,
    durationSeconds: s.end.type === "time" ? s.end.seconds : null,
    distanceMeters: s.end.type === "distance" ? Math.round(s.end.meters) : null,
    endsOnLap: s.end.type === "lap",
    targets: s.target ? (s.target2 ? [s.target, s.target2] : [s.target]) : null,
    cadenceLow: s.cadence?.low ?? null,
    cadenceHigh: s.cadence?.high ?? null,
    stroke: s.stroke ?? null,
    equipment: s.equipment ?? null,
    sendOffSeconds: s.sendOffSeconds ?? null,
    note: s.note ?? null,
    ramp: s.ramp ?? null,
    free: s.free ?? false,
    outdoorTarget: s.outdoor ?? null,
    inclinePercent: s.incline ?? null,
    beltKmh: s.belt ?? null,
  });
  let block = 0;
  for (const n of w.steps) {
    if (n.type === "repeat") {
      block++;
      for (let round = 1; round <= n.count; round++) {
        for (const s of n.steps) out.push({ ...fields(s), blockId: block, blockRound: round, setNumber: out.length + 1 });
      }
    } else {
      out.push({ ...fields(n), setNumber: out.length + 1 });
    }
  }
  return out;
}

/** The fields of an older plain endurance set (no step kind) that a conversion reads. */
export type PlainEnduranceSet = {
  setNumber: number;
  durationSeconds: number | null;
  distanceMeters: number | null;
  targetHeartRateZone: number | null;
  sessionRole: string | null;
  setType?: string | null;
  peakDurationSeconds?: number | null;
  peakDistanceMeters?: number | null;
};

/**
 * Older plain endurance sets as a step tree (docs/plans/one-program-model.md,
 * step 4): each set becomes one step, a warm-up set a warm-up step, a work
 * rep or zone 4-5 a work step, zone 1 an easy step, the rest steady work. Its
 * zone becomes an HR zone target on LTHR (bike and run). A set ends on the
 * end its weekly-sync anchor scales (time or distance), else on its distance,
 * else on its time, else on the lap button. Rest after a set stays on the set.
 */
export function plainSetsToWorkout(sets: PlainEnduranceSet[], meta: { sport: WorkoutSport; name: string; poolLengthM?: number | null }): Workout {
  const steps: WorkoutStep[] = [...sets]
    .sort((a, b) => a.setNumber - b.setNumber)
    .map((s) => {
      const zone = s.targetHeartRateZone;
      const type: WorkoutStep["type"] = s.setType === "warmup" ? "warmup" : s.sessionRole === "work" || (zone ?? 0) >= 4 ? "work" : zone === 1 ? "recovery" : "work";
      const hasDistance = s.distanceMeters != null && s.distanceMeters > 0;
      const hasTime = s.durationSeconds != null && s.durationSeconds > 0;
      const onTime = hasTime && (!hasDistance || (s.peakDurationSeconds != null && s.peakDistanceMeters == null));
      const end: WorkoutStep["end"] = onTime
        ? { type: "time", seconds: s.durationSeconds! }
        : hasDistance
          ? { type: "distance", meters: s.distanceMeters! }
          : { type: "lap" };
      const target: WorkoutTarget | undefined = zone != null && meta.sport !== "swim" ? { metric: "hr", anchor: "lthr", zone } : undefined;
      return { type, end, ...(target && { target }) };
    });
  return { v: 2, sport: meta.sport, name: meta.name.trim().slice(0, 80) || "Session", ...(meta.poolLengthM != null && { poolLengthM: meta.poolLengthM }), steps: steps.length ? steps : [{ type: "work", end: { type: "lap" } }] };
}

/**
 * Plain bike sets as the step rows of the one-time move
 * (docs/plans/bike-ride-logger.md, D3): plainSetsToWorkout, and a rest after
 * a set becomes a rest step after it, because no step reader reads a step
 * row's own rest. The last set's rest is dropped. A time or distance under a
 * step's minimum (5 s, 10 m) is raised to it, a rest too. `from` is the setNumber of the plain set a row came from
 * (null on a rest step). The error is the schema check's first problems.
 */
export function plainSetsToStepRows(
  sets: (PlainEnduranceSet & { restTimeSeconds: number })[],
  meta: { sport: WorkoutSport; name: string },
): { rows: (StepFields & { setNumber: number; from: number | null })[] } | { error: string } {
  const { seconds, meters } = WORKOUT_LIMITS;
  const sorted = [...sets]
    .sort((a, b) => a.setNumber - b.setNumber)
    .map((s) => ({
      ...s,
      durationSeconds: s.durationSeconds != null && s.durationSeconds > 0 ? Math.max(seconds.min, s.durationSeconds) : s.durationSeconds,
      distanceMeters: s.distanceMeters != null && s.distanceMeters > 0 ? Math.max(meters.min, s.distanceMeters) : s.distanceMeters,
    }));
  const steps = plainSetsToWorkout(sorted, meta).steps;
  const nodes: WorkoutNode[] = [];
  const from: (number | null)[] = [];
  for (const [i, s] of sorted.entries()) {
    nodes.push(steps[i]);
    from.push(s.setNumber);
    if (i < sorted.length - 1 && s.restTimeSeconds > 0) {
      nodes.push({ type: "rest", end: { type: "time", seconds: Math.max(seconds.min, s.restTimeSeconds) } });
      from.push(null);
    }
  }
  const parsed = parseWorkout({ ...plainSetsToWorkout([], meta), steps: nodes });
  if (!parsed.ok) return { error: parsed.errors.slice(0, 3).map((e) => `${e.path} ${e.message}`).join("; ") };
  return { rows: workoutToRows(parsed.workout).map((r, i) => ({ ...r, from: from[i] })) };
}

/** Each structured exercise's play steps and planned rows, keys prefixed when there are several (one guided run, docs/plans/one-program-model.md). */
export type ProgramPlay = { pw: ProgramWorkout; play: PlayStep[]; rows: PlannedRow[] };

/** Each structured exercise's play steps and planned rows, keys prefixed when there are several. */
const SPORT_WORD = { swim: "Swim", bike: "Ride", run: "Run" } as const;

export function programPlay(all: ProgramWorkout[], anchors: ThresholdValues, units: Units = DEFAULT_UNITS): ProgramPlay[] {
  const multi = all.length > 1;
  const key = (e: number, k: string) => (multi ? `e${e + 1}:${k}` : k);
  // With more than one sport in the session (a brick), each step says which leg it is.
  const sports = new Set(all.map((p) => p.sport)).size > 1;
  return all.map((pw, e) => ({
    pw,
    play: flattenWorkout(pw.workout).map((p) => ({ ...p, key: key(e, p.key) })),
    rows: plannedRows(pw.workout, anchors, units).map((r) => ({ ...r, key: key(e, r.key), ...(sports && { text: `${SPORT_WORD[pw.sport]} · ${r.text}` }) })),
  }));
}

