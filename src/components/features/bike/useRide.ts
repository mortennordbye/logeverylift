"use client";

/**
 * Ride mode's clock and sync (docs/plans/bike-ride-logger.md, 4.3 to 4.5).
 *
 * The server keeps the ride; `rideTimeline` works out the clock from its plan
 * and events, here as on the server. Server time is the clock: each reply
 * gives the offset of this phone's clock. A tap becomes an event with a
 * client id and the time it happened. It applies on screen at once, waits in
 * a queue that survives a reload (localStorage), and goes to `sendRideEvent`
 * in order. Offline, or with a stale bundle after a deploy, it stays queued
 * and replays later with its own time; it is never dropped for that. The
 * guided player's pattern does the rest: a short interval repaints, the app
 * resyncs when it comes back to the front, the wake lock and the audio unlock
 * happen inside a tap, and a beep sounds in the last 3 seconds.
 */

import { getRide, sendRideEvent, type RideView } from "@/lib/actions/rides";
import { playCue, unlockAudio } from "@/lib/audio-cues";
import { haptics } from "@/lib/utils/haptics";
import { RIDE_CONFLICT, rideTimeline, type RideStepResult, type RideTimeline } from "@/lib/utils/ride-timeline";
import { stepSignature, stepsToSave, withQueued, type QueuedRideEvent, type RideTap } from "@/lib/utils/ride-screen";
import { callAction, failedInTransit } from "@/lib/utils/stale-bundle";
import { requestWakeLock, wakeLockSupported, type WakeLockHandle } from "@/lib/wake-lock";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** How often the screen repaints: a cue is never later than this. */
export const RIDE_TICK_MS = 250;
/** The visible app tells the server it is there (4.7: no push while it is). */
export const HEARTBEAT_MS = 10_000;
/** A queued event waits this long before the next try, unless the phone comes online first. */
export const RIDE_RETRY_MS = 30_000;
/** Opened by a tap within this long (Start ride, Resume): no Resume prompt. */
const ARMED_MS = 30_000;

export const RIDE_QUEUE_KEY = "rideEventQueue";
export const RIDE_SAVED_KEY = "rideSavedSteps";

export type { RideTap, QueuedRideEvent };

// ── Storage ──────────────────────────────────────────────────────────────────

