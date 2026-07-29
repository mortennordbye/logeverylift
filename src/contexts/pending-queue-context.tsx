"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useToast } from "@/contexts/toast-context";
import { logWorkoutSet, unlogWorkoutSet } from "@/lib/actions/workout-sets";
import { completeWorkoutSession } from "@/lib/actions/workout-sessions";
import { updateProgramSet } from "@/lib/actions/programs";
import { isStaleBundleError, reloadForFreshBundle } from "@/lib/utils/stale-bundle";

/**
 * Offline mutation queue.
 *
 * When a Server Action fails (no signal, server hiccup, transient 5xx),
 * the calling code can hand the mutation to this queue instead of dropping
 * it. The queue:
 *
 *   - persists to localStorage so a refresh during the offline window
 *     doesn't lose anything,
 *   - replays automatically on the next `online` event,
 *   - exposes a count so the UI can surface "you have N pending writes".
 *
 * Scope is deliberately narrow — only the writes that make up a workout
 * participate: `logWorkoutSet`, `unlogWorkoutSet`, `completeWorkoutSession`,
 * and `updateProgramSet`, which is here solely because finishing a workout
 * flushes the session's weight/rep overrides back to the program template.
 * Ordinary profile / program edits still fail loudly via the existing toast
 * and are extremely unlikely to be done while offline.
 *
 * Limitation: if the user closes the app while offline, in-memory replay
 * doesn't fire. localStorage still holds the queue, so reopening the app
 * (still offline or online) replays. If the user clears storage / goes to
 * a fresh device while still offline, queued mutations are lost. Toast
 * messaging makes this risk visible.
 */

type LogPayload = Parameters<typeof logWorkoutSet>[0];
type UnlogPayload = Parameters<typeof unlogWorkoutSet>[0];
type CompletePayload = Parameters<typeof completeWorkoutSession>[0];
type UpdateProgramSetPayload = Parameters<typeof updateProgramSet>[0];

type QueuedMutation =
  | { id: string; kind: "logWorkoutSet"; payload: LogPayload; queuedAt: number; attempts?: number; nextAttemptAt?: number }
  | { id: string; kind: "unlogWorkoutSet"; payload: UnlogPayload; queuedAt: number; attempts?: number; nextAttemptAt?: number }
  | { id: string; kind: "updateProgramSet"; payload: UpdateProgramSetPayload; queuedAt: number; attempts?: number; nextAttemptAt?: number }
  | { id: string; kind: "completeWorkoutSession"; payload: CompletePayload; queuedAt: number; attempts?: number; nextAttemptAt?: number };

const STORAGE_KEY = "pendingMutationQueue";

// Drop a queued mutation after this many failed replays. Permanent failures
// (validation errors, unique violations the server can't recover from) would
// otherwise loop on every `online` event forever.
const MAX_ATTEMPTS = 5;

// Wait this long before retrying an item, indexed by attempts already made.
// Without a delay the five attempts are spent in a fraction of a second: a
// failed replay bumps `attempts`, which used to re-trigger the replay, which
// failed again — so a server blip lasting seconds (pods restarting mid-deploy)
// drained the whole budget and dropped the user's sets while the device was
// still online. Spread this way the budget lasts ~17 minutes, which outlives a
// rolling deploy.
const BACKOFF_MS = [5_000, 30_000, 120_000, 300_000, 600_000];

type PendingQueueContextValue = {
  count: number;
  enqueue: (mutation: Omit<QueuedMutation, "id" | "queuedAt">) => void;
  replayAll: () => Promise<void>;
};

const PendingQueueContext = createContext<PendingQueueContextValue | null>(null);

