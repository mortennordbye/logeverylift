"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useToast } from "@/contexts/toast-context";
import { logWorkoutSet } from "@/lib/actions/workout-sets";
import { completeWorkoutSession } from "@/lib/actions/workout-sessions";
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
 * Scope is deliberately narrow — only `logWorkoutSet` and
 * `completeWorkoutSession` participate. Profile / program edits etc. fail
 * loudly via the existing toast and are extremely unlikely to be done
 * while offline.
 *
 * Limitation: if the user closes the app while offline, in-memory replay
 * doesn't fire. localStorage still holds the queue, so reopening the app
 * (still offline or online) replays. If the user clears storage / goes to
 * a fresh device while still offline, queued mutations are lost. Toast
 * messaging makes this risk visible.
 */

type LogPayload = Parameters<typeof logWorkoutSet>[0];
type CompletePayload = Parameters<typeof completeWorkoutSession>[0];

type QueuedMutation =
  | { id: string; kind: "logWorkoutSet"; payload: LogPayload; queuedAt: number; attempts?: number }
  | { id: string; kind: "completeWorkoutSession"; payload: CompletePayload; queuedAt: number; attempts?: number };

const STORAGE_KEY = "pendingMutationQueue";

// Drop a queued mutation after this many failed replays. Permanent failures
// (validation errors, unique violations the server can't recover from) would
// otherwise loop on every `online` event forever.
const MAX_ATTEMPTS = 5;

type PendingQueueContextValue = {
  count: number;
  enqueue: (mutation: Omit<QueuedMutation, "id" | "queuedAt">) => void;
  replayAll: () => Promise<void>;
};

const PendingQueueContext = createContext<PendingQueueContextValue | null>(null);

export function PendingQueueProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<QueuedMutation[]>([]);
  const replayingRef = useRef(false);
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

  // Persist on every change.
  useEffect(() => {
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
      // Snapshot the queue at start; new enqueues during replay stay for next pass.
      const snapshot = queue;
      if (snapshot.length === 0) return;

      const failed: QueuedMutation[] = [];
      const dropped: QueuedMutation[] = [];
      let staleBundleSeen = false;
      for (const m of snapshot) {
        let ok = false;
        try {
          const result =
            m.kind === "logWorkoutSet"
              ? await logWorkoutSet(m.payload)
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
          failed.push({ ...m, attempts: nextAttempts } as QueuedMutation);
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
  }, [queue, showToast]);

  // Replay on `online` and on mount if the network is up.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => void replayAll();
    window.addEventListener("online", handler);
    if (navigator.onLine) void replayAll();
    return () => {
      window.removeEventListener("online", handler);
    };
  }, [replayAll]);

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
