"use client";

/**
 * Ride mode inside the bike exercise (docs/plans/bike-ride-logger.md,
 * section 5 "Ride mode", 4.4 and 4.5): the step, a big clock and target to
 * read from the handlebar, the controls with an undo for each change, and
 * each step saved when it ends. Paused shows Resume and End ride. In
 * landscape the clock sits left of the target and the controls form one row.
 * When the ride ends, the workout is finished (a program of this exercise
 * only) and the bike screen shows "Ride done".
 */

import { useRide, type RideTap } from "@/components/features/bike/useRide";
import { usePendingQueue, useWorkoutSetWriter } from "@/contexts/pending-queue-context";
import { useWorkoutSession } from "@/contexts/workout-session-context";
import type { RideView } from "@/lib/actions/rides";
import { completeWorkoutSession } from "@/lib/actions/workout-sessions";
import { CHART } from "@/lib/utils/bike-ride-view";
import { keptStepsText, pausedSince, pausedText, rideScreen, shiftedWattsText, stepLogPayload, type RideScreen } from "@/lib/utils/ride-screen";
import { EXTEND_STEP_S, NUDGE_CAP_W, NUDGE_STEP_W, type RideStepResult } from "@/lib/utils/ride-timeline";
import { callAction, failedInTransit } from "@/lib/utils/stale-bundle";
import type { Units } from "@/lib/utils/units";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

/** How long a change can be undone (4.4). */
export const UNDO_MS = 5_000;
/** Press and hold this long to skip (4.4). */
export const HOLD_TO_SKIP_MS = 600;

type Toast = { id: number; text: string; index: number; undo: RideTap | null; value?: number };

/** A phone on its side: the landscape layout. */
function useLandscape(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(orientation: landscape) and (max-height: 600px)");
    const set = () => setOn(mq.matches);
    set();
    mq.addEventListener?.("change", set);
    return () => mq.removeEventListener?.("change", set);
  }, []);
  return on;
}

const BTN = "min-h-14 rounded-2xl text-base font-semibold active:opacity-70 disabled:opacity-40 select-none touch-manipulation";

function HoldToSkip({ step, onSkip, className = "" }: { step: number; onSkip: () => void; className?: string }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [holding, setHolding] = useState(false);
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  };
  /** The finger slid off the button: no skip. */
  const off = (e: React.PointerEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) stop();
  };
  const begin = () => {
    stop();
    setHolding(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setHolding(false);
      onSkip();
    }, HOLD_TO_SKIP_MS);
  };
  useEffect(() => stop, []);
  return (
    <button
      type="button"
      aria-label={`Hold to skip step ${step}`}
      onPointerDown={begin}
      onPointerMove={off}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !e.repeat) {
          e.preventDefault();
          begin();
        }
      }}
      onKeyUp={stop}
      onContextMenu={(e) => e.preventDefault()}
      className={`${BTN} relative overflow-hidden bg-muted px-2 ${className}`}
      data-testid="ride-skip"
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 bg-foreground/15"
        style={{ width: holding ? "100%" : "0%", transition: holding ? `width ${HOLD_TO_SKIP_MS}ms linear` : "none" }}
      />
      <span className="relative block leading-tight">Hold to skip</span>
      <span className="relative block text-xs font-normal text-muted-foreground">step {step}</span>
    </button>
  );
}

