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
import { RIDE_CONFLICT, planSport, rideTimeline, type RideStepResult, type RideTimeline } from "@/lib/utils/ride-timeline";
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
/** A step back of the clock smaller than this is held (latency), a larger one applies. */
const HOLD_BACK_MS = 2_000;
/** A reply moves the clock only when it is a better measure, or the clocks differ by more than this. */
const OFFSET_SLACK_MS = 500;
/** Answers that mean the server will never take the tap: it leaves the queue. Any other failure keeps it. */
const REFUSED_FOR_GOOD = new Set(["The ride has ended", "Not found", "Invalid input"]);

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

/**
 * Write this tab's queue, read-modify-write: taps another tab of the same
 * ride stored since stay, unless this tab sent them (`gone`). Returns the
 * merged queue, in the order the taps happened.
 */
function writeQueue(rideId: number, mine: QueuedRideEvent[], gone: Set<string>): QueuedRideEvent[] {
  const ids = new Set(mine.map((q) => q.clientId));
  const others = readQueuedEvents(rideId).filter((q) => !ids.has(q.clientId) && !gone.has(q.clientId));
  const merged = [...mine, ...others].sort((a, b) => a.clientAt - b.clientAt);
  writeEntry(RIDE_QUEUE_KEY, rideId, merged.length ? merged : null);
  return merged;
}

/**
 * Send a ride's taps still waiting on this phone, in order, from outside ride
 * mode: "End ride and start run" (docs/plans/run-logger.md, 4.3) sends them
 * before the ride ends. True when none is left on this phone.
 */
export async function sendQueuedEvents(rideId: number): Promise<boolean> {
  if (!readQueuedEvents(rideId).length) return true;
  const read = async () => {
    const r = await callAction(getRide({ rideId }));
    return r.success && r.data ? r.data : null;
  };
  let view = await read();
  if (!view) return false;
  const gone = new Set<string>();
  for (const q of readQueuedEvents(rideId)) {
    if (view.events.some((e) => e.clientId === q.clientId)) {
      gone.add(q.clientId);
      continue;
    }
    const send = (seq: number) =>
      callAction(sendRideEvent({ rideId, clientId: q.clientId, kind: q.kind, value: q.value, clientAt: q.clientAt, stepKey: q.stepKey, expectedSeq: seq }));
    let res = await send(view.ride.seq);
    // Another device sent an event first: read the ride and send again.
    if (!res.success && !failedInTransit(res) && res.error === RIDE_CONFLICT) {
      const again = await read();
      if (again) {
        view = again;
        res = await send(view.ride.seq);
      }
    }
    if (res.success) view = res.data;
    else if (failedInTransit(res) || !REFUSED_FOR_GOOD.has(res.error)) break;
    gone.add(q.clientId);
  }
  return writeQueue(rideId, [], gone).length === 0;
}

// ── Taps that arm the ride: audio and the wake lock need a user gesture ─────

let armedAt = 0;
let lock: WakeLockHandle | null = null;
/** False once the screen may sleep again: a lock that arrives after that is let go at once. */
let wanted = false;

async function keepAwake(): Promise<boolean> {
  if (!wakeLockSupported()) return false;
  wanted = true;
  const handle = await requestWakeLock();
  if (!wanted) {
    if (handle) void handle.release().catch(() => undefined);
    return false;
  }
  const old = lock;
  lock = handle;
  if (old && old !== handle) void old.release().catch(() => undefined);
  return handle !== null;
}