export function PendingQueueProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<QueuedMutation[]>([]);
  const replayingRef = useRef(false);
  // Mirrors `queue` so replayAll can read the current queue without depending
  // on it (see the comment in replayAll).
  const queueRef = useRef<QueuedMutation[]>([]);
  const { showToast } = useToast();

  // Hydrate from localStorage on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        setQueue(JSON.parse(raw) as QueuedMutation[]);
      }
    } catch {
      // Corrupt storage — clear it and move on.
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  // Persist on every change, and keep the ref in step.
  useEffect(() => {
    queueRef.current = queue;
    if (typeof window === "undefined") return;
    if (queue.length === 0) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
    }
  }, [queue]);

  const enqueue = useCallback(
    (mutation: Omit<QueuedMutation, "id" | "queuedAt">) => {
      const next: QueuedMutation = {
        ...(mutation as Omit<QueuedMutation, "id" | "queuedAt">),
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        queuedAt: Date.now(),
      } as QueuedMutation;
      setQueue((prev) => [...prev, next]);
    },
    [],
  );

  const replayAll = useCallback(async () => {
    if (replayingRef.current) return;
    replayingRef.current = true;
    try {
      // Snapshot the queue at start; new enqueues during replay stay for next
      // pass. Read through the ref rather than closing over `queue` — a
      // dependency on the queue gave this callback a new identity on every
      // mutation, including the one that bumps `attempts`, which re-fired the
      // effect below and burned the whole retry budget in a tight loop.
      const due = Date.now();
      const snapshot = queueRef.current.filter(
        (m) => (m.nextAttemptAt ?? 0) <= due,
      );
      if (snapshot.length === 0) return;

      const failed: QueuedMutation[] = [];
      const dropped: QueuedMutation[] = [];
      let staleBundleSeen = false;
      for (const m of snapshot) {
        let ok = false;
        try {
          // Replayed in queue order, so a log followed by an un-log of the
          // same set resolves to "not logged", matching what the user did.
          const result =
            m.kind === "logWorkoutSet"
              ? await logWorkoutSet(m.payload)
              : m.kind === "unlogWorkoutSet"
                ? await unlogWorkoutSet(m.payload)
                : m.kind === "updateProgramSet"
                  ? await updateProgramSet(m.payload)
                  : await completeWorkoutSession(m.payload);
          ok = result.success;
        } catch (err) {
          if (isStaleBundleError(err)) {
            // Whole replay batch is doomed — every queued action will hit
            // the same stale-bundle error. Stop, keep them queued (with
            // unincremented attempts), reload so the new bundle picks up.
            staleBundleSeen = true;
            failed.push(m);
            continue;
          }
          ok = false;
        }
        if (ok) continue;
        const nextAttempts = (m.attempts ?? 0) + 1;
        if (nextAttempts >= MAX_ATTEMPTS) {
          dropped.push(m);
        } else {
          const delay = BACKOFF_MS[nextAttempts - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
          failed.push({
            ...m,
            attempts: nextAttempts,
            nextAttemptAt: Date.now() + delay,
          } as QueuedMutation);
        }
      }

      if (staleBundleSeen) {
        // Persist the queue as-is, then reload — the new bundle will replay
        // these on next mount.
        setQueue((prev) => prev);
        showToast({
          message: "App updating — refreshing…",
          durationMs: 3000,
        });
        void reloadForFreshBundle();
        return;
      }

      // Drop the snapshot, keep failed ones (with bumped attempt counts)
      // + anything enqueued during replay. Dropped ones disappear silently
      // from the queue but we surface a toast so the user knows.
      setQueue((prev) => {
        const failedById = new Map(failed.map((m) => [m.id, m]));
        const replayedIds = new Set(snapshot.map((m) => m.id));
        return prev.flatMap((m) => {
          if (!replayedIds.has(m.id)) return [m];
          const updated = failedById.get(m.id);
          return updated ? [updated] : [];
        });
      });

      const succeeded = snapshot.length - failed.length - dropped.length;
      if (succeeded > 0) {
        showToast({
          message:
            succeeded === 1
              ? "Synced 1 pending set"
              : `Synced ${succeeded} pending sets`,
        });
      }
      if (dropped.length > 0) {
        showToast({
          variant: "error",
          durationMs: 8000,
          message:
            dropped.length === 1
              ? "1 pending change couldn't be saved and was dropped"
              : `${dropped.length} pending changes couldn't be saved and were dropped`,
        });
      }
    } finally {
      replayingRef.current = false;
    }
  }, [showToast]);

  // Replay on `online` and on mount if the network is up. replayAll is stable,
  // so this registers once.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => void replayAll();
    window.addEventListener("online", handler);
    if (navigator.onLine) void replayAll();
    return () => {
      window.removeEventListener("online", handler);
    };
  }, [replayAll]);

  // Drive the queue as it changes: replay anything already due, otherwise wake
  // up when the soonest backed-off item comes due. This is what lets a
  // transient failure recover on its own instead of waiting for the user to
  // lose and regain connectivity, and it covers the mount case — the effect
  // above fires before the localStorage hydration lands, so on a cold open
  // with a full queue it would otherwise find nothing.
  //
  // This cannot spin the way the old queue-triggered replay did: every item a
  // failed pass keeps is stamped with a future nextAttemptAt, so the resulting
  // queue change finds nothing due and only schedules a timer.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (queue.length === 0) return;
    const now = Date.now();
    if (queue.some((m) => (m.nextAttemptAt ?? 0) <= now)) {
      if (navigator.onLine) void replayAll();
      return;
    }
    const soonest = queue.reduce<number>(
      (acc, m) => Math.min(acc, m.nextAttemptAt ?? 0),
      Number.POSITIVE_INFINITY,
    );
    const timer = setTimeout(() => void replayAll(), soonest - now);
    return () => clearTimeout(timer);
  }, [queue, replayAll]);

  return (
    <PendingQueueContext.Provider value={{ count: queue.length, enqueue, replayAll }}>
      {children}
    </PendingQueueContext.Provider>
  );
}

