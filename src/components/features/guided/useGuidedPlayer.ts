"use client";

/**
 * The guided player's clock (docs/plans/endurance-app.md, 3.4-3.8). Built
 * beside the strength timers, not on them (decision 1), with the same
 * pattern: time comes from timestamps, a short interval repaints, and
 * visibilitychange, pageshow and focus resync after iOS suspends the app.
 * The state machine is pure (src/lib/utils/workout-player.ts); this hook
 * adds the cues, the wake lock and the saved run.
 */

import { playCue, unlockAudio } from "@/lib/audio-cues";
import { haptics } from "@/lib/utils/haptics";
import {
  PLAYER_STORAGE_KEY,
  extend as extendStep,
  finish as finishRun,
  initialState,
  lap as lapStep,
  pause as pauseRun,
  remainingSeconds,
  restorePlayerState,
  resume as resumeRun,
  serializePlayerState,
  skip as skipStep,
  start as startRun,
  tick,
  type PlayStep,
  type PlayerState,
} from "@/lib/utils/workout-player";
import { requestWakeLock, wakeLockSupported, type WakeLockHandle } from "@/lib/wake-lock";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** How often the screen repaints and checks for a step change: a cue is never more than this late. */
export const PLAYER_TICK_MS = 250;

function newClientKey(): string {
  const c = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  return c.replace(/[^A-Za-z0-9]/g, "").slice(0, 32).padEnd(8, "0");
}

