"use client";

/**
 * The step editor of a swim, bike or run exercise (docs/plans/one-program-model.md,
 * step 4, plan pictures 1 and 3). The steps are edited as one tree here and
 * saved together; the server stores them as program sets.
 */

import { BottomSheet } from "@/components/ui/BottomSheet";
import { BackLink } from "@/components/ui/BackLink";
import { PlanSheetPanel } from "@/components/features/PlanSheetPanel";
import { saveExerciseSteps } from "@/lib/actions/program-steps";
import { formatSessionLength, loadText } from "@/lib/utils/format";
import { TEST_NAME, ftpTestWorkout } from "@/lib/utils/ftp-tests";
import { RUN_TEST_MODES, RUN_TEST_NAME, RUN_TEST_TEXT, runTestWorkout } from "@/lib/utils/run-test";
import { callAction } from "@/lib/utils/stale-bundle";
import { workoutPlannedLoad } from "@/lib/utils/step-results";
import type { Units } from "@/lib/utils/units";
import { isShortStep, stepTargetKey, workStepGaps, workStepMissing, workStepRuleText, workoutStepKeys } from "@/lib/utils/work-step-gaps";
import {
  SWIM_EQUIPMENT,
  SWIM_STROKES,
  RIDE_TESTS,
  estimateWorkout,
  parseWorkout,
  resolveStepTarget,
  resolveTarget,
  type ThresholdValues,
  type Workout,
  type WorkoutNode,
  type WorkoutRepeat,
  type WorkoutStep,
  type WorkoutTarget,
} from "@/lib/utils/workout-steps";
import { ChevronDown, ChevronUp, Minus, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type Sport = Workout["sport"];
type Kind = WorkoutStep["type"];
/** Where a step sits: a top-level node, or a step inside a repeat block. */
type At = { node: number; inner: number | null };

const KIND_WORD: Record<Kind, string> = { warmup: "Warm-up", work: "Work", recovery: "Easy", cooldown: "Cool-down", rest: "Rest" };
const KINDS: Kind[] = ["warmup", "work", "recovery", "cooldown", "rest"];
/** The FTP tests in a line each (docs/plans/bike-ride-logger.md, 4.9). */
const TEST_TEXT: Record<(typeof RIDE_TESTS)[number], string> = {
  ramp: "10 min warm-up, then 1 min steps up by 20 W until you cannot hold them · FTP is 75% of your best minute",
  "20min": "20 min warm-up with two hard efforts, 5 min easy, 20 min all-out, 10 min cool-down · FTP is 95% of the 20 min",
};
/** Pool lengths; open water has none. 25 yd is 22.86 m. */
const POOLS: { label: string; meters: number | undefined }[] = [
  { label: "25 m pool", meters: 25 },
  { label: "50 m pool", meters: 50 },
  { label: "25 yd pool", meters: 22.86 },
  { label: "Open water", meters: undefined },
];
const STROKE_WORD: Record<string, string> = { free: "Free", back: "Back", breast: "Breast", fly: "Fly", im: "IM", choice: "Choice", kick: "Kick", pull: "Pull", drill: "Drill" };
const EQUIPMENT_WORD: Record<string, string> = { pull_buoy: "Pull buoy", paddles: "Paddles", fins: "Fins", kickboard: "Kickboard", snorkel: "Snorkel" };

/** The target choices a sport has in the editor; the assistant can set any other. */
type TargetChoice = "none" | "pace" | "css" | "power" | "powerZone" | "hrZone" | "rpe";
const CHOICES: Record<Sport, { id: TargetChoice; label: string }[]> = {
  run: [
    { id: "none", label: "None" },
    { id: "pace", label: "Pace" },
    { id: "hrZone", label: "HR zone" },
    { id: "rpe", label: "Feel" },
  ],
  bike: [
    { id: "none", label: "None" },
    { id: "power", label: "Power" },
    { id: "powerZone", label: "Power zone" },
    { id: "hrZone", label: "HR zone" },
    { id: "rpe", label: "Feel" },
  ],
  swim: [
    { id: "none", label: "None" },
    { id: "css", label: "CSS pace" },
    { id: "rpe", label: "Feel" },
  ],
};

function choiceOf(t: WorkoutTarget | undefined): TargetChoice {
  if (!t) return "none";
  if (t.metric === "rpe") return "rpe";
  if (t.metric === "power") return t.zone !== undefined ? "powerZone" : "power";
  if (t.metric === "hr" && t.zone !== undefined) return "hrZone";
  if (t.metric === "pace") return t.anchor === "css" ? "css" : "pace";
  return "none";
}

function defaultTarget(c: TargetChoice): WorkoutTarget | undefined {
  switch (c) {
    case "pace":
      return { metric: "pace", anchor: "threshold_pace", low: 95, high: 100 };
    case "css":
      return { metric: "pace", anchor: "css", offsetLow: 2, offsetHigh: 4 };
    case "power":
      return { metric: "power", anchor: "ftp", low: 88, high: 93 };
    case "powerZone":
      return { metric: "power", anchor: "ftp", zone: 2 };
    case "hrZone":
      return { metric: "hr", anchor: "lthr", zone: 2 };
    case "rpe":
      return { metric: "rpe", anchor: "absolute", low: 5, high: 6 };
    default:
      return undefined;
  }
}

const stepAt = (w: Workout, at: At): WorkoutStep => {
  const n = w.steps[at.node];
  return n.type === "repeat" ? n.steps[at.inner!] : n;
};

function withStep(w: Workout, at: At, step: WorkoutStep | null): Workout {
  const steps = w.steps.flatMap((n, i): WorkoutNode[] => {
    if (i !== at.node) return [n];
    if (at.inner == null || n.type !== "repeat") return step ? [step] : [];
    const inner = n.steps.flatMap((s, j) => (j !== at.inner ? [s] : step ? [step] : []));
    return inner.length ? [{ ...n, steps: inner }] : [];
  });
  return { ...w, steps };
}

function move(w: Workout, i: number, by: -1 | 1): Workout {
  const j = i + by;
  if (j < 0 || j >= w.steps.length) return w;
  const steps = [...w.steps];
  [steps[i], steps[j]] = [steps[j], steps[i]];
  return { ...w, steps };
}

/** A tree's node without its ids, so a new step never repeats an id. */
const fresh = <T extends object>(n: T): T => {
  const { id: _id, ...rest } = n as T & { id?: string };
  void _id;
  return rest as T;
};

export function StepsEditor({
  programId,
  programExerciseId,
  exerciseName,
  initial,
  converted,
  dayOnly = false,
  unsaved = converted,
  thresholds,
  units,
}: {
  programId: number;
  programExerciseId: number;
  exerciseName: string;
  initial: Workout;
  /** The exercise held plain sets: this tree is their conversion and is not saved yet. */
  converted: boolean;
  /** A one-day copy of a program (docs/plans/one-program-model.md, decision 2). */
  dayOnly?: boolean;
  /** Nothing is stored yet (converted plain sets, or a new exercise): Save is on from the start. */
  unsaved?: boolean;
  thresholds: ThresholdValues;
  units: Units;
}) {
  const router = useRouter();
  const [workout, setWorkout] = useState<Workout>(initial);
  const [dirty, setDirty] = useState(unsaved);
  const [editing, setEditing] = useState<At | null>(null);
  const [testSheet, setTestSheet] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The steps the server holds: the strict work step check leaves them as they
  // are (docs/plans/strict-targets.md, decision 3). A new exercise holds none.
  const [known, setKnown] = useState<ReadonlySet<string>>(() => (unsaved && !converted ? new Set() : workoutStepKeys(initial)));
  const sport = workout.sport;

  const change = (w: Workout) => {
    setWorkout(w);
    setDirty(true);
    setError(null);
  };

  const check = useMemo(() => parseWorkout(workout), [workout]);
  const gap = useMemo(() => {
    const first = check.ok ? workStepGaps(check.workout, known)[0] : undefined;
    return first ? `Step ${first.number} · ${workStepRuleText(sport, first.short)}` : null;
  }, [check, known, sport]);
  const totals = useMemo(() => {
    if (!check.ok) return null;
    const est = estimateWorkout(check.workout, thresholds);
    const load = workoutPlannedLoad(check.workout, thresholds);
    const parts: string[] = [];
    if (est.durationSeconds > 0) parts.push(`${est.durationComplete ? "" : "at least "}${formatSessionLength(est.durationSeconds)}`);
    if (est.distanceMeters > 0) parts.push(`${est.distanceComplete ? "" : "at least "}${distanceText(est.distanceMeters, sport, units)}`);
    if (load.load > 0) parts.push(loadText(load));
    return parts.join(" · ");
  }, [check, thresholds, sport, units]);

  async function save() {
    if (!check.ok) {
      setError(check.errors.slice(0, 2).map((e) => e.message).join(". "));
      return;
    }
    if (gap) {
      setError(gap);
      return;
    }
    setSaving(true);
    const r = await callAction(saveExerciseSteps({ programExerciseId, workout: check.workout }));
    setSaving(false);
    if (!r.success) {
      setError(r.error);
      return;
    }
    setDirty(false);
    setKnown(workoutStepKeys(check.workout));
    router.refresh();
  }

  const addStep = () => {
    const step: WorkoutStep = { type: "work", end: sport === "swim" ? { type: "distance", meters: 100 } : { type: "time", seconds: 600 } };
    const w = { ...workout, steps: [...workout.steps, step] };
    change(w);
    setEditing({ node: w.steps.length - 1, inner: null });
  };
  const addBlock = () => {
    const work: WorkoutStep = sport === "swim" ? { type: "work", end: { type: "distance", meters: 100 } } : { type: "work", end: { type: "time", seconds: 180 } };
    const easy: WorkoutStep = sport === "swim" ? { type: "rest", end: { type: "time", seconds: 15 } } : { type: "recovery", end: { type: "time", seconds: 120 } };
    // Before a closing cool-down, where a main set goes.
    const at = workout.steps.at(-1)?.type === "cooldown" ? workout.steps.length - 1 : workout.steps.length;
    change({ ...workout, steps: [...workout.steps.slice(0, at), { type: "repeat", count: 4, steps: [work, easy] }, ...workout.steps.slice(at)] });
  };

  const editingStep = editing ? stepAt(workout, editing) : null;
  const inBlock = editing?.inner != null;

  return (
    <div className="h-[100dvh] pb-nav-safe bg-background flex flex-col overflow-y-auto" data-testid="steps-editor">
      <div className="flex items-center px-4 pt-6 pb-2 shrink-0">
        <BackLink fallback={{ href: `/programs/${programId}`, label: "Program" }} />
      </div>
      <div className="px-4 pt-2 pb-3">
        <h1 className="text-3xl font-bold tracking-tight">{exerciseName}</h1>
        {totals && (
          <p className="text-sm text-muted-foreground mt-1 tabular-nums" data-testid="steps-totals">
            {totals}
          </p>
        )}
        {sport === "swim" && (
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Pool">
            {POOLS.map((p) => (
              <button
                key={p.label}
                type="button"
                aria-pressed={workout.poolLengthM === p.meters}
                onClick={() => {
                  const { poolLengthM: _old, ...rest } = workout;
                  void _old;
                  change(p.meters === undefined ? rest : { ...rest, poolLengthM: p.meters });
                }}
                className={chip(workout.poolLengthM === p.meters)}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
        {dayOnly && (
          <p className="mt-3 rounded-xl bg-primary/10 px-3 py-2 text-sm" data-testid="steps-day-only">
            These steps are for one day only. The program and its other days stay as they are.
          </p>
        )}
        {converted && (
          <p className="mt-3 rounded-xl bg-amber-500/10 px-3 py-2 text-sm" data-testid="steps-converted">
            These were plain sets. Save to keep them as steps.
          </p>
        )}
      </div>

      <ol className="px-4 flex flex-col gap-2">
        {workout.steps.map((n, i) => (
          <li key={i} className="flex items-stretch gap-2">
            <div className="flex-1 min-w-0">
              {n.type === "repeat" ? (
                <BlockCard
                  block={n}
                  sport={sport}
                  units={units}
                  thresholds={thresholds}
                  onRounds={(count) => change({ ...workout, steps: workout.steps.map((x, k) => (k === i ? { ...(x as WorkoutRepeat), count } : x)) })}
                  onOpen={(j) => setEditing({ node: i, inner: j })}
                  onAdd={() => {
                    const w = { ...workout, steps: workout.steps.map((x, k) => (k === i ? { ...(x as WorkoutRepeat), steps: [...(x as WorkoutRepeat).steps, fresh((x as WorkoutRepeat).steps.at(-1)!)] } : x)) };
                    change(w);
                    setEditing({ node: i, inner: (w.steps[i] as WorkoutRepeat).steps.length - 1 });
                  }}
                  onDelete={() => change({ ...workout, steps: workout.steps.filter((_, k) => k !== i) })}
                />
              ) : (
                <StepButton step={n} sport={sport} units={units} thresholds={thresholds} onOpen={() => setEditing({ node: i, inner: null })} />
              )}
            </div>
            <div className="flex flex-col justify-center gap-1">
              <button type="button" aria-label={`Move step ${i + 1} up`} disabled={i === 0} onClick={() => change(move(workout, i, -1))} className="h-11 w-11 rounded-full bg-muted flex items-center justify-center disabled:opacity-30 active:opacity-70">
                <ChevronUp className="h-5 w-5" aria-hidden />
              </button>
              <button type="button" aria-label={`Move step ${i + 1} down`} disabled={i === workout.steps.length - 1} onClick={() => change(move(workout, i, 1))} className="h-11 w-11 rounded-full bg-muted flex items-center justify-center disabled:opacity-30 active:opacity-70">
                <ChevronDown className="h-5 w-5" aria-hidden />
              </button>
            </div>
          </li>
        ))}
      </ol>

      <div className="px-4 pt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={addStep} className="min-h-11 rounded-2xl border border-border px-3 text-sm font-medium active:opacity-70">
          Add step
        </button>
        <button type="button" onClick={addBlock} className="min-h-11 rounded-2xl border border-border px-3 text-sm font-medium active:opacity-70">
          Add repeat block
        </button>
        {sport === "bike" && (
          <button type="button" onClick={() => setTestSheet(true)} className="col-span-2 min-h-11 rounded-2xl border border-border px-3 text-sm font-medium active:opacity-70">
            Insert FTP test
          </button>
        )}
        {sport === "run" && (
          <button type="button" onClick={() => setTestSheet(true)} className="col-span-2 min-h-11 rounded-2xl border border-border px-3 text-sm font-medium active:opacity-70">
            Insert run test
          </button>
        )}
      </div>

      <div className="mt-auto px-4 pt-4 pb-6 flex flex-col gap-2">
        {(error || !check.ok || gap) && (
          <p role="alert" className="text-sm text-destructive" data-testid="steps-error">
            {error ?? (!check.ok ? check.errors[0].message : gap)}
          </p>
        )}
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className={`min-h-12 rounded-2xl px-4 py-3 text-base font-semibold active:opacity-80 ${dirty ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
        >
          {saving ? "Saving" : dirty ? "Save steps" : "Saved"}
        </button>
      </div>

      <BottomSheet open={testSheet && sport === "run"} onClose={() => setTestSheet(false)}>
        <PlanSheetPanel label="Insert run test" title="Insert run test" sub={<p className="text-sm text-muted-foreground">The test takes the place of these steps. Nothing changes until you save.</p>} testId="run-test-sheet">
          {RUN_TEST_MODES.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                change(runTestWorkout(m, workout.name));
                setTestSheet(false);
              }}
              className="min-h-12 rounded-2xl bg-widget-2 px-4 py-2.5 text-left active:opacity-70"
            >
              <span className="block text-base font-semibold">{RUN_TEST_NAME[m]}</span>
              <span className="block text-xs text-muted-foreground">{RUN_TEST_TEXT[m]}</span>
            </button>
          ))}
        </PlanSheetPanel>
      </BottomSheet>

      <BottomSheet open={testSheet && sport === "bike"} onClose={() => setTestSheet(false)}>
        <PlanSheetPanel label="Insert FTP test" title="Insert FTP test" sub={<p className="text-sm text-muted-foreground">The test takes the place of these steps. Nothing changes until you save.</p>} testId="ftp-test-sheet">
          {RIDE_TESTS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                change(ftpTestWorkout(t, workout.name));
                setTestSheet(false);
              }}
              className="min-h-12 rounded-2xl bg-widget-2 px-4 py-2.5 text-left active:opacity-70"
            >
              <span className="block text-base font-semibold">{TEST_NAME[t]}</span>
              <span className="block text-xs text-muted-foreground">{TEST_TEXT[t]}</span>
            </button>
          ))}
        </PlanSheetPanel>
      </BottomSheet>

      <BottomSheet open={editingStep != null} onClose={() => setEditing(null)}>
        {editing && editingStep && (
          <StepSheet
            key={`${editing.node}-${editing.inner}`}
            step={editingStep}
            sport={sport}
            units={units}
            thresholds={thresholds}
            inBlock={inBlock}
            test={workout.test}
            known={known}
            onDone={(s) => {
              change(withStep(workout, editing, s));
              setEditing(null);
            }}
            onDelete={() => {
              change(withStep(workout, editing, null));
              setEditing(null);
            }}
          />
        )}
      </BottomSheet>
    </div>
  );
}

function distanceText(meters: number, sport: Sport, units: Units): string {
  if (sport === "swim") return units.swim === "yd" ? `${Math.round(meters / 0.9144)} yd` : `${Math.round(meters)} m`;
  if (units.distance === "mi") return `${(meters / 1609.344).toFixed(1)} mi`;
  return meters < 1000 ? `${Math.round(meters)} m` : `${+(meters / 1000).toFixed(2)} km`;
}

function endText(step: WorkoutStep, sport: Sport, units: Units): string {
  if (step.end.type === "lap") return "Until lap";
  if (step.end.type === "distance") return distanceText(step.end.meters, sport, units);
  const s = step.end.seconds;
  if (s < 60) return `${s} s`;
  return s % 60 === 0 ? `${s / 60} min` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

function targetText(step: WorkoutStep, sport: Sport, thresholds: ThresholdValues, units: Units): string | null {
  const parts = [resolveStepTarget(step, sport, thresholds, units)?.text, step.target2 && resolveTarget(step.target2, sport, thresholds, units).text].filter((t): t is string => !!t);
  return parts.length ? parts.join(" · ") : null;
}

function StepButton({ step, sport, units, thresholds, onOpen }: { step: WorkoutStep; sport: Sport; units: Units; thresholds: ThresholdValues; onOpen: () => void }) {
  const target = targetText(step, sport, thresholds, units);
  const extras = [step.cadence ? `${step.cadence.low}-${step.cadence.high} ${sport === "run" ? "spm" : "rpm"}` : null, step.stroke && step.stroke !== "free" ? STROKE_WORD[step.stroke] : null, step.equipment?.map((e) => EQUIPMENT_WORD[e]).join(", "), step.note].filter(Boolean).join(" · ");
  return (
    <button type="button" onClick={onOpen} className="w-full min-h-14 rounded-xl bg-muted px-3 py-2 text-left active:opacity-70" data-testid="step-row">
      <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{KIND_WORD[step.type]}</span>
      <span className="flex items-center gap-2 flex-wrap">
        <span className="text-base font-medium">{endText(step, sport, units)}</span>
        {target && <span className="text-[11px] font-semibold tabular-nums rounded px-1.5 py-0.5 bg-primary/10 text-primary">{target}</span>}
      </span>
      {extras && <span className="block text-xs text-muted-foreground">{extras}</span>}
    </button>
  );
}

function BlockCard({
  block,
  sport,
  units,
  thresholds,
  onRounds,
  onOpen,
  onAdd,
  onDelete,
}: {
  block: WorkoutRepeat;
  sport: Sport;
  units: Units;
  thresholds: ThresholdValues;
  onRounds: (n: number) => void;
  onOpen: (inner: number) => void;
  onAdd: () => void;
  onDelete: () => void;
}) {
  const sendOff = block.steps.find((s) => s.sendOffSeconds !== undefined)?.sendOffSeconds;
  return (
    <div className="rounded-2xl border border-border p-2 flex flex-col gap-1.5" data-testid="step-block">
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="text-base font-semibold tabular-nums" data-testid="block-rounds">
          {block.count} ×{sendOff ? <span className="text-sm font-normal text-muted-foreground">{` on ${Math.floor(sendOff / 60)}:${String(sendOff % 60).padStart(2, "0")}`}</span> : null}
        </span>
        <span className="flex items-center gap-1">
          <button type="button" aria-label="One round less" disabled={block.count <= 2} onClick={() => onRounds(block.count - 1)} className="h-11 w-11 rounded-full bg-muted flex items-center justify-center disabled:opacity-30 active:opacity-70">
            <Minus className="h-4 w-4" aria-hidden />
          </button>
          <button type="button" aria-label="One round more" disabled={block.count >= 50} onClick={() => onRounds(block.count + 1)} className="h-11 w-11 rounded-full bg-muted flex items-center justify-center disabled:opacity-30 active:opacity-70">
            <Plus className="h-4 w-4" aria-hidden />
          </button>
        </span>
      </div>
      {block.steps.map((s, j) => (
        <StepButton key={j} step={s} sport={sport} units={units} thresholds={thresholds} onOpen={() => onOpen(j)} />
      ))}
      <div className="grid grid-cols-2 gap-2 pt-1">
        <button type="button" onClick={onAdd} disabled={block.steps.length >= 10} className="min-h-11 rounded-xl text-sm font-medium text-primary active:opacity-70 disabled:opacity-30">
          Add step to block
        </button>
        <button type="button" onClick={onDelete} className="min-h-11 rounded-xl text-sm font-medium text-destructive active:opacity-70">
          Delete block
        </button>
      </div>
    </div>
  );
}

const chip = (on: boolean) => `min-h-11 rounded-full px-3.5 text-sm font-medium active:opacity-70 ${on ? "bg-primary text-primary-foreground" : "bg-muted"}`;
const input = "h-11 w-full rounded-xl border border-border bg-background px-3 text-base text-foreground tabular-nums";

function StepSheet({
  step,
  sport,
  units,
  thresholds,
  inBlock,
  test,
  known,
  onDone,
  onDelete,
}: {
  step: WorkoutStep;
  sport: Sport;
  units: Units;
  thresholds: ThresholdValues;
  inBlock: boolean;
  test: Workout["test"];
  /** The steps the server holds, which keep their targets as they are. */
  known: ReadonlySet<string>;
  onDone: (s: WorkoutStep) => void;
  onDelete: () => void;
}) {
  const [s, setS] = useState<WorkoutStep>(step);
  // A ramp or a free spin (written by the assistant) is none of the choices.
  const choice = s.ramp || s.free ? null : choiceOf(s.target);
  const yards = sport === "swim" && units.swim === "yd";
  const miles = sport !== "swim" && units.distance === "mi";
  const distUnit = sport === "swim" ? (yards ? "yd" : "m") : miles ? "mi" : "km";
  const toMeters = (v: number) => (sport === "swim" ? (yards ? v * 0.9144 : v) : miles ? v * 1609.344 : v * 1000);
  const fromMeters = (m: number) => (sport === "swim" ? (yards ? Math.round(m / 0.9144) : Math.round(m)) : miles ? +(m / 1609.344).toFixed(2) : +(m / 1000).toFixed(2));
  const set = (patch: Partial<WorkoutStep>) => setS((x) => ({ ...x, ...patch }));
  const target = resolveStepTarget(s, sport, thresholds, units);
  const one = parseWorkout({ v: 2, sport, name: "Step", steps: inBlock ? [{ type: "repeat", count: 2, steps: [s] }] : [s] });
  const problem = one.ok ? null : plainProblem(one.errors[0]);
  // A bike or run work step names a target for inside and outside (docs/plans/strict-targets.md, decision 2).
  const missing = workStepMissing(s, sport, test);
  const blocked = missing.length > 0 && !known.has(stepTargetKey(s));
  // Heart rate as the second target, when the main one is not heart rate (and a second one is not another metric).
  const hrField = sport !== "swim" && s.target && s.target.metric !== "hr" && (s.target2 === undefined || s.target2.metric === "hr") && (s.type === "work" || s.target2 !== undefined);

  return (
    <PlanSheetPanel
      label="Edit step"
      title={KIND_WORD[s.type]}
      testId="step-sheet"
      footer={
        <>
          <button type="button" onClick={() => onDone(s)} disabled={!!problem || blocked} className="min-h-12 rounded-2xl bg-primary px-4 py-3 text-base font-semibold text-primary-foreground active:opacity-80 disabled:opacity-40">
            Done
          </button>
          <button type="button" onClick={onDelete} className="min-h-11 text-[15px] font-medium text-destructive active:opacity-70">
            Delete step
          </button>
        </>
      }
    >
      <fieldset className="flex flex-wrap gap-2">
        <legend className="sr-only">Kind</legend>
        {KINDS.map((k) => (
          <button key={k} type="button" aria-pressed={s.type === k} onClick={() => set({ type: k })} className={chip(s.type === k)}>
            {KIND_WORD[k]}
          </button>
        ))}
      </fieldset>

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Ends after</h3>
        <div className="flex gap-2">
          {(["time", "distance", "lap"] as const).map((e) => (
            <button
              key={e}
              type="button"
              aria-pressed={s.end.type === e}
              onClick={() => set({ end: e === "time" ? { type: "time", seconds: s.end.type === "time" ? s.end.seconds : 300 } : e === "distance" ? { type: "distance", meters: s.end.type === "distance" ? s.end.meters : sport === "swim" ? 100 : 1000 } : { type: "lap" } })}
              className={chip(s.end.type === e)}
            >
              {e === "time" ? "Time" : e === "distance" ? "Distance" : "Lap button"}
            </button>
          ))}
        </div>
        {s.end.type === "time" && (
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Minutes
              <input aria-label="Minutes" inputMode="numeric" className={input} value={Math.floor(s.end.seconds / 60)} onChange={(ev) => set({ end: { type: "time", seconds: Math.max(0, Number(ev.target.value) || 0) * 60 + ((s.end as { seconds: number }).seconds % 60) } })} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Seconds
              <input aria-label="Seconds" inputMode="numeric" className={input} value={s.end.seconds % 60} onChange={(ev) => set({ end: { type: "time", seconds: Math.floor((s.end as { seconds: number }).seconds / 60) * 60 + Math.min(59, Math.max(0, Number(ev.target.value) || 0)) } })} />
            </label>
          </div>
        )}
        {s.end.type === "distance" && (
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Distance in {distUnit}
            <input aria-label={`Distance in ${distUnit}`} inputMode="decimal" className={input} defaultValue={fromMeters(s.end.meters)} onChange={(ev) => set({ end: { type: "distance", meters: toMeters(Number(ev.target.value.replace(",", ".")) || 0) } })} />
          </label>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Target</h3>
        <div className="flex flex-wrap gap-2">
          {CHOICES[sport].map((c) => (
            <button key={c.id} type="button" aria-pressed={choice === c.id} onClick={() => set({ target: defaultTarget(c.id), ramp: undefined, free: undefined, ...((c.id === "none" || (c.id === "hrZone" && s.target2?.metric === "hr")) && { target2: undefined }) })} className={chip(choice === c.id)}>
              {c.label}
            </button>
          ))}
        </div>
        {s.target && <TargetFields target={s.target} onChange={(t) => set({ target: t })} />}
        {target && (
          <p className="text-sm font-semibold tabular-nums" data-testid="step-target-preview">
            {target.text}
          </p>
        )}
      </section>

      {hrField && (
        <section className="flex flex-col gap-2" data-testid="step-hr">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Heart rate</h3>
          <div className="flex flex-wrap gap-2">
            <button type="button" aria-pressed={!s.target2} aria-label="No heart rate" onClick={() => set({ target2: undefined })} className={chip(!s.target2)}>
              None
            </button>
            <button type="button" aria-pressed={!!s.target2} aria-label="Heart rate zone" onClick={() => set({ target2: s.target2 ?? defaultTarget("hrZone") })} className={chip(!!s.target2)}>
              HR zone
            </button>
          </div>
          {s.target2 && <TargetFields target={s.target2} onChange={(t) => set({ target2: t })} />}
        </section>
      )}

      {sport === "run" && (
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Belt in km/h
          <input aria-label="Belt in km/h" inputMode="decimal" className={input} defaultValue={s.belt ?? ""} onChange={(ev) => set({ belt: ev.target.value.trim() ? Number(ev.target.value.replace(",", ".")) || 0 : undefined })} />
        </label>
      )}

      {sport !== "swim" && (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{sport === "run" ? "Cadence in steps per minute" : "Cadence in rpm"}</h3>
          <div className="grid grid-cols-2 gap-2">
            <input aria-label="Cadence from" inputMode="numeric" placeholder="From" className={input} value={s.cadence?.low ?? ""} onChange={(ev) => set({ cadence: ev.target.value ? { low: Number(ev.target.value) || 0, high: s.cadence?.high ?? Number(ev.target.value) } : undefined })} />
            <input aria-label="Cadence to" inputMode="numeric" placeholder="To" className={input} value={s.cadence?.high ?? ""} onChange={(ev) => set({ cadence: s.cadence || ev.target.value ? { low: s.cadence?.low ?? Number(ev.target.value), high: Number(ev.target.value) || 0 } : undefined })} />
          </div>
        </section>
      )}

      {sport === "swim" && (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Stroke</h3>
          <div className="flex flex-wrap gap-2">
            {SWIM_STROKES.map((k) => (
              <button key={k} type="button" aria-pressed={s.stroke === k} onClick={() => set({ stroke: s.stroke === k ? undefined : k })} className={chip(s.stroke === k)}>
                {STROKE_WORD[k]}
              </button>
            ))}
          </div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pt-1">Equipment</h3>
          <div className="flex flex-wrap gap-2">
            {SWIM_EQUIPMENT.map((k) => {
              const on = s.equipment?.includes(k) ?? false;
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    const next = on ? (s.equipment ?? []).filter((x) => x !== k) : [...(s.equipment ?? []), k];
                    set({ equipment: next.length ? next : undefined });
                  }}
                  className={chip(on)}
                >
                  {EQUIPMENT_WORD[k]}
                </button>
              );
            })}
          </div>
          {inBlock && s.type === "work" && (
            <label className="flex flex-col gap-1 text-xs text-muted-foreground pt-1">
              Send-off in seconds (the rest is in it)
              <input aria-label="Send-off in seconds" inputMode="numeric" className={input} value={s.sendOffSeconds ?? ""} onChange={(ev) => set({ sendOffSeconds: ev.target.value ? Number(ev.target.value) || 0 : undefined })} />
            </label>
          )}
        </section>
      )}

      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Note
        <input aria-label="Note" maxLength={140} className={input} value={s.note ?? ""} onChange={(ev) => set({ note: ev.target.value.trim() ? ev.target.value : undefined })} />
      </label>

      {(problem || blocked) && (
        <p role="alert" className="text-sm text-destructive" data-testid="step-problem">
          {problem ?? workStepRuleText(sport, isShortStep(s))}
        </p>
      )}
      {/* An old step the server already holds takes edits; what it lacks is a hint, not an error. */}
      {!problem && !blocked && missing.length > 0 && (
        <p className="text-sm text-muted-foreground" data-testid="step-hint">
          {workStepRuleText(sport, isShortStep(s))}
        </p>
      )}
    </PlanSheetPanel>
  );
}

/** The schema's words for one problem, as the sheet says them. */
function plainProblem(e: { path: string; message: string }): string {
  if (e.path.endsWith("end.meters")) return "The distance is too short";
  if (e.path.endsWith("end.seconds")) return "The time must be at least 5 seconds";
  if (/must be at most (high|offsetHigh)/.test(e.message)) return "The target's From must be at most its To";
  if (e.path.includes("cadence")) return "Give the cadence as a range from low to high";
  if (e.path.endsWith("belt")) return "The belt speed must be 1 to 25 km/h with at most one decimal";
  if (e.path.includes("sendOffSeconds")) return e.message.startsWith("Too") ? "The send-off must be 20 to 600 seconds" : `The send-off is ${e.message}`;
  if (e.path.includes("target") && /^must be /.test(e.message)) return `The target ${e.message}`;
  if (/^Too (small|big)/.test(e.message)) return "A number is out of range";
  return e.message;
}

function TargetFields({ target, onChange }: { target: WorkoutTarget; onChange: (t: WorkoutTarget) => void }) {
  if (target.zone !== undefined) {
    return (
      <div className="flex flex-wrap gap-2">
        {[1, 2, 3, 4, 5].map((z) => (
          <button key={z} type="button" aria-pressed={target.zone === z} onClick={() => onChange({ ...target, zone: z })} className={chip(target.zone === z)}>
            Z{z}
          </button>
        ))}
      </div>
    );
  }
  const offset = target.offsetLow !== undefined;
  const lowKey = offset ? "offsetLow" : "low";
  const highKey = offset ? "offsetHigh" : "high";
  const unit = offset ? "s per 100 m over CSS" : target.metric === "rpe" ? "of 10" : "% of threshold";
  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        From ({unit})
        <input aria-label="Target from" inputMode="decimal" className={input} value={target[lowKey] ?? ""} onChange={(ev) => onChange({ ...target, [lowKey]: Number(ev.target.value) || 0 })} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        To ({unit})
        <input aria-label="Target to" inputMode="decimal" className={input} value={target[highKey] ?? ""} onChange={(ev) => onChange({ ...target, [highKey]: Number(ev.target.value) || 0 })} />
      </label>
    </div>
  );
}