export function usePendingQueue(): PendingQueueContextValue {
  const ctx = useContext(PendingQueueContext);
  if (!ctx) throw new Error("usePendingQueue must be used within PendingQueueProvider");
  return ctx;
}

/**
 * Set writes that participate in the offline queue.
 *
 * Both wrappers: (a) queue immediately when the browser is offline, (b) on a
 * transient server error, show a Retry toast and queue so an `online` event
 * retries automatically, (c) reload on a stale-bundle error instead of queueing
 * a call the new server won't recognise.
 *
 * Lives here rather than in a component because the workout set list and the
 * set-edit view both write sets and must behave identically — a set corrected
 * in the edit view has to reach the DB just as reliably as one toggled in the
 * list.
 */
export function useWorkoutSetWriter() {
  const { enqueue } = usePendingQueue();
  const { showToast } = useToast();

  const logWithRetry = async (
    payload: LogPayload,
  ): ReturnType<typeof logWorkoutSet> => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      enqueue({ kind: "logWorkoutSet", payload });
      showToast({
        message: "Offline — saved locally, will sync when online",
        durationMs: 4000,
      });
      return { success: true, data: { set: null as never, newPRs: [] } };
    }
    try {
      const r = await logWorkoutSet(payload);
      if (!r.success) {
        enqueue({ kind: "logWorkoutSet", payload });
        showToast({
          variant: "error",
          message: "Set didn't save — tap Retry",
          onRetry: () => void logWithRetry(payload),
        });
      }
      return r;
    } catch (err) {
      // Stale bundle: cached client calling an action ID the new server
      // doesn't know. Don't enqueue (replay would loop and drop) — reload
      // so the user gets fresh chunks. They'll re-tap when they're back.
      if (isStaleBundleError(err)) {
        showToast({ message: "App updating — refreshing…", durationMs: 3000 });
        void reloadForFreshBundle();
        throw err;
      }
      enqueue({ kind: "logWorkoutSet", payload });
      showToast({
        variant: "error",
        message: "Set didn't save — tap Retry",
        onRetry: () => void logWithRetry(payload),
      });
      throw err;
    }
  };

  const unlogWithRetry = async (payload: UnlogPayload): Promise<void> => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      enqueue({ kind: "unlogWorkoutSet", payload });
      return;
    }
    try {
      const r = await unlogWorkoutSet(payload);
      if (!r.success) {
        enqueue({ kind: "unlogWorkoutSet", payload });
        showToast({
          variant: "error",
          message: "Couldn't remove set — tap Retry",
          onRetry: () => void unlogWithRetry(payload),
        });
      }
    } catch (err) {
      if (isStaleBundleError(err)) {
        showToast({ message: "App updating — refreshing…", durationMs: 3000 });
        void reloadForFreshBundle();
        return;
      }
      enqueue({ kind: "unlogWorkoutSet", payload });
      showToast({
        variant: "error",
        message: "Couldn't remove set — tap Retry",
        onRetry: () => void unlogWithRetry(payload),
      });
    }
  };

  return { logWithRetry, unlogWithRetry };
}
