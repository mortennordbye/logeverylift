"use client";

/**
 * Run mode inside the run exercise (docs/plans/run-logger.md, 4.3 to 4.7 and
 * section 5 "Run mode"). The bike's parts run it: `useRide` keeps the clock,
 * the queue and the saves, and the hold to skip, the undo toast and the
 * landscape grid are ride mode's.
 *
 * On a treadmill the belt is the pace: a big − and + around the belt, the
 * incline under it, a 5 s "Step on" count before the clock runs, and a cue
 * 10 s before a step whose belt differs. Taps within 2 s send one event with
 * the last value (4.4). Outdoors the target of 4.2 is big, Lap ends a step,
 * and the controls lock 10 s after the last tap (4.6). A strides block shows
 * its round and a dot per rep; hold to skip skips the rest of it (4.5). Each
 * step saves when it ends, with its belt meters on a treadmill (4.7). When
 * the run ends, the workout is finished (a program of this exercise only)
 * and the results table opens.
 */

import { BTN, HoldToSkip, UNDO_MS, useLandscape } from "@/components/features/bike/RideMode";
import { useRide, type RideTap } from "@/components/features/bike/useRide";
import { usePendingQueue, useWorkoutSetWriter } from "@/contexts/pending-queue-context";
import { useWorkoutSession } from "@/contexts/workout-session-context";
import type { RideView } from "@/lib/actions/rides";
import { completeWorkoutSession } from "@/lib/actions/workout-sessions";
import { playCue } from "@/lib/audio-cues";
import { pausedSince, pausedText, stepLogPayload } from "@/lib/utils/ride-screen";
import { BELT_RANGE, EXTEND_STEP_S, INCLINE_RANGE, type RideStepResult } from "@/lib/utils/ride-timeline";
import { beltPace, beltResults, beltToastText, resumeBeltText, runKeptText, runScreen, stepOnText, type RunScreen } from "@/lib/utils/run-screen";
import { RUN_MODE_NAME } from "@/lib/utils/run-view";
import { callAction, failedInTransit } from "@/lib/utils/stale-bundle";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

/** Taps within this long send one event with the last value (4.4). */
export const BURST_MS = 2_000;
/** Outdoors the controls lock this long after the last tap (4.6). */
export const LOCK_AFTER_MS = 10_000;
/** One tap moves the belt 0.5 km/h and the incline 0.5%, in tenths. */
const BELT_STEP = 5;
const INCLINE_STEP = 5;
/** A belt set by feel starts from this when the runner first taps it (tenths). */
const FEEL_BELT = 80;

type Knob = "belt" | "incline";
type Burst = { kind: Knob; from: number | null; value: number; at: number; index: number; timer: ReturnType<typeof setTimeout> };
type Toast = { id: number; text: string; index: number; undo: RideTap | Knob | null; from?: number | null };

/** Controls used while running are 64 px or more (section 5). */
const RUN_BTN = `${BTN} min-h-16`;
/** The belt's − and +: big glyphs, 64 px square. */
const BELT_BTN = "h-16 min-h-16 rounded-2xl bg-background text-4xl font-semibold leading-none active:opacity-70 select-none touch-manipulation";

function Dots({ block }: { block: NonNullable<RunScreen["block"]> }) {
  return (
    <div className="flex justify-center gap-2" role="img" aria-label={`Stride ${block.index} of ${block.of}, ${block.done} done`} data-testid="run-dots">
      {Array.from({ length: block.of }, (_, i) => (
        <span key={i} className={`h-2.5 w-2.5 rounded-full ${i < block.done ? "bg-foreground" : i === block.index - 1 ? "bg-brand" : "bg-muted"}`} />
      ))}
    </div>
  );
}