function letSleep() {
  wanted = false;
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

/** Start ride failed: nothing to keep the screen on for. */
export function disarmRide() {
  armedAt = 0;
  letSleep();
}

/** Not cleared on read: React runs a mount effect twice in development. A reload clears it. */
function armedJustNow(): boolean {
  return armedAt > 0 && Date.now() - armedAt < ARMED_MS;
}

function newClientId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const isLive = (t: Pick<RideTimeline, "status">) => t.status === "running" || t.status === "paused";

export function useRide(opts: { initial: RideView; saveStep: (r: RideStepResult) => void; unsaveStep: (programSetId: number) => void }) {
  const { initial } = opts;
  const rideId = initial.ride.id;
  const saveStep = useRef(opts.saveStep);
  const unsaveStep = useRef(opts.unsaveStep);
  useEffect(() => {
    saveStep.current = opts.saveStep;
    unsaveStep.current = opts.unsaveStep;
  });

  const [view, setView] = useState<RideView>(initial);
  const viewRef = useRef(initial);
  const [queue, setQueue] = useState<QueuedRideEvent[]>([]);
  const queueRef = useRef<QueuedRideEvent[]>([]);
  // Server time minus this phone's time. The first render uses the server's
  // own time, so the server HTML and the first client render agree.
  const offsetRef = useRef(0);
  // Server time now. It never goes back: a reply that moves the offset back
  // holds the clock until it catches up, so a step never shows a second twice.
  const [serverNowState, setServerNow] = useState(initial.serverNow);
  const floorRef = useRef(0);
  /** The round trip of the reply the offset came from: a quicker reply is a better measure. */
  const bestRtt = useRef(Infinity);
  const [ready, setReady] = useState(false);
  /** Opened on a running ride without a tap (a reload, the app reopened): Resume or End at the last step. */
  const [prompt, setPrompt] = useState(false);
  const [online, setOnline] = useState(true);
  /** An event did not reach the server: it waits on this phone. */
  const [unsent, setUnsent] = useState(false);
  const [soundOff, setSoundOff] = useState(false);
  const savedRef = useRef<Record<string, string>>({});
  const mounted = useRef(true);

  const serverNow = ready ? serverNowState : initial.serverNow;
  const events = useMemo(() => withQueued(view, queue, serverNow), [view, queue, serverNow]);
  const timeline = useMemo(
    () => rideTimeline(view.plan, events, serverNow, { heartbeatAt: view.ride.heartbeatAt }),
    [view.plan, view.ride.heartbeatAt, events, serverNow],
  );
  const timelineRef = useRef(timeline);
  useEffect(() => {
    timelineRef.current = timeline;
  });

  /**
   * Server time now by this phone's clock. A small step back (a reply's
   * latency) holds the clock until it catches up, so a step never shows a
   * second twice; a large one is a real correction and applies.
   */
  const tickNow = useCallback(() => {
    const raw = Date.now() + offsetRef.current;
    const t = raw < floorRef.current && floorRef.current - raw < HOLD_BACK_MS ? floorRef.current : raw;
    floorRef.current = t;
    setServerNow(t);
    return t;
  }, []);

  /** Set the queue; `gone` are taps the server has (or refused), which leave the stored queue too. */
  const setQueued = useCallback(
    (next: QueuedRideEvent[], gone: string[] = []) => {
      const merged = writeQueue(rideId, next, new Set(gone));
      queueRef.current = merged;
      setQueue(merged);
    },
    [rideId],
  );

  /**
   * Take a reply: its ride and the clock offset. `sentAt` is when the request
   * left: the server's time sits about half the round trip before the answer.
   * The offset moves only for a quicker round trip than the best so far, or
   * when the clocks differ by more than the slack. An older reply than what
   * is on screen only moves the clock.
   */
  const applyView = useCallback(
    (v: RideView, sentAt?: number) => {
      if (v.ride.id !== rideId || !mounted.current) return;
      const got = Date.now();
      const rtt = sentAt === undefined ? Infinity : got - sentAt;
      const off = v.serverNow - (sentAt === undefined ? got : (sentAt + got) / 2);
      if (rtt < bestRtt.current || Math.abs(off - offsetRef.current) > Math.max(OFFSET_SLACK_MS, Number.isFinite(rtt) ? rtt : 0)) {
        if (rtt < bestRtt.current) bestRtt.current = rtt;
        offsetRef.current = off;
      }
      tickNow();
      if (v.ride.seq < viewRef.current.ride.seq) return;
      viewRef.current = v;
      setView(v);
      const stored = new Set(v.events.map((e) => e.clientId));
      const done = queueRef.current.filter((q) => stored.has(q.clientId)).map((q) => q.clientId);
      if (done.length) setQueued(queueRef.current.filter((q) => !stored.has(q.clientId)), done);
    },
    [rideId, setQueued, tickNow],
  );

  const refetch = useCallback(async () => {
    const sentAt = Date.now();
    const r = await callAction(getRide({ rideId }));
    if (r.success && r.data) applyView(r.data, sentAt);
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
        const sentAt = Date.now();
        const res = await callAction(
          sendRideEvent({ rideId, clientId: q.clientId, kind: q.kind, value: q.value, clientAt: q.clientAt, stepKey: q.stepKey, expectedSeq: viewRef.current.ride.seq }),
        );
        if (res.success) {
          applyView(res.data, sentAt);
          setQueued(queueRef.current.filter((x) => x.clientId !== q.clientId), [q.clientId]);
          conflicts = 0;
          continue;
        }
        // Another device sent an event first: read the ride and send again.
        if (!failedInTransit(res) && res.error === RIDE_CONFLICT && conflicts++ < 3) {
          await refetch();
          continue;
        }
        // The server refused it for good (the ride has ended): show the ride as it has it.
        if (!failedInTransit(res) && REFUSED_FOR_GOOD.has(res.error)) {
          setQueued(queueRef.current.filter((x) => x.clientId !== q.clientId), [q.clientId]);
          await refetch();
          continue;
        }
        // Offline, cut off, a stale bundle (callAction reloads for the new
        // one), a server error or conflicts that go on: it stays queued, and
        // the next try or page sends it.
        setUnsent(true);
        break;
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
    tickNow();
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
    const id = setInterval(tickNow, RIDE_TICK_MS);
    return () => clearInterval(id);
  }, [ready, live, tickNow]);

  // Heartbeat while visible, which also brings another device's taps.
  useEffect(() => {
    if (!ready || !live) return;
    const beat = async () => {
      if (document.visibilityState !== "visible") return;
      // Queued taps first: the server never places an event before its last
      // heartbeat, so a heartbeat ahead of them would move them to now.
      if (queueRef.current.length) {
        void flush();
        return;
      }
      const sentAt = Date.now();
      const r = await callAction(sendRideEvent({ rideId, clientId: newClientId(), kind: "heartbeat", expectedSeq: viewRef.current.ride.seq }));
      if (r.success) applyView(r.data, sentAt);
      else if (!failedInTransit(r)) await refetch();
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
      tickNow();
      void refetch().then(() => flush());
      if (lock && isLive(timelineRef.current)) void keepAwake();
    };
    document.addEventListener("visibilitychange", resync);
    window.addEventListener("pageshow", resync);
    return () => {
      document.removeEventListener("visibilitychange", resync);
      window.removeEventListener("pageshow", resync);
    };
  }, [refetch, flush, tickNow]);

  // Save each step when it ends, once: again only when its values change (an
  // undo, another device). The upsert on session and program set makes a
  // second save from a reload or another phone the same row.
  // A saved step that is no longer ended (an undone skip) loses its row: it
  // saves again when it ends.
  useEffect(() => {
    if (!ready) return;
    const due = stepsToSave(timeline.steps, savedRef.current);
    const ended = new Set(timeline.steps.map((r) => String(r.programSetId)));
    const stale = Object.keys(savedRef.current).filter((id) => !ended.has(id));
    if (!due.length && !stale.length) return;
    const next = { ...savedRef.current };
    for (const id of stale) {
      unsaveStep.current(Number(id));
      delete next[id];
    }
    for (const r of due) {
      saveStep.current(r);
      next[r.programSetId] = stepSignature(r);
    }
    savedRef.current = next;
    writeEntry(RIDE_SAVED_KEY, rideId, savedRef.current, true);
  }, [ready, timeline.steps, rideId]);

  // Cues: a sound at each step change, and at 3, 2 and 1 seconds left.
  const lastIndex = useRef<number | null>(null);
  /** The counts already played, as "step:seconds": each beeps once. */
  const counted = useRef(new Set<string>());
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
    const key = `${idx}:${cur?.startedAt}:${rem}`;
    if (rem !== null && rem >= 1 && rem <= 3 && !counted.current.has(key) && !prompt) {
      counted.current.add(key);
      cue("count");
    }
  }, [ready, timeline, view.plan.steps, cue, prompt]);

  useEffect(() => {
    if (ready && !live) letSleep();
  }, [ready, live]);

  /** Queue a tap and send it. A run's tap carries the step on screen, so a late replay into another step is ignored (4.4). */
  const tap = useCallback(
    (kind: RideTap, value?: number, clientAt?: number) => {
      const at = Math.round(clientAt ?? tickNow());
      const cur = timelineRef.current.current;
      const stepKey = planSport(viewRef.current.plan) === "run" && cur ? viewRef.current.plan.steps[cur.index]?.key : undefined;
      setQueued([...queueRef.current, { clientId: newClientId(), kind, ...(value !== undefined && { value }), clientAt: at, ...(stepKey !== undefined && { stepKey }) }]);
      tickNow();
      void flush();
    },
    [setQueued, flush, tickNow],
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
      /** A run's short-step block (4.5): skip the rest of the block. */
      skipBlock: (index: number) => {
        if (timelineRef.current.current?.index !== index) return false;
        tap("skip", 1);
        return true;
      },
      unskip: () => tap("unskip"),
      /** A run on a treadmill (4.4): the new belt in tenths of km/h, the new incline in tenths of %. */
      belt: (tenths: number, clientAt?: number) => tap("belt", tenths, clientAt),
      incline: (tenths: number, clientAt?: number) => tap("incline", tenths, clientAt),
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
