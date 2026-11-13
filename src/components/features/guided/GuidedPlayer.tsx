"use client";

/**
 * The guided player screen (docs/plans/endurance-app.md, 3.4-3.7): step
 * timer, current and next target, cue at each change, pause, skip, extend,
 * lap, and the screen kept awake. Swim sessions use the send-off layout
 * (4.4): each rep counts down to the next send-off.
 */

import { STEP_TONE, STEP_WORD, toPlaySteps, type PlayerSession, type PlayerStepView } from "@/components/features/guided/types";
import { useGuidedPlayer } from "@/components/features/guided/useGuidedPlayer";
import { formatTime } from "@/lib/utils/format";
import { elapsedSeconds, remainingSeconds } from "@/lib/utils/workout-player";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

function NextLine({ step }: { step: PlayerStepView | undefined }) {
  if (!step) return <p className="text-sm text-muted-foreground">Next: finish</p>;
  return (
    <p className="text-sm text-muted-foreground" data-testid="player-next">
      Next: {step.text}
      {step.targetText ? ` · ${step.targetText}` : ""}
    </p>
  );
}

export function GuidedPlayer({ session, initialSoundHint = true }: { session: PlayerSession; initialSoundHint?: boolean }) {
  const router = useRouter();
  const steps = useMemo(() => toPlaySteps(session.steps), [session.steps]);
  const resultsHref = `/planned/${session.plannedSessionId}/results?from=player`;
  const { state, now, restored, notice, blocked, passed, flashKey, soundOff, wakeLockOk, actions } = useGuidedPlayer({
    plannedSessionId: session.plannedSessionId,
    workoutHash: session.workoutHash,
    steps,
    onFinished: () => router.push(resultsHref),
  });
  const [confirm, setConfirm] = useState<"leave" | "finish" | null>(null);
  const live = state.status === "running" || state.status === "paused";
  const current = session.steps[state.index];
  const next = session.steps[state.index + 1];
  const remaining = remainingSeconds(state, steps, now);
  const elapsed = elapsedSeconds(state, now);
  const swim = session.sport === "swim";

  if (!restored) return <div className="flex-1" aria-busy="true" />;

  if (state.status === "ready") {
    const first = session.steps[0];
    return (
      <div className="flex-1 flex flex-col gap-4 px-6 py-6" data-testid="player-ready">
        <h1 className="text-2xl font-bold">{session.name}</h1>
        <p className="text-sm text-muted-foreground">
          {session.steps.length} steps. First: {first?.text}
          {first?.targetText ? ` · ${first.targetText}` : ""}
        </p>
        {notice?.kind === "workout_changed" && (
          <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-sm">A saved run was for an older version of this workout. It was not resumed.</p>
        )}
        {notice?.kind === "other_session" && (
          <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-sm">A run of another session is saved on this phone. Starting this one replaces it.</p>
        )}
        {notice?.kind === "unsaved" && (
          <div className="rounded-xl bg-amber-500/10 px-3 py-2 text-sm flex flex-col gap-2" data-testid="unsaved-run">
            <p>
              {notice.plannedSessionId === session.plannedSessionId
                ? "A finished run of an older version of this workout is not saved yet."
                : "A finished run of another session is not saved yet."}{" "}
              Save its results or discard it before you start.
            </p>
            <div className="flex gap-2">
              <a
                href={`/planned/${notice.plannedSessionId}/results?from=player`}
                className="flex-1 min-h-11 inline-flex items-center justify-center rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground active:opacity-80"
              >
                Save its results
              </a>
              <button type="button" onClick={actions.discardSaved} className="flex-1 min-h-11 rounded-xl border border-border px-3 text-sm font-medium active:opacity-70">
                Discard it
              </button>
            </div>
          </div>
        )}
        {initialSoundHint && (
          <ul className="text-sm text-muted-foreground list-disc pl-5 flex flex-col gap-1">
            <li>Turn off silent mode to hear the cues.</li>
            <li>Keep the app open: cues stop when the phone locks. The time goes on.</li>
          </ul>
        )}
        <div className="mt-auto flex flex-col gap-3">
          <button
            type="button"
            onClick={actions.soundOn}
            className="min-h-11 rounded-2xl border border-border px-4 py-3 text-base font-medium active:opacity-70"
          >
            Test sound
          </button>
          <button
            type="button"
            onClick={actions.start}
            disabled={blocked}
            className="min-h-14 rounded-2xl bg-primary px-4 py-4 text-lg font-semibold text-primary-foreground disabled:opacity-50 active:scale-95 transition-all"
          >
            Start
          </button>
        </div>
      </div>
    );
  }

  if (!live || !current) return <div className="flex-1" aria-busy="true" />;

  const big = remaining !== null ? formatTime(remaining) : formatTime(elapsed);
  return (
    <div className={`fixed inset-0 z-50 flex flex-col bg-background`} data-testid="guided-player">
      <div key={flashKey} className={`absolute inset-0 -z-10 ${STEP_TONE[current.type]} ${flashKey > 0 ? "animate-pulse [animation-iteration-count:1]" : ""}`} />
      <div className="sr-only" aria-live="assertive" data-testid="player-announce">
        {`${STEP_WORD[current.type]}: ${current.text}${current.targetText ? `, ${current.targetText}` : ""}`}
      </div>

      <div className="flex items-center justify-between px-6 pt-6">
        <span className="text-sm font-semibold" data-testid="player-step-count">
          Step {state.index + 1} of {session.steps.length}
        </span>
        <button type="button" onClick={() => setConfirm("leave")} className="min-h-11 min-w-11 px-3 text-sm text-muted-foreground active:opacity-70">
          Leave
        </button>
      </div>

      {soundOff && (
        <button type="button" onClick={actions.soundOn} className="mx-6 mt-2 min-h-11 rounded-xl bg-amber-500/15 px-3 text-sm font-medium" data-testid="sound-off">
          Tap to turn sound back on
        </button>
      )}
      {wakeLockOk === false && (
        <p className="mx-6 mt-2 rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground" data-testid="wake-lock-hint">
          The screen may lock. Timing goes on; set Auto-Lock to Never for this session.
        </p>
      )}
      {passed > 0 && (
        <button type="button" onClick={actions.dismissPassed} className="mx-6 mt-2 min-h-11 rounded-xl bg-muted px-3 text-sm" data-testid="steps-passed">
          {passed} {passed === 1 ? "step" : "steps"} passed while the app was closed
        </button>
      )}

      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-lg font-semibold uppercase tracking-wider" data-testid="player-step-type">
          {STEP_WORD[current.type]}
          {current.round ? ` · ${swim ? "Rep" : "Round"} ${current.round.index} of ${current.round.of}` : ""}
        </p>
        <p className="text-8xl font-bold tabular-nums tracking-tight" data-testid="player-time">
          {big}
        </p>
        {remaining === null && (
          <p className="text-sm text-muted-foreground">{current.distanceText ? `${current.distanceText}: tap Lap when done` : "Tap Lap when done"}</p>
        )}
        {current.sendOff && remaining !== null && <p className="text-sm text-muted-foreground">to the next send-off</p>}
        <p className="text-xl font-medium" data-testid="player-step-text">
          {current.text}
        </p>
        {current.targetText && (
          <p className="text-3xl font-bold" data-testid="player-target">
            {current.targetText}
          </p>
        )}
        {current.note && <p className="text-sm">{current.note}</p>}
        <NextLine step={next} />
      </div>

      {confirm && (
        <div className="mx-6 mb-3 rounded-2xl bg-muted p-4 flex flex-col gap-3" role="dialog" aria-label={confirm === "leave" ? "Leave the session" : "Finish the session"}>
          <p className="text-sm">
            {confirm === "leave" ? "Leave? The session keeps its time; resume it from the home screen." : "Finish now? The rest of the steps count as not done."}
          </p>
          <div className="flex gap-3">
            <button type="button" onClick={() => setConfirm(null)} className="flex-1 min-h-11 rounded-xl border border-border text-sm font-medium active:opacity-70">
              Stay
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirm(null);
                if (confirm === "leave") router.push(`/planned/${session.plannedSessionId}`);
                else actions.finish();
              }}
              className="flex-1 min-h-11 rounded-xl bg-primary text-sm font-semibold text-primary-foreground active:opacity-70"
            >
              {confirm === "leave" ? "Leave" : "Finish"}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-4 gap-2 px-4 pb-8 pt-2">
        {state.status === "running" ? (
          <button type="button" onClick={actions.pause} className="col-span-2 min-h-16 rounded-2xl bg-primary text-lg font-semibold text-primary-foreground active:scale-95 transition-all">
            Pause
          </button>
        ) : (
          <button type="button" onClick={actions.resume} className="col-span-2 min-h-16 rounded-2xl bg-primary text-lg font-semibold text-primary-foreground active:scale-95 transition-all">
            Resume
          </button>
        )}
        {remaining === null ? (
          <button type="button" onClick={() => actions.lap(current.key)} className="min-h-16 rounded-2xl bg-muted text-base font-semibold active:scale-95 transition-all">
            Lap
          </button>
        ) : (
          <button type="button" onClick={() => actions.extend(30)} className="min-h-16 rounded-2xl bg-muted text-base font-semibold active:scale-95 transition-all">
            +30 s
          </button>
        )}
        <button type="button" onClick={() => actions.skip(current.key)} className="min-h-16 rounded-2xl bg-muted text-base font-semibold active:scale-95 transition-all">
          Skip
        </button>
        <button type="button" onClick={() => setConfirm("finish")} className="col-span-4 min-h-11 rounded-2xl border border-border text-sm font-medium active:opacity-70">
          Finish
        </button>
      </div>
    </div>
  );
}