function MiniProfile({ profile }: { profile: RideScreen["profile"] }) {
  const span = CHART.right - CHART.left;
  return (
    <div className="rounded-xl bg-muted px-2 py-1.5">
      <svg viewBox={`${CHART.left} 0 ${span} 100`} preserveAspectRatio="none" className="block h-9 w-full" role="img" aria-label="Ride profile with your place in it" data-testid="ride-mini-profile">
        {profile.bars.map((b) => (
          <rect key={b.key} x={b.x} y={100 - b.h} width={b.w} height={b.h} rx={1} className="fill-brand" fillOpacity={b.current ? 0.95 : 0.35} />
        ))}
        {profile.markerX !== null && <line x1={profile.markerX} y1={0} x2={profile.markerX} y2={100} className="stroke-foreground" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
      </svg>
    </div>
  );
}

function TargetCard({ s, compact = false }: { s: RideScreen; compact?: boolean }) {
  return (
    <div className="rounded-2xl bg-muted px-4 py-3 text-center" data-testid="ride-target">
      {s.target ? (
        // One line at 320 px too: the size follows the screen width up to 48 px.
        <p className={`${compact ? "text-4xl" : "text-[min(3rem,11.5vw)]"} whitespace-nowrap font-bold tabular-nums tracking-tight text-brand leading-tight`}>
          <span data-testid="ride-target-value">{s.target.value}</span>
          {s.target.unit && <small className="ml-2 text-xl font-semibold text-muted-foreground">{s.target.unit}</small>}
        </p>
      ) : (
        <p className="text-2xl font-semibold text-muted-foreground">No target</p>
      )}
      {s.second.length > 0 && (
        <p className="mt-1 flex flex-wrap justify-center gap-x-4 text-base tabular-nums" data-testid="ride-second">
          {s.second.map((x) => (
            <span key={x.label}>
              <span className="text-muted-foreground">{x.label}</span> {x.value}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

function NextCard({ s }: { s: RideScreen }) {
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-2xl px-4 min-h-12 text-base ${s.lastMinute ? "bg-brand/25" : "bg-muted"}`}
      data-testid="ride-next"
      data-last-minute={s.lastMinute ? "true" : undefined}
    >
      <span className="min-w-0 py-2">
        <span className="text-muted-foreground">Next</span> {s.next.title}
      </span>
      {s.next.target && <span className="shrink-0 py-2 tabular-nums">{s.next.target}</span>}
    </div>
  );
}

export function RideMode({
  exerciseId,
  initial,
  setNumbers,
  onlyExercise,
  sessionCompleted,
  units,
}: {
  exerciseId: number;
  initial: RideView;
  /** The set number of each program set, for `logWorkoutSet`. */
  setNumbers: Record<number, number>;
  /** The program holds this exercise only: the end of the ride finishes the workout. */
  onlyExercise: boolean;
  sessionCompleted: boolean;
  units: Units;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const workoutSession = useWorkoutSession();
  const { logWithRetry, unlogWithRetry } = useWorkoutSetWriter();
  const { enqueue } = usePendingQueue();
  const landscape = useLandscape();

  const saveStep = useCallback(
    (r: RideStepResult) => {
      void logWithRetry(stepLogPayload(r, { sessionId: initial.ride.sessionId, exerciseId, setNumber: setNumbers[r.programSetId] ?? 1 }));
    },
    [logWithRetry, initial.ride.sessionId, exerciseId, setNumbers],
  );
  // A skip taken back (here or on another phone): the skipped row goes, and the step saves again when it ends.
  const unsaveStep = useCallback(
    (programSetId: number) => {
      void unlogWithRetry({ sessionId: initial.ride.sessionId, exerciseId, setNumber: setNumbers[programSetId] ?? 1, programSetId });
    },
    [unlogWithRetry, initial.ride.sessionId, exerciseId, setNumbers],
  );
  const { view, events, timeline, serverNow, ready, prompt, online, unsent, queued, soundOff, actions } = useRide({ initial, saveStep, unsaveStep });
  const plan = view.plan;
  const s = rideScreen(plan, timeline, units);
  const ended = timeline.status === "finished" || timeline.status === "ended_early";
  const offline = !online || unsent;

  // Undo toast: one at a time, for 5 s.
  const [toast, setToast] = useState<Toast | null>(null);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast((t) => (t?.id === toast.id ? null : t)), UNDO_MS);
    return () => clearTimeout(id);
  }, [toast]);
  const show = (t: Omit<Toast, "id">) => setToast({ ...t, id: Date.now() + Math.random() });
  const undo = () => {
    const t = toast;
    setToast(null);
    if (!t?.undo) return;
    const cur = timeline.current?.index ?? null;
    if (t.undo === "unskip") actions.unskip();
    // A change to a step that has ended stays: the undo would land on the next step.
    else if (cur === t.index && t.undo === "nudge") actions.nudge(-t.value! as 5 | -5);
    else if (cur === t.index && t.undo === "extend") actions.extend(-EXTEND_STEP_S as -60);
  };

  const nudge = (w: 5 | -5) => {
    const cur = timeline.current;
    if (!cur) return;
    const step = plan.steps[cur.index];
    const next = Math.max(-NUDGE_CAP_W, Math.min(NUDGE_CAP_W, cur.offsetW + w));
    if (next === cur.offsetW) return;
    actions.nudge(w);
    show({ text: `Target ${shiftedWattsText(step, next) ?? ""}`.trim(), index: cur.index, undo: "nudge", value: w });
  };
  const extend = () => {
    const cur = timeline.current;
    if (!cur) return;
    actions.extend(EXTEND_STEP_S as 60);
    show({ text: "+1 min", index: cur.index, undo: "extend" });
  };
  const skip = () => {
    const cur = timeline.current;
    if (!cur) return;
    if (actions.skip(cur.index)) show({ text: "Skipped", index: cur.index, undo: "unskip" });
  };
  const lap = () => actions.lap();

  // The end: finish the workout of a program with only this exercise, then the bike screen.
  // A skip of the last step ends the ride: it waits while its Undo shows.
  const wrapped = useRef(false);
  const undoPending = toast?.undo === "unskip";
  useEffect(() => {
    if (!ready || !ended || queued > 0 || !online || undoPending || wrapped.current) return;
    wrapped.current = true;
    void (async () => {
      if (onlyExercise && !sessionCompleted) {
        const payload = { sessionId: initial.ride.sessionId, endTime: new Date(timeline.endedAt ?? Date.now()).toISOString() };
        const r = await callAction(completeWorkoutSession(payload));
        if (failedInTransit(r)) enqueue({ kind: "completeWorkoutSession", payload });
        if (workoutSession?.sessionId === initial.ride.sessionId) workoutSession.clearActiveWorkout();
      }
      router.replace(pathname);
      router.refresh();
    })();
  }, [ready, ended, queued, online, undoPending, onlyExercise, sessionCompleted, initial.ride.sessionId, timeline.endedAt, enqueue, workoutSession, router, pathname]);

  if (!ready) return <div data-ride-mode className="fixed inset-0 z-50 bg-background" aria-busy="true" />;

  const headerRight = offline ? "Saved on this phone" : timeline.status === "paused" ? "Paused" : (s?.total ?? "");
  const header = (title?: string) => (
    <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground tabular-nums" data-testid="ride-header">
      <span className="truncate">
        {s?.header ?? (plan.mode === "indoor" ? "Indoor" : "Outdoor")}
        {title ? ` · ${title}` : ""}
      </span>
      <span className="shrink-0" data-testid={offline ? "ride-offline" : "ride-total"}>
        {headerRight}
      </span>
    </div>
  );

  const toastRow = toast && (
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-foreground pl-4 pr-1 min-h-12 text-background" role="status" data-testid="ride-toast">
      <span className="font-semibold tabular-nums">{toast.text}</span>
      {toast.undo && (
        <button type="button" onClick={undo} className="min-h-11 px-3 font-semibold active:opacity-70">
          Undo
        </button>
      )}
    </div>
  );
  if (ended || !s) {
    return (
      <div data-ride-mode className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-background px-6 text-center" data-testid="ride-done">
        <p className="text-3xl font-bold">{timeline.status === "ended_early" ? "Ride ended early" : "Ride done"}</p>
        <p className="text-base text-muted-foreground">{offline ? "Saved on this phone. It sends when you are online." : "Saving the ride"}</p>
        {toastRow && <div className="w-full max-w-sm text-left">{toastRow}</div>}
      </div>
    );
  }

  const clock = (
    <p className={`font-bold tabular-nums tracking-tight leading-none ${landscape ? "text-[96px]" : "text-[88px]"} ${timeline.status === "paused" ? "text-muted-foreground" : ""}`} data-testid="ride-clock">
      {s.clock}
    </p>
  );
  const title = (
    <h1 className="text-[28px] font-bold leading-tight tracking-tight" data-testid="ride-step-title">
      {s.title}
    </h1>
  );
  const nudges = (withExtend: boolean) => (
    <>
      {s.power && (
        <button type="button" onClick={() => nudge(-NUDGE_STEP_W as -5)} disabled={!s.canLower} aria-label="Target down 5 W" className={`${BTN} bg-muted`}>
          −5 W
        </button>
      )}
      {withExtend && s.canExtend && (
        <button type="button" onClick={extend} aria-label="Add 1 min" className={`${BTN} bg-muted`}>
          +1 min
        </button>
      )}
      {s.power && (
        <button type="button" onClick={() => nudge(NUDGE_STEP_W as 5)} disabled={!s.canRaise} aria-label="Target up 5 W" className={`${BTN} bg-muted`}>
          +5 W
        </button>
      )}
    </>
  );
  const pauseBtn = (
    <button type="button" onClick={actions.pause} className={`${BTN} bg-brand-fill text-white`}>
      Pause
    </button>
  );
  const lapBtn = s.lap && (
    <button type="button" onClick={lap} className={`${BTN} bg-muted`}>
      Lap
    </button>
  );
  const soundHint = soundOff && (
    <button type="button" onClick={actions.soundOn} className="min-h-11 rounded-xl bg-muted px-3 text-sm" data-testid="ride-sound-off">
      Tap to turn sound back on
    </button>
  );

  const announce = (
    <span className="sr-only" aria-live="polite">
      {`${s.title}, ${s.target ? `${s.target.value}${s.target.unit ? ` ${s.target.unit}` : ""}` : ""}`}
    </span>
  );

  // Opened on a running ride without a tap: sound and the wake lock need one.
  if (prompt) {
    return (
      <div data-ride-mode className="fixed inset-0 z-50 flex flex-col gap-4 bg-background px-4 pt-6 pb-8" data-testid="ride-prompt">
        {header()}
        {title}
        <div className="flex flex-1 flex-col items-center justify-center gap-2">
          {clock}
          <p className="text-base text-muted-foreground">Ride running</p>
        </div>
        <button type="button" onClick={actions.carryOn} className={`${BTN} bg-brand-fill text-white`}>
          Resume
        </button>
        <button type="button" onClick={actions.endAtLastStep} className={`${BTN} bg-muted`}>
          End at the last step
        </button>
      </div>
    );
  }

  if (timeline.status === "paused") {
    return (
      <div data-ride-mode className="fixed inset-0 z-50 flex flex-col gap-4 bg-background px-4 pt-6 pb-8" data-testid="ride-paused">
        {header()}
        {title}
        <div className="flex flex-col items-center gap-2">
          {clock}
          <p className="text-base text-muted-foreground">{pausedText(pausedSince(events), serverNow)}</p>
        </div>
        <div className="flex flex-1 flex-col justify-center">
          <button type="button" onClick={actions.resume} className={`${BTN} min-h-16 bg-brand-fill text-white`}>
            Resume
          </button>
        </div>
        <div className="flex flex-col gap-2">
          <button type="button" onClick={actions.end} className={`${BTN} bg-muted`}>
            End ride
          </button>
          <p className="text-center text-sm text-muted-foreground" data-testid="ride-kept">
            {keptStepsText(timeline)}
          </p>
        </div>
      </div>
    );
  }

  if (landscape) {
    return (
      <div data-ride-mode className="fixed inset-0 z-50 flex flex-col gap-3 bg-background px-4 pt-3 pb-3" data-testid="ride-screen" data-layout="landscape">
        {header(s.title)}
        <div className="grid min-h-0 flex-1 grid-cols-2 items-center gap-3">
          <div className="flex flex-col items-center">
            {clock}
            <p className="text-sm text-muted-foreground">{s.remaining === null ? "in this step" : "left in this step"}</p>
          </div>
          <div className="flex flex-col gap-2">
            <TargetCard s={s} compact />
            {toastRow || <NextCard s={s} />}
          </div>
        </div>
        <div className="grid auto-cols-fr grid-flow-col gap-2">
          {nudges(true)}
          <HoldToSkip step={s.stepNumber} onSkip={skip} />
          {pauseBtn}
          {lapBtn}
        </div>
        {soundHint}
        {announce}
      </div>
    );
  }

  return (
    <div data-ride-mode className="fixed inset-0 z-50 flex flex-col gap-3 overflow-y-auto bg-background px-4 pt-6 pb-6" data-testid="ride-screen" data-layout="portrait">
      {header()}
      {plan.mode === "indoor" && <MiniProfile profile={s.profile} />}
      {title}
      <div className="flex justify-center">{clock}</div>
      {s.remaining === null && <p className="-mt-2 text-center text-sm text-muted-foreground">Tap Lap when done</p>}
      <TargetCard s={s} />
      {toastRow}
      {(s.power || s.canExtend) && <div className="grid auto-cols-fr grid-flow-col gap-2">{nudges(true)}</div>}
      <NextCard s={s} />
      {soundHint}
      <div className="mt-auto grid auto-cols-fr grid-flow-col gap-2 pt-2">
        <HoldToSkip step={s.stepNumber} onSkip={skip} />
        {pauseBtn}
        {lapBtn}
      </div>
      {announce}
    </div>
  );
}