function readSaved(): string | null {
  try {
    return localStorage.getItem(PLAYER_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeSaved(s: PlayerState) {
  try {
    localStorage.setItem(PLAYER_STORAGE_KEY, serializePlayerState(s));
  } catch {
    // Private mode or full storage: the run still works, it just cannot survive a reload.
  }
}

export type PlayerNotice = "workout_changed" | "other_session" | null;

export function useGuidedPlayer(opts: { plannedSessionId: number; workoutHash: string; steps: PlayStep[]; onFinished: (s: PlayerState) => void }) {
  const { plannedSessionId, workoutHash, steps } = opts;
  const onFinished = useRef(opts.onFinished);
  useEffect(() => {
    onFinished.current = opts.onFinished;
  });
  const [state, setState] = useState<PlayerState>(() => initialState({ plannedSessionId, workoutHash, clientKey: "pending" }));
  const stateRef = useRef(state);
  const [now, setNow] = useState(0);
  const [restored, setRestored] = useState(false);
  const [notice, setNotice] = useState<PlayerNotice>(null);
  /** Steps that passed while the app was in the background. */
  const [passed, setPassed] = useState(0);
  const [flashKey, setFlashKey] = useState(0);
  const [soundOff, setSoundOff] = useState(false);
  const [wakeLockOk, setWakeLockOk] = useState<boolean | null>(null);
  const lastRemaining = useRef<number | null>(null);
  const lock = useRef<WakeLockHandle | null>(null);

  const commit = useCallback((next: PlayerState) => {
    if (next === stateRef.current) return;
    stateRef.current = next;
    setState(next);
    writeSaved(next);
    if (next.status === "finished") onFinished.current(next);
  }, []);

  // Restore a saved run after mount (localStorage is not readable on the server).
  useEffect(() => {
    const r = restorePlayerState(readSaved(), { plannedSessionId, workoutHash, now: Date.now() });
    if (r.state) {
      stateRef.current = r.state;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring the saved run from localStorage on mount
      setState(r.state);
      if (r.state.status === "finished") onFinished.current(r.state);
    } else {
      const fresh = initialState({ plannedSessionId, workoutHash, clientKey: newClientKey() });
      stateRef.current = fresh;
      setState(fresh);
      if (r.reason === "workout_changed" || r.reason === "other_session") setNotice(r.reason);
    }
    setNow(Date.now());
    setRestored(true);
  }, [plannedSessionId, workoutHash]);

  const cue = useCallback((kind: "count" | "change" | "work") => {
    const played = playCue(kind);
    setSoundOff(!played);
    haptics.tap();
  }, []);

  /** Close the steps that ended by now, and cue. */
  const advance = useCallback(
    (fromBackground: boolean) => {
      const t = Date.now();
      setNow(t);
      const cur = stateRef.current;
      const { state: next, changed } = tick(cur, steps, t);
      if (changed > 0) {
        const kind = next.status === "running" && steps[next.index]?.type === "work" ? "work" : "change";
        cue(kind);
        setFlashKey((k) => k + 1);
        if (fromBackground || changed > 1) setPassed(changed);
        lastRemaining.current = null;
        commit(next);
        return;
      }
      if (cur.status !== "running") return;
      const rem = remainingSeconds(cur, steps, t);
      if (rem !== null && rem >= 1 && rem <= 3 && rem !== lastRemaining.current && !fromBackground) cue("count");
      lastRemaining.current = rem;
    },
    [steps, cue, commit],
  );

  const live = state.status === "running" || state.status === "paused";

  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => advance(false), PLAYER_TICK_MS);
    return () => clearInterval(id);
  }, [live, advance]);

  const askWakeLock = useCallback(async () => {
    if (!wakeLockSupported()) {
      setWakeLockOk(false);
      return;
    }
    const handle = await requestWakeLock();
    lock.current = handle;
    setWakeLockOk(handle !== null);
  }, []);

  const releaseWakeLock = useCallback(() => {
    const l = lock.current;
    lock.current = null;
    if (l) void l.release().catch(() => undefined);
  }, []);

  // iOS suspends the interval in the background; on return, catch up from timestamps
  // and ask for the wake lock again (the browser dropped it when the page hid).
  useEffect(() => {
    const resync = () => {
      const s = stateRef.current;
      if (s.status !== "running" && s.status !== "paused") return;
      advance(true);
      if (document.visibilityState === "visible") void askWakeLock();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") resync();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", resync);
    window.addEventListener("focus", resync);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", resync);
      window.removeEventListener("focus", resync);
    };
  }, [advance, askWakeLock]);

  useEffect(() => {
    if (state.status === "finished") releaseWakeLock();
  }, [state.status, releaseWakeLock]);
  useEffect(() => releaseWakeLock, [releaseWakeLock]);

  // Each action runs in a tap, so unlockAudio is inside the user gesture iOS needs.
  const actions = useMemo(
    () => ({
      start: () => {
        setSoundOff(!unlockAudio());
        setNotice(null);
        const t = Date.now();
        const next = startRun(stateRef.current, steps, t);
        setNow(t);
        commit(next);
        if (steps[0]?.type === "work") cue("work");
        void askWakeLock();
      },
      pause: () => commit(pauseRun(stateRef.current, steps, Date.now())),
      resume: () => {
        setSoundOff(!unlockAudio());
        const t = Date.now();
        setNow(t);
        commit(resumeRun(stateRef.current, t));
        void askWakeLock();
      },
      skip: () => {
        const t = Date.now();
        setNow(t);
        const next = skipStep(stateRef.current, steps, t);
        if (next.status === "running" || next.status === "paused") {
          cue(steps[next.index]?.type === "work" ? "work" : "change");
          setFlashKey((k) => k + 1);
        }
        commit(next);
      },
      lap: () => {
        const t = Date.now();
        setNow(t);
        const next = lapStep(stateRef.current, steps, t);
        if (next !== stateRef.current) {
          cue(next.status === "running" && steps[next.index]?.type === "work" ? "work" : "change");
          setFlashKey((k) => k + 1);
        }
        commit(next);
      },
      extend: (seconds: number) => {
        const t = Date.now();
        setNow(t);
        commit(extendStep(stateRef.current, steps, seconds, t));
      },
      finish: () => commit(finishRun(stateRef.current, steps, Date.now())),
      soundOn: () => setSoundOff(!unlockAudio()),
      dismissPassed: () => setPassed(0),
      discardSaved: () => {
        setNotice(null);
        writeSaved(stateRef.current);
      },
    }),
    [steps, commit, cue, askWakeLock],
  );

  return { state, now, restored, notice, passed, flashKey, soundOff, wakeLockOk, actions };
}
