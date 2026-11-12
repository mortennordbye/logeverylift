"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useToast } from "@/contexts/toast-context";
import { logWorkoutSet, unlogWorkoutSet } from "@/lib/actions/workout-sets";
import { completeWorkoutSession } from "@/lib/actions/workout-sessions";
import { updateProgramSet } from "@/lib/actions/programs";
import { afterFailedReplay, afterStaleBundle, dueItems, mergeReplayed, nextReplayIn, replayOutcome } from "@/lib/utils/pending-queue";
import { isReloadPending, isStaleBundleError, noteActionReached, reloadForFreshBundle } from "@/lib/utils/stale-bundle";

// Shown when a write hit a stale bundle after a deploy. The write is queued
// either way, so the user can carry on logging.
const APP_UPDATING = "Updating app. Your sets are saved on this phone.";
// Shown, and kept, once reloading has stopped helping (MAX_STALE_RELOADS).
const UPDATE_FAILED = "App update failed. Your sets are saved on this phone. Close and reopen the app.";

function showStaleToast(
  showToast: ReturnType<typeof useToast>["showToast"],
  outcome: ReturnType<typeof reloadForFreshBundle>,
) {
  if (outcome === "failed") showToast({ variant: "error", message: UPDATE_FAILED, durationMs: 0 });
  else showToast({ message: APP_UPDATING, durationMs: 4000 });
}

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
    // A reload for the new bundle is under way: this bundle's action IDs are
    // stale, so anything sent now fails. The new page replays the queue.
    if (replayingRef.current || isReloadPending()) return;
    replayingRef.current = true;
    try {
      // Snapshot the queue at start; new enqueues during replay stay for next
      // pass. Read through the ref rather than closing over `queue` — a
      // dependency on the queue gave this callback a new identity on every
      // mutation, including the one that bumps `attempts`, which re-fired the
      // effect below and burned the whole retry budget in a tight loop.
      const snapshot = dueItems(queueRef.current, Date.now());
      if (snapshot.length === 0) return;

      const failed: QueuedMutation[] = [];
      const dropped: QueuedMutation[] = [];
      let conflicts = 0;
      let staleOutcome: ReturnType<typeof reloadForFreshBundle> | null = null;
      for (const [i, m] of snapshot.entries()) {
        let ok = false;
        let conflict = false;
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
          const outcome = replayOutcome(result);
          ok = outcome === "done";
          conflict = outcome === "conflict";
          noteActionReached();
        } catch (err) {
          if (isStaleBundleError(err)) {
            // Every later item hits the same error, so stop here. This item
            // and the rest stay queued without spending an attempt; only a
            // reload with the new action IDs can send them.
            staleOutcome = reloadForFreshBundle();
            for (const rest of snapshot.slice(i)) {
              // No reload now: wait and retry.
              failed.push(staleOutcome === "reloading" ? rest : afterStaleBundle(rest, Date.now()));
            }
            break;
          }
          ok = false;
        }
        if (ok) continue;
        // Final: the item leaves the queue, and is neither synced nor dropped.
        if (conflict) {
          conflicts++;
          continue;
        }
        const next = afterFailedReplay(m, Date.now());
        if (next.dropped) dropped.push(m);
        else failed.push(next.item);
      }

      // Drop the snapshot, keep failed ones (with bumped attempt counts)
      // + anything enqueued during replay. Dropped ones disappear silently
      // from the queue but we surface a toast so the user knows. Items saved
      // before a stale-bundle error leave too, so the new page doesn't send
      // them again.
      setQueue((prev) => mergeReplayed(prev, snapshot, failed));

      const succeeded = snapshot.length - failed.length - dropped.length - conflicts;
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
      if (conflicts > 0) {
        showToast({
          durationMs: 8000,
          message:
            conflicts === 1
              ? "Workout saved. One plan change from it was not applied, because the plan changed in the meantime. See the program's history."
              : `Workout saved. ${conflicts} plan changes from it were not applied, because the plan changed in the meantime. See the program's history.`,
        });
      }
      // Last, so it is the toast left on screen.
      if (staleOutcome) showStaleToast(showToast, staleOutcome);
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
    const wait = nextReplayIn(queue, Date.now());
    if (wait === null) return;
    if (wait === "now") {
      if (navigator.onLine) void replayAll();
      return;
    }
    const timer = setTimeout(() => void replayAll(), wait);
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
 * retries automatically, (c) on a stale-bundle error (a deploy changed the
 * action IDs), queue the write and reload, so the new bundle sends it.
 *
 * Lives here rather than in a component because the workout set list and the
 * set-edit view both write sets and must behave identically — a set corrected
 * in the edit view has to reach the DB just as reliably as one toggled in the
 * list.
 */
export function useWorkoutSetWriter() {
  const { enqueue, replayAll } = usePendingQueue();
  const { showToast } = useToast();
  // Retry replays the queue the failed write is already in. Re-sending the
  // payload instead enqueued it a second time whenever the retry failed too,
  // and replayed both.
  const retryQueued = () => void replayAll();

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
    // A reload for the new bundle is under way: a request sent now carries a
    // stale action ID, and the reload would cut it off before it could be
    // queued. Queue it straight away; the new page sends it.
    if (isReloadPending()) {
      enqueue({ kind: "logWorkoutSet", payload });
      showToast({ message: APP_UPDATING, durationMs: 4000 });
      return { success: false, error: "App updating" };
    }
    try {
      const r = await logWorkoutSet(payload);
      noteActionReached();
      if (!r.success) {
        enqueue({ kind: "logWorkoutSet", payload });
        showToast({
          variant: "error",
          message: "Set didn't save — tap Retry",
          onRetry: retryQueued,
        });
      }
      return r;
    } catch (err) {
      // Stale bundle: this client's action IDs are from before a deploy.
      // Queue the write and reload; the new page sends it with the new IDs.
      // Stale-bundle failures never count as attempts, so it can't be dropped.
      if (isStaleBundleError(err)) {
        enqueue({ kind: "logWorkoutSet", payload });
        showStaleToast(showToast, reloadForFreshBundle());
        return { success: false, error: "App updating" };
      }
      enqueue({ kind: "logWorkoutSet", payload });
      showToast({
        variant: "error",
        message: "Set didn't save — tap Retry",
        onRetry: retryQueued,
      });
      // Resolve, not reject: the write is queued, which is all a caller can
      // act on. Re-throwing left every caller with an unhandled rejection (and
      // a crashed toggle handler) for a set that was in fact saved for replay.
      return { success: false, error: "Saved locally, will retry" };
    }
  };

  const unlogWithRetry = async (payload: UnlogPayload): Promise<void> => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      enqueue({ kind: "unlogWorkoutSet", payload });
      return;
    }
    if (isReloadPending()) {
      enqueue({ kind: "unlogWorkoutSet", payload });
      return;
    }
    try {
      const r = await unlogWorkoutSet(payload);
      noteActionReached();
      if (!r.success) {
        enqueue({ kind: "unlogWorkoutSet", payload });
        showToast({
          variant: "error",
          message: "Couldn't remove set — tap Retry",
          onRetry: retryQueued,
        });
      }
    } catch (err) {
      if (isStaleBundleError(err)) {
        enqueue({ kind: "unlogWorkoutSet", payload });
        showStaleToast(showToast, reloadForFreshBundle());
        return;
      }
      enqueue({ kind: "unlogWorkoutSet", payload });
      showToast({
        variant: "error",
        message: "Couldn't remove set — tap Retry",
        onRetry: retryQueued,
      });
    }
  };

  return { logWithRetry, unlogWithRetry };
}