function Second({ s, belt }: { s: RunScreen; belt?: number | null }) {
  // On a treadmill the pace follows the belt on screen, a burst still open included.
  const second = belt != null ? s.second.map((x) => (x.label === "Pace" ? { ...x, value: beltPace(belt) ?? x.value } : x)) : s.second;
  if (!second.length) return null;
  return (
    <p className="flex flex-wrap justify-center gap-x-4 text-base tabular-nums" data-testid="run-second">
      {second.map((x) => (
        <span key={x.label + x.value}>
          {x.label && <span className={x.value ? "text-muted-foreground" : ""}>{x.label}</span>}
          {x.value && ` ${x.value}`}
        </span>
      ))}
    </p>
  );
}

export function RunMode({
  exerciseId,
  initial,
  setNumbers,
  onlyExercise,
  sessionCompleted,
  workoutHref,
  brick,
}: {
  exerciseId: number;
  initial: RideView;
  /** The set number of each program set, for `logWorkoutSet`. */
  setNumbers: Record<number, number>;
  /** The program holds this exercise only: the end of the run finishes the workout. */
  onlyExercise: boolean;
  sessionCompleted: boolean;
  /** Where Later goes while the run's taps wait on this phone. */
  workoutHref: string;
  /** The run follows a ride in a brick: its first 10 min run on effort (4.2). */
  brick: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const workoutSession = useWorkoutSession();
  const { logWithRetry, unlogWithRetry } = useWorkoutSetWriter();
  const { enqueue } = usePendingQueue();
  const landscape = useLandscape();
  const treadmill = initial.plan.mode === "indoor";

  const saveStep = useCallback(
    (r: RideStepResult) => {
      const belt = treadmill ? beltResults(r) : {};
      const payload = {
        ...stepLogPayload(r, { sessionId: initial.ride.sessionId, exerciseId, setNumber: setNumbers[r.programSetId] ?? 1 }),
        ...belt,
        sources: {
          durationSeconds: "clock" as const,
          ...(belt.distanceMeters !== undefined && { distanceMeters: "belt" as const }),
          ...(belt.avgSpeed != null && { avgSpeed: "belt" as const }),
        },
      };
      // Run mode says "Saved on this phone" itself: no offline toast on top of it.
      void logWithRetry(payload, { quietOffline: true });
    },
    [logWithRetry, initial.ride.sessionId, exerciseId, setNumbers, treadmill],
  );
  const unsaveStep = useCallback(
    (programSetId: number) => {
      void unlogWithRetry({ sessionId: initial.ride.sessionId, exerciseId, setNumber: setNumbers[programSetId] ?? 1, programSetId });
    },
    [unlogWithRetry, initial.ride.sessionId, exerciseId, setNumbers],
  );
  const { view, events, timeline, serverNow, ready, prompt, online, unsent, queued, soundOff, actions } = useRide({ initial, saveStep, unsaveStep });
  const plan = view.plan;
  const s = runScreen(plan, timeline, { brick });
  const ended = timeline.status === "finished" || timeline.status === "ended_early";
  const offline = !online || unsent;
  const cur = timeline.current;
  const counting = treadmill && timeline.status === "running" && serverNow < view.ride.startedAt;

  // The count ends: the clock runs, with a beep.
  const wasCounting = useRef(counting);
  useEffect(() => {
    if (wasCounting.current && !counting && ready) playCue("work");
    wasCounting.current = counting;
  }, [counting, ready]);

  // ── Undo toast: one at a time, for 5 s, and only while its step runs ──────
  const [toast, setToast] = useState<Toast | null>(null);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast((t) => (t?.id === toast.id ? null : t)), UNDO_MS);
    return () => clearTimeout(id);
  }, [toast]);
  const toastSeq = useRef(0);
  const show = (t: Omit<Toast, "id">) => setToast({ ...t, id: ++toastSeq.current });

  // ── Belt and incline bursts (4.4) ─────────────────────────────────────────
  const bursts = useRef<Partial<Record<Knob, Burst>>>({});
  const timelineIndex = useRef<number | null>(null);
  useEffect(() => {
    timelineIndex.current = cur?.index ?? null;
  });
  /** The value of each open burst, for the screen (the burst's timer lives in the ref). */
  const [pending, setPending] = useState<Partial<Record<Knob, { value: number; index: number }>>>({});
  const syncPending = () => setPending(Object.fromEntries(Object.values(bursts.current).map((b) => [b!.kind, { value: b!.value, index: b!.index }])));
  const send = useCallback(
    (kind: Knob) => {
      const b = bursts.current[kind];
      if (!b) return;
      clearTimeout(b.timer);
      delete bursts.current[kind];
      // A burst of a step that has ended stays unsent: the belt never carries over (4.2).
      if (b.index === timelineIndex.current) (kind === "belt" ? actions.belt : actions.incline)(b.value, b.at);
      syncPending();
    },
    [actions],
  );
  // A new step: an open burst goes.
  const curIndex = cur?.index ?? null;
  useEffect(() => {
    for (const k of ["belt", "incline"] as const) {
      const b = bursts.current[k];
      if (b && b.index !== curIndex) {
        clearTimeout(b.timer);
        delete bursts.current[k];
      }
    }
  }, [curIndex]);
  // A toast of a step that has ended goes; a skip's stays on the next step, as ride mode's does.
  const toastShown = toast && (toast.undo === "unskip" || toast.index === curIndex) ? toast : null;
  useEffect(
    () => () => {
      for (const b of Object.values(bursts.current)) if (b) clearTimeout(b.timer);
    },
    [],
  );
  const shown = (kind: Knob): number | null => {
    // An open burst of the step on screen; one of a step that has ended is gone.
    const p = pending[kind];
    if (p && p.index === cur?.index) return p.value;
    const v = kind === "belt" ? cur?.beltKmh : cur?.inclinePct;
    return v == null ? null : Math.round(v * 10);
  };
  const knob = (kind: Knob, dir: 1 | -1) => {
    if (!cur) return;
    touch();
    const range = kind === "belt" ? BELT_RANGE : INCLINE_RANGE;
    const step = kind === "belt" ? BELT_STEP : INCLINE_STEP;
    const before = bursts.current[kind];
    const now = shown(kind);
    const base = now ?? (kind === "belt" ? FEEL_BELT - dir * step : 0);
    const value = Math.max(range.min, Math.min(range.max, base + dir * step));
    if (value === now) return;
    if (before) clearTimeout(before.timer);
    const from = before ? before.from : now;
    bursts.current[kind] = { kind, from, value, at: serverNow, index: cur.index, timer: setTimeout(() => send(kind), BURST_MS) };
    show({ text: beltToastText(kind, value), index: cur.index, undo: kind, from });
    syncPending();
  };

  const undo = () => {
    const t = toastShown;
    setToast(null);
    if (!t?.undo) return;
    const idx = cur?.index ?? null;
    if (t.undo === "unskip") actions.unskip();
    else if (t.undo === "belt" || t.undo === "incline") {
      const b = bursts.current[t.undo];
      // Still in its burst: nothing was sent, so nothing is sent.
      if (b) {
        clearTimeout(b.timer);
        delete bursts.current[t.undo];
        syncPending();
      } else if (idx === t.index && t.from != null) (t.undo === "belt" ? actions.belt : actions.incline)(t.from);
    } else if (idx === t.index && t.undo === "extend") actions.extend(-EXTEND_STEP_S as -60);
  };

  const extend = () => {
    if (!cur) return;
    touch();
    actions.extend(EXTEND_STEP_S as 60);
    show({ text: "+1 min", index: cur.index, undo: "extend" });
  };
  const skip = () => {
    if (!cur || !s) return;
    touch();
    if (s.inBlock ? actions.skipBlock(cur.index) : actions.skip(cur.index)) show({ text: s.inBlock ? "Strides skipped" : "Skipped", index: -1, undo: "unskip" });
  };
  const lap = () => {
    touch();
    actions.lap();
  };
  const pause = () => {
    // A burst waiting to go is sent first, so it counts from its tap.
    send("belt");
    send("incline");
    actions.pause();
  };

  // ── Controls lock outdoors (4.6) ──────────────────────────────────────────
  /** Counts the taps: each one starts the 10 s again. */
  const [taps, setTaps] = useState(0);
  const [locked, setLocked] = useState(false);
  function touch() {
    setTaps((n) => n + 1);
    setLocked(false);
  }
  const lockable = !treadmill && timeline.status === "running" && !prompt;
  useEffect(() => {
    if (!lockable) return;
    const id = setTimeout(() => setLocked(true), LOCK_AFTER_MS);
    return () => clearTimeout(id);
  }, [lockable, taps]);

  // ── The end: finish the workout of a program with only this exercise ────
  const wrapped = useRef(false);
  const undoPending = toastShown?.undo === "unskip";
  useEffect(() => {
    if (!ready || !ended || queued > 0 || !online || undoPending || wrapped.current) return;
    wrapped.current = true;
    if (workoutSession?.sessionId === initial.ride.sessionId) {
      const inPlan = new Set(plan.steps.map((p) => p.programSetId));
      for (const r of timeline.steps) workoutSession.addCompletedSet(r.programSetId);
      for (const id of Object.keys(setNumbers).map(Number)) if (!inPlan.has(id)) workoutSession.addCompletedSet(id);
    }
    void (async () => {
      if (onlyExercise && !sessionCompleted) {
        const payload = { sessionId: initial.ride.sessionId, endTime: new Date(timeline.endedAt ?? Date.now()).toISOString() };
        const r = await callAction(completeWorkoutSession(payload));
        if (failedInTransit(r)) enqueue({ kind: "completeWorkoutSession", payload });
        if (workoutSession?.sessionId === initial.ride.sessionId) workoutSession.clearActiveWorkout();
      }
      // The results table, as after a ride (R12); its Done opens the summary.
      router.replace(`${pathname}?results=1`);
      router.refresh();
    })();
  }, [ready, ended, queued, online, undoPending, onlyExercise, sessionCompleted, initial.ride.sessionId, timeline.endedAt, timeline.steps, plan.steps, setNumbers, enqueue, workoutSession, router, pathname]);

  if (!ready) return <div data-ride-mode className="fixed inset-0 z-50 bg-background" aria-busy="true" />;

  const headerRight = timeline.status === "paused" ? "Paused" : (s?.total ?? "");
  // Offline is its own line under the header: at 320 px it does not fit beside the step.
  const header = (title?: string) => (
    <div data-testid="ride-header">
      <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground tabular-nums">
        <span className="truncate">
          {s?.header ?? RUN_MODE_NAME[plan.mode]}
          {title ? ` · ${title}` : ""}
        </span>
        <span className="shrink-0" data-testid="ride-total">
          {headerRight}
        </span>
      </div>
      {offline && (
        <p className="mt-1 text-sm font-semibold" data-testid="ride-offline">
          Saved on this phone
        </p>
      )}
    </div>
  );

  const toastRow = toastShown && (
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-foreground pl-4 pr-1 min-h-12 text-background" role="status" data-testid="ride-toast">
      <span className="font-semibold tabular-nums">{toastShown.text}</span>
      {toastShown.undo && (
        <button type="button" onClick={undo} className="min-h-11 px-3 font-semibold active:opacity-70">
          Undo
        </button>
      )}
    </div>
  );

  if (ended || !s) {
    return (
      <div data-ride-mode className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-background px-6 text-center" data-testid="ride-done">
        <p className="text-3xl font-bold">{timeline.status === "ended_early" ? "Run ended early" : "Run done"}</p>
        <p className="text-base text-muted-foreground">{offline ? "Saved on this phone. It sends when you are online." : "Saving the run"}</p>
        {toastRow && <div className="w-full max-w-sm text-left">{toastRow}</div>}
        {(offline || queued > 0) && (
          <Link href={workoutHref} className="min-h-11 px-3 inline-flex items-center font-semibold text-primary active:opacity-70">
            Later
          </Link>
        )}
      </div>
    );
  }

  const clock = (
    <p
      className={`font-bold tabular-nums tracking-tight leading-none ${landscape ? "text-[96px]" : "text-[clamp(56px,13vh,88px)]"} ${timeline.status === "paused" ? "text-muted-foreground" : ""}`}
      data-testid="ride-clock"
    >
      {s.clock}
    </p>
  );
  const title = (
    <h1 className="text-[28px] font-bold leading-tight tracking-tight" data-testid="ride-step-title">
      {s.title}
    </h1>
  );

  // Opened on a running run without a tap: sound and the wake lock need one.
  if (prompt) {
    return (
      <div data-ride-mode className={`fixed inset-0 z-50 flex flex-col gap-4 bg-background px-4 pt-6 ${treadmill ? "pb-10" : "pb-8"}`} data-testid="ride-prompt">
        {header()}
        {title}
        <div className="flex flex-1 flex-col items-center justify-center gap-2">
          {clock}
          <p className="text-base text-muted-foreground">Run running</p>
        </div>
        <button type="button" onClick={actions.carryOn} className={`${RUN_BTN} bg-brand-fill text-white`}>
          Resume
        </button>
        <button type="button" onClick={actions.endAtLastStep} className={`${BTN} bg-muted`}>
          End at the last step
        </button>
      </div>
    );
  }

  // The 5 s count on a treadmill (4.3): step on and set the belt, then the clock runs.
  if (counting) {
    return (
      <div data-ride-mode className="fixed inset-0 z-50 flex flex-col gap-4 bg-background px-4 pt-6 pb-10" data-testid="run-count">
        {header()}
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <p className="text-[120px] font-bold leading-none tabular-nums">{Math.max(1, Math.ceil((view.ride.startedAt - serverNow) / 1000))}</p>
          <p className="text-xl font-semibold">{stepOnText(plan)}</p>
        </div>
      </div>
    );
  }

  if (timeline.status === "paused") {
    const beltLine = treadmill ? resumeBeltText(timeline) : null;
    return (
      <div data-ride-mode className="fixed inset-0 z-50 flex flex-col gap-4 bg-background px-4 pt-6 pb-10" data-testid="ride-paused">
        {header()}
        {title}
        <div className="flex flex-col items-center gap-2">
          {clock}
          <p className="text-base text-muted-foreground">{pausedText(pausedSince(events), serverNow)}</p>
        </div>
        <div className="flex flex-1 flex-col justify-center gap-2">
          {beltLine && (
            <p className="text-center text-lg font-semibold" data-testid="run-resume-belt">
              {beltLine}
            </p>
          )}
          <button type="button" onClick={actions.resume} className={`${RUN_BTN} bg-brand-fill text-white`}>
            Resume
          </button>
        </div>
        <div className="flex flex-col gap-2">
          <button type="button" onClick={actions.end} className={`${BTN} bg-muted`}>
            End run
          </button>
          <p className="text-center text-sm text-muted-foreground" data-testid="ride-kept">
            {runKeptText(plan, timeline, true)}
          </p>
        </div>
      </div>
    );
  }

  const beltShown = shown("belt");
  const inclineShown = shown("incline");
  const planBelt = s.treadmill?.planBelt ?? null;
  const beltCard = treadmill && (
    <div className="rounded-2xl bg-muted px-2 py-2" data-testid="run-belt-card">
      <div className="grid grid-cols-[64px_1fr_64px] items-center gap-2">
        <button type="button" onClick={() => knob("belt", -1)} aria-label="Belt down 0.5 km/h" className={BELT_BTN}>
          −
        </button>
        <div className="text-center">
          <p className="text-xs text-muted-foreground">Belt</p>
          <p className="whitespace-nowrap text-[min(3rem,11.5vw)] font-bold leading-tight tabular-nums">
            <span data-testid="run-belt">{beltShown !== null ? (beltShown / 10).toFixed(1) : "By feel"}</span>
            {beltShown !== null && <small className="ml-1 text-lg font-semibold text-muted-foreground">km/h</small>}
          </p>
          {planBelt !== null && beltShown !== Math.round(planBelt * 10) && (
            <p className="text-xs leading-none text-muted-foreground tabular-nums" data-testid="run-plan-belt">
              Plan {planBelt.toFixed(1)}
            </p>
          )}
        </div>
        <button type="button" onClick={() => knob("belt", 1)} aria-label="Belt up 0.5 km/h" className={BELT_BTN}>
          +
        </button>
      </div>
      <div className="mt-1 grid grid-cols-[64px_1fr_64px] items-center gap-2">
        <button type="button" onClick={() => knob("incline", -1)} aria-label="Incline down 0.5%" className="min-h-16 rounded-2xl bg-background text-2xl font-semibold active:opacity-70 select-none touch-manipulation">
          −
        </button>
        <p className="text-center text-base tabular-nums" data-testid="run-incline">
          Incline {+((inclineShown ?? 0) / 10).toFixed(1)}%
        </p>
        <button type="button" onClick={() => knob("incline", 1)} aria-label="Incline up 0.5%" className="min-h-16 rounded-2xl bg-background text-2xl font-semibold active:opacity-70 select-none touch-manipulation">
          +
        </button>
      </div>
    </div>
  );
  const targetCard = !treadmill && (
    <div className="rounded-2xl bg-muted px-4 py-3 text-center" data-testid="ride-target">
      {s.target ? (
        // A number stays on one line at 320 px too; words ("Easy jog or walk") wrap in a smaller size.
        <p className={`font-bold leading-tight tracking-tight tabular-nums ${s.target.unit === null && s.target.value.length > 10 ? "text-3xl" : "whitespace-nowrap text-[min(3rem,11.5vw)]"}`}>
          <span data-testid="run-target-value">{s.target.value}</span>
          {s.target.unit && <small className="ml-2 text-xl font-semibold text-muted-foreground">{s.target.unit}</small>}
        </p>
      ) : (
        <p className="text-2xl font-semibold text-muted-foreground">No target</p>
      )}
      <Second s={s} />
    </div>
  );
  // The Next card turns into the cue (accent) and gives its place to the undo toast.
  const nextCard = toastRow || (
    <div
      className={`flex items-center justify-between gap-3 rounded-2xl px-4 min-h-12 text-sm min-[360px]:text-base ${s.cue ? "bg-brand-fill font-semibold text-white" : "bg-muted"}`}
      data-testid={s.cue ? "run-cue" : "ride-next"}
    >
      {s.cue ? (
        <span className="py-2">{s.cue}</span>
      ) : (
        <>
          <span className="min-w-0 py-2">
            <span className="text-muted-foreground">Next</span> {s.next.title}
          </span>
          {s.next.target && <span className="shrink-0 py-2 tabular-nums">{s.next.target}</span>}
        </>
      )}
    </div>
  );
  const sub = (
    <>
      {s.distanceLine && (
        <p className="text-center text-sm text-muted-foreground tabular-nums" data-testid="run-distance">
          {s.distanceLine}
        </p>
      )}
      {s.lapHint && <p className="text-center text-sm text-muted-foreground">{s.lapHint}</p>}
    </>
  );
  const extendBtn = s.canExtend && (
    <button type="button" onClick={extend} aria-label="Add 1 min" className={`${RUN_BTN} bg-muted`}>
      +1 min
    </button>
  );
  // Four in a row cut "Hold to skip" on a phone: with Lap, +1 min gets a row of its own above (portrait).
  const extendAbove = !landscape && !!extendBtn && s.lap;
  const controls = (
    <>
      {!extendAbove && extendBtn}
      <HoldToSkip step={s.stepNumber} onSkip={skip} className="min-h-16" sub={s.inBlock ? "strides" : `step ${s.stepNumber}`} ariaLabel={s.inBlock ? "Hold to skip the strides" : `Hold to skip step ${s.stepNumber}`} />
      <button type="button" onClick={pause} className={`${RUN_BTN} bg-brand-fill text-white`}>
        Pause
      </button>
      {s.lap && (
        <button type="button" onClick={lap} className={`${RUN_BTN} bg-muted`}>
          Lap
        </button>
      )}
    </>
  );
  // Outdoors, 10 s after the last tap, a hold covers the controls (4.6).
  const lockCover = locked && (
    <div className="absolute inset-0 z-10 grid" data-testid="run-lock">
      <HoldToSkip step={s.stepNumber} onSkip={touch} label="Controls locked" sub="Hold to unlock" ariaLabel="Hold to unlock the controls" testId="run-unlock" className="h-full bg-muted" />
    </div>
  );
  const soundHint = soundOff && (
    <button type="button" onClick={actions.soundOn} className="min-h-11 rounded-xl bg-muted px-3 text-sm" data-testid="ride-sound-off">
      Tap to turn sound back on
    </button>
  );
  const announce = (
    <span className="sr-only" aria-live="polite">
      {`${s.title}, ${s.cue ?? (treadmill ? (beltShown !== null ? `belt ${(beltShown / 10).toFixed(1)} km/h` : "") : s.target ? `${s.target.value}${s.target.unit ? ` ${s.target.unit}` : ""}` : "")}`}
    </span>
  );

  if (landscape) {
    return (
      <div data-ride-mode className={`fixed inset-0 z-50 flex flex-col gap-3 bg-background px-4 pt-3 ${treadmill ? "pb-10" : "pb-3"}`} data-testid="ride-screen" data-layout="landscape">
        {header(s.title)}
        <div className="grid min-h-0 flex-1 grid-cols-2 items-center gap-3">
          <div className="flex flex-col items-center gap-1">
            {clock}
            {s.block && <Dots block={s.block} />}
            {sub}
            {/* The second line sits under the clock: the right column holds the belt and Next above the controls. */}
            {treadmill && <Second s={s} belt={beltShown !== null ? beltShown / 10 : null} />}
          </div>
          <div className="flex flex-col gap-2">
            {beltCard || targetCard}
            {nextCard}
          </div>
        </div>
        <div className="relative grid auto-cols-fr grid-flow-col gap-2">
          {controls}
          {lockCover}
        </div>
        {soundHint}
        {announce}
      </div>
    );
  }

  return (
    <div
      data-ride-mode
      className={`fixed inset-0 z-50 flex flex-col gap-3 overflow-y-auto bg-background px-4 pt-6 [@media(max-height:620px)]:gap-2 [@media(max-height:620px)]:pt-3 ${treadmill ? "pb-10" : "pb-6"}`}
      data-testid="ride-screen"
      data-layout="portrait"
    >
      {header()}
      {title}
      <div className="flex justify-center">{clock}</div>
      {s.block && <Dots block={s.block} />}
      {sub}
      {beltCard || targetCard}
      {treadmill && <Second s={s} belt={beltShown !== null ? beltShown / 10 : null} />}
      {extendAbove && (
        <div className="relative grid">
          {extendBtn}
          {locked && <div className="absolute inset-0 z-10 rounded-2xl bg-background/80" aria-hidden />}
        </div>
      )}
      {nextCard}
      {soundHint}
      {/* A console ledge covers the last 40 px on a treadmill: the controls sit above it. */}
      <div className="relative mt-auto grid auto-cols-fr grid-flow-col gap-2 pt-2">
        {controls}
        {lockCover}
      </div>
      {announce}
    </div>
  );
}