function readMap<T>(key: string): Record<string, T> {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** Write one ride's entry; `only` drops the other rides' entries, so the key does not grow. */
function writeEntry<T>(key: string, rideId: number, value: T | null, only = false) {
  try {
    const all = only ? {} : readMap<T>(key);
    if (value === null) delete all[rideId];
    else all[rideId] = value;
    if (Object.keys(all).length) localStorage.setItem(key, JSON.stringify(all));
    else localStorage.removeItem(key);
  } catch {
    // Private mode or full storage: the ride still runs, it only cannot survive a reload.
  }
}

export function readQueuedEvents(rideId: number): QueuedRideEvent[] {
  const q = readMap<QueuedRideEvent[]>(RIDE_QUEUE_KEY)[rideId];
  return Array.isArray(q) ? q : [];
}

// ── Taps that arm the ride: audio and the wake lock need a user gesture ─────

let armedAt = 0;
let lock: WakeLockHandle | null = null;

async function keepAwake(): Promise<boolean> {
  if (!wakeLockSupported()) return false;
  const handle = await requestWakeLock();
  const old = lock;
  lock = handle;
  if (old && old !== handle) void old.release().catch(() => undefined);
  return handle !== null;
}

function letSleep() {
  const l = lock;
  lock = null;
  if (l) void l.release().catch(() => undefined);
}

/** Call inside the tap that opens ride mode (Start ride, Resume): unlocks sound and keeps the screen on. */
export function armRide(): boolean {
  armedAt = Date.now();
  const sound = unlockAudio();
  void keepAwake();
  return sound;
}

/** Not cleared on read: React runs a mount effect twice in development. A reload clears it. */
function armedJustNow(): boolean {
  return armedAt > 0 && Date.now() - armedAt < ARMED_MS;
}

function newClientId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const isLive = (t: Pick<RideTimeline, "status">) => t.status === "running" || t.status === "paused";

export function useRide(opts: { initial: RideView; saveStep: (r: RideStepResult) => void }) {
  const { initial } = opts;
  const rideId = initial.ride.id;
  const saveStep = useRef(opts.saveStep);
  useEffect(() => {
    saveStep.current = opts.saveStep;
  });

  const [view, setView] = useState<RideView>(initial);
  const viewRef = useRef(initial);
  const [queue, setQueue] = useState<QueuedRideEvent[]>([]);
  const queueRef = useRef<QueuedRideEvent[]>([]);
  // Server time minus this phone's time. The first render uses the server's
  // own time, so the server HTML and the first client render agree.
  const [offset, setOffset] = useState(0);
  const offsetRef = useRef(0);
  const [clientNow, setClientNow] = useState(initial.serverNow);
  const [ready, setReady] = useState(false);
  /** Opened on a running ride without a tap (a reload, the app reopened): Resume or End at the last step. */
  const [prompt, setPrompt] = useState(false);
  const [online, setOnline] = useState(true);
  /** An event did not reach the server: it waits on this phone. */
  const [unsent, setUnsent] = useState(false);
  const [soundOff, setSoundOff] = useState(false);
  const savedRef = useRef<Record<string, string>>({});
  const mounted = useRef(true);

  const serverNow = ready ? clientNow + offset : initial.serverNow;
  const events = useMemo(() => withQueued(view, queue, serverNow), [view, queue, serverNow]);
  const timeline = useMemo(
    () => rideTimeline(view.plan, events, serverNow, { heartbeatAt: view.ride.heartbeatAt }),
    [view.plan, view.ride.heartbeatAt, events, serverNow],
  );
  const timelineRef = useRef(timeline);
  useEffect(() => {
    timelineRef.current = timeline;
  });

  const setQueued = useCallback(
    (next: QueuedRideEvent[]) => {
      queueRef.current = next;
      setQueue(next);
      writeEntry(RIDE_QUEUE_KEY, rideId, next.length ? next : null);
    },
    [rideId],
  );

  /** Take a reply: its ride and the clock offset. An older reply than what is on screen only moves the clock. */
  const applyView = useCallback(
    (v: RideView) => {
      if (v.ride.id !== rideId || !mounted.current) return;
      const off = v.serverNow - Date.now();
      offsetRef.current = off;
      setOffset(off);
      setClientNow(Date.now());
      if (v.ride.seq < viewRef.current.ride.seq) return;
      viewRef.current = v;
      setView(v);
      const stored = new Set(v.events.map((e) => e.clientId));
      if (queueRef.current.some((q) => stored.has(q.clientId))) setQueued(queueRef.current.filter((q) => !stored.has(q.clientId)));
    },
    [rideId, setQueued],
  );

  const refetch = useCallback(async () => {
    const r = await callAction(getRide({ rideId }));
    if (r.success && r.data) applyView(r.data);
    return r;
  }, [rideId, applyView]);

  /** Send the queued events in order, one at a time. */
  const flushing = useRef(false);
  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      let conflicts = 0;
      for (;;) {
        const q = queueRef.current[0];
        if (!q) {
          setUnsent(false);
          break;
        }
        if (typeof navigator !== "undefined" && navigator.onLine === false) {
          setUnsent(true);
          break;
        }
        const res = await callAction(
          sendRideEvent({ rideId, clientId: q.clientId, kind: q.kind, value: q.value, clientAt: q.clientAt, expectedSeq: viewRef.current.ride.seq }),
        );
        if (res.success) {
          applyView(res.data);
          setQueued(queueRef.current.filter((x) => x.clientId !== q.clientId));
          conflicts = 0;
          continue;
        }
        // Offline, cut off, or a stale bundle (callAction reloads for the new
        // one): it stays queued, and the next page or try sends it.
        if (failedInTransit(res)) {
          setUnsent(true);
          break;
        }
        // Another device sent an event first: read the ride and send again.
        if (res.error === RIDE_CONFLICT && conflicts++ < 3) {
          await refetch();
          continue;
        }
        // The server refused it for good (the ride has ended): show the ride as it has it.
        setQueued(queueRef.current.filter((x) => x.clientId !== q.clientId));
        await refetch();
      }
    } finally {
      flushing.current = false;
    }
  }, [rideId, applyView, setQueued, refetch]);

  // Mount: the queue and saved steps of this phone, the clock, and a fresh read.
  useEffect(() => {
    mounted.current = true;
    const queued = readQueuedEvents(rideId);
    queueRef.current = queued;
    savedRef.current = readMap<Record<string, string>>(RIDE_SAVED_KEY)[rideId] ?? {};
    const off = initial.serverNow - Date.now();
    offsetRef.current = off;
    setQueue(queued);
    setOffset(off);
    setClientNow(Date.now());
    setOnline(typeof navigator === "undefined" || navigator.onLine !== false);
    setPrompt(initial.ride.status === "running" && !armedJustNow());
    setReady(true);
    void refetch().then(() => flush());
    return () => {
      mounted.current = false;
      // Left ride mode: let the screen sleep. Not on React's test remount in development.
      setTimeout(() => {
        if (!mounted.current) letSleep();
      }, 0);
    };
    // Once per ride.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rideId]);

  const live = isLive(timeline);

  // Repaint while the ride runs.
  useEffect(() => {
    if (!ready || !live) return;
    const id = setInterval(() => setClientNow(Date.now()), RIDE_TICK_MS);
    return () => clearInterval(id);
  }, [ready, live]);

  // Heartbeat while visible, which also brings another device's taps.
  useEffect(() => {
    if (!ready || !live) return;
    const beat = async () => {
      if (document.visibilityState !== "visible") return;
      const r = await callAction(sendRideEvent({ rideId, clientId: newClientId(), kind: "heartbeat", expectedSeq: viewRef.current.ride.seq }));
      if (r.success) applyView(r.data);
      else if (!failedInTransit(r)) await refetch();
      if (queueRef.current.length) void flush();
    };
    const id = setInterval(() => void beat(), HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [ready, live, rideId, applyView, refetch, flush]);

  // Online again, or every 30 s while something waits: send the queue.
  useEffect(() => {
    const on = () => {
      setOnline(true);
      void flush();
    };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [flush]);
  useEffect(() => {
    if (!unsent) return;
    const id = setInterval(() => void flush(), RIDE_RETRY_MS);
    return () => clearInterval(id);
  }, [unsent, flush]);

  // Back in front after iOS suspended the app: read the ride, send the queue, keep the screen on.
  useEffect(() => {
    const resync = () => {
      if (document.visibilityState !== "visible") return;
      setClientNow(Date.now());
      void refetch().then(() => flush());
      if (lock && isLive(timelineRef.current)) void keepAwake();
    };
    document.addEventListener("visibilitychange", resync);
    window.addEventListener("pageshow", resync);
    return () => {
      document.removeEventListener("visibilitychange", resync);
      window.removeEventListener("pageshow", resync);
    };
  }, [refetch, flush]);

  // Save each step when it ends, once: again only when its values change (an
  // undo, another device). The upsert on session and program set makes a
  // second save from a reload or another phone the same row.
  useEffect(() => {
    if (!ready) return;
    const due = stepsToSave(timeline.steps, savedRef.current);
    if (!due.length) return;
    for (const r of due) {
      saveStep.current(r);
      savedRef.current = { ...savedRef.current, [r.programSetId]: stepSignature(r) };
    }
    writeEntry(RIDE_SAVED_KEY, rideId, savedRef.current, true);
  }, [ready, timeline.steps, rideId]);

  // Cues: a sound at each step change, and at 3, 2 and 1 seconds left.
  const lastIndex = useRef<number | null>(null);
  const lastCount = useRef<number | null>(null);
  const cue = useCallback((kind: "count" | "change" | "work") => {
    setSoundOff(!playCue(kind));
    if (kind !== "count") haptics.tap();
  }, []);
  useEffect(() => {
    if (!ready) return;
    const cur = timeline.current;
    const idx = cur?.index ?? null;
    if (lastIndex.current !== null && idx !== lastIndex.current && idx !== null && !prompt) {
      cue(view.plan.steps[idx]?.step.type === "work" ? "work" : "change");
    }
    lastIndex.current = idx;
    const rem = timeline.status === "running" ? (cur?.remainingSeconds ?? null) : null;
    if (rem !== null && rem >= 1 && rem <= 3 && rem !== lastCount.current && !prompt) cue("count");
    lastCount.current = rem;
  }, [ready, timeline, view.plan.steps, cue, prompt]);

  useEffect(() => {
    if (ready && !live) letSleep();
  }, [ready, live]);

  /** Queue a tap and send it. */
  const tap = useCallback(
    (kind: RideTap, value?: number, clientAt?: number) => {
      const at = Math.round(clientAt ?? Date.now() + offsetRef.current);
      setQueued([...queueRef.current, { clientId: newClientId(), kind, ...(value !== undefined && { value }), clientAt: at }]);
      setClientNow(Date.now());
      void flush();
    },
    [setQueued, flush],
  );

  const actions = useMemo(
    () => ({
      pause: () => tap("pause"),
      resume: () => {
        setSoundOff(!unlockAudio());
        void keepAwake();
        tap("resume");
      },
      /** `index` is the step on screen at the tap: a step already closed is not skipped again. */
      skip: (index: number) => {
        if (timelineRef.current.current?.index !== index) return false;
        tap("skip");
        return true;
      },
      unskip: () => tap("unskip"),
      extend: (seconds: 60 | -60) => tap("extend", seconds),
      nudge: (watts: 5 | -5) => tap("nudge", watts),
      lap: () => tap("lap"),
      end: () => tap("end"),
      /** The Resume prompt after a reload: sound and the wake lock need this tap. */
      carryOn: () => {
        setSoundOff(!unlockAudio());
        void keepAwake();
        setPrompt(false);
      },
      /** End at the last step: the step that runs is left out, as far as the server allows. */
      endAtLastStep: () => {
        setPrompt(false);
        tap("end", undefined, timelineRef.current.current?.startedAt);
      },
      soundOn: () => setSoundOff(!unlockAudio()),
    }),
    [tap],
  );

  return { view, events, timeline, serverNow, ready, prompt, online, unsent, queued: queue.length, soundOff, actions };
}
