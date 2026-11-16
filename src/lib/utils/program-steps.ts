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
import {
  parseWorkout,
  type Workout,
  type WorkoutNode,
  type WorkoutSport,
  type WorkoutStep,
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

/** One row as a tree step. Problems with the end are returned, not thrown. */
function rowStep(r: StepRow): { step: WorkoutStep } | { problem: string } {
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
  };
  if ((r.cadenceLow == null) !== (r.cadenceHigh == null)) return { problem: "give both cadence bounds" };
  return { step };
}

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
  meta: { sport: WorkoutSport; name: string; poolLengthM?: number | null; description?: string | null },
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
      const s = rowStep(r);
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
      const s = rowStep(x);
      if ("problem" in s) problems.push({ setNumber: x.setNumber, message: s.problem });
      else firstSteps.push(s.step);
    }
    for (const [n, list] of rounds) {
      if (n === 1) continue;
      const same = list.length === first.length && list.every((x, k) => {
        const s = rowStep(x);
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
      v: 1,
      sport: meta.sport,
      name: meta.name.trim().slice(0, 80) || "Session",
      ...(meta.description ? { description: meta.description.slice(0, 1000) } : {}),
      ...(meta.poolLengthM != null ? { poolLengthM: meta.poolLengthM } : {}),
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
  meta: { sport: WorkoutSport | null; name: string; poolLengthM?: number | null },
): StepProblem[] {
  const steps = rows.filter(isStepRow);
  if (steps.length === 0) return [];
  if (!meta.sport) return [{ setNumber: steps[0].setNumber, message: "only a swim, bike or run exercise can hold steps" }];
  if (steps.length !== rows.length) {
    const plain = rows.find((r) => !isStepRow(r))!;
    return [{ setNumber: plain.setNumber, message: "every set of a structured exercise needs a step kind" }];
  }
  const built = buildWorkout(steps, { sport: meta.sport, name: meta.name, poolLengthM: meta.poolLengthM });
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
