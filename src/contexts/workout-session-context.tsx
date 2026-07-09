"use client";
import { setSessionReadiness } from "@/lib/actions/workout-sessions";
import { requestNotificationPermission, sendNotification } from "@/lib/notifications";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

type SetOverride = {
  targetReps: number;
  weightKg: number;
  durationSeconds?: number;
  /** Prep time (seconds) before the timed countdown; 0 = explicitly none. */
  startDelaySeconds?: number;
  distanceMeters?: number;
  /** Free-text per-set note captured in SetEditView; flushed on logWorkoutSet. */
  notes?: string | null;
  /** Set was attempted but not completed at target — logs isFailed + a lower actualReps. */
  isFailed?: boolean;
  /** Reps actually achieved on a failed set (0..target). Only meaningful when isFailed. */
  actualReps?: number;
  /** Reps In Reserve the user logged for this set (0 = to failure, 5 = 5+). */
  rir?: number;
};

const STORAGE_KEY = "activeWorkout";
const REST_TIMERS_KEY = "restTimerEnds";
const OVERRIDES_KEY = "workoutOverrides";
const READINESS_KEY = "workoutReadiness";

type WorkoutSessionContextValue = {
  sessionId: number | null;
  overrides: Record<number, SetOverride>;
  setOverride: (setId: number, data: SetOverride) => void;
  clearOverrides: () => void;
  completedSetIds: Set<number>;
  addCompletedSet: (id: number) => void;
  removeCompletedSet: (id: number) => void;
  hydrateCompletedSetIds: (ids: Set<number>) => void;
  restTimerEnds: Record<number, number>;
  setRestTimerEnd: (setId: number, endMs: number) => void;
  clearRestTimerEnd: (setId: number) => void;
  lastWorkoutPath: string | null;
  updateLastWorkoutPath: (path: string) => void;
  programId: number | null;
  startTime: string | null;
  workoutPath: string | null;
  setActiveWorkout: (programId: number, startTime: string, sessionId?: number) => void;
  clearActiveWorkout: () => void;
  /** Pre-workout readiness (1=Drained → 5=Excellent). Null until the user answers. */
  readiness: number | null;
  confirmReadiness: (level: number) => void;
};

const WorkoutSessionContext = createContext<WorkoutSessionContextValue | null>(null);

export function WorkoutSessionProvider({ children }: { children: React.ReactNode }) {
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [overrides, setOverrides] = useState<Record<number, SetOverride>>({});
  const [completedSetIds, setCompletedSetIds] = useState<Set<number>>(new Set());
  const [restTimerEnds, setRestTimerEnds] = useState<Record<number, number>>({});
  const [lastWorkoutPath, setLastWorkoutPath] = useState<string | null>(null);
  const restTimeoutRefs = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const [programId, setProgramId] = useState<number | null>(null);
  const [startTime, setStartTime] = useState<string | null>(null);
  const [workoutPath, setWorkoutPath] = useState<string | null>(null);
  const [readiness, setReadinessState] = useState<number | null>(null);

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const { programId: pid, startTime: st, sessionId: sid } = JSON.parse(raw) as {
          programId: number;
          startTime: string;
          sessionId: number | null;
        };
        // Discard sessions older than 24 hours — they are stale and would show
        // a wildly incorrect elapsed timer with no way to resume meaningfully.
        const ageMs = Date.now() - new Date(st).getTime();
        if (ageMs > 8 * 60 * 60 * 1000) {
          localStorage.removeItem(STORAGE_KEY);
          localStorage.removeItem(REST_TIMERS_KEY);
          localStorage.removeItem(OVERRIDES_KEY);
          localStorage.removeItem(READINESS_KEY);
        } else {
          // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring active session from localStorage on mount
          setProgramId(pid);
          setStartTime(st);
          setWorkoutPath(`/programs/${pid}/workout`);
          if (sid != null) setSessionId(sid);
        }
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
    const rawTimers = localStorage.getItem(REST_TIMERS_KEY);
    if (rawTimers) {
      try {
        setRestTimerEnds(JSON.parse(rawTimers) as Record<number, number>);
      } catch {
        localStorage.removeItem(REST_TIMERS_KEY);
      }
    }
    const rawOverrides = localStorage.getItem(OVERRIDES_KEY);
    if (rawOverrides) {
      try {
        setOverrides(JSON.parse(rawOverrides) as Record<number, SetOverride>);
      } catch {
        localStorage.removeItem(OVERRIDES_KEY);
      }
    }
    const rawReadiness = localStorage.getItem(READINESS_KEY);
    if (rawReadiness) {
      const parsed = parseInt(rawReadiness, 10);
      if (!isNaN(parsed)) setReadinessState(parsed);
    }
  }, []);

  // Schedule/cancel notification timeouts whenever restTimerEnds changes
  useEffect(() => {
    const refs = restTimeoutRefs.current;

    // Schedule new timers
    Object.entries(restTimerEnds).forEach(([id, endMs]) => {
      const setId = Number(id);
      if (refs[setId] !== undefined) return; // already scheduled
      const delay = endMs - Date.now();
      if (delay <= 0) return;
      refs[setId] = setTimeout(() => {
        sendNotification("Rest complete!", "Time to get back to work 💪");
        delete refs[setId];
      }, delay);
    });

    // Cancel timeouts for removed entries
    Object.keys(refs).forEach((id) => {
      const setId = Number(id);
      if (restTimerEnds[setId] === undefined) {
        clearTimeout(refs[setId]);
        delete refs[setId];
      }
    });
  }, [restTimerEnds]);

  const setOverride = (setId: number, data: SetOverride) =>
    setOverrides((prev) => {
      const next = { ...prev, [setId]: data };
      localStorage.setItem(OVERRIDES_KEY, JSON.stringify(next));
      return next;
    });

  const clearOverrides = () => {
    localStorage.removeItem(OVERRIDES_KEY);
    setOverrides({});
    setCompletedSetIds(new Set());
  };

  const addCompletedSet = (id: number) =>
    setCompletedSetIds((prev) => new Set(prev).add(id));

  const removeCompletedSet = (id: number) =>
    setCompletedSetIds((prev) => {
      const s = new Set(prev);
      s.delete(id);
      return s;
    });

  // Replace the whole set, used to seed from the server on workout-page mount
  // (the JS context may have been evicted while the PWA was backgrounded, in
  // which case localStorage restores the session but completedSetIds is empty).
  const hydrateCompletedSetIds = useCallback(
    (ids: Set<number>) => setCompletedSetIds(new Set(ids)),
    [],
  );

  const setRestTimerEnd = (setId: number, endMs: number) => {
    // Cancel any existing notification timeout so it can be rescheduled at the new end time
    const existing = restTimeoutRefs.current[setId];
    if (existing !== undefined) {
      clearTimeout(existing);
      delete restTimeoutRefs.current[setId];
    }
    setRestTimerEnds((prev) => {
      const next = { ...prev, [setId]: endMs };
      localStorage.setItem(REST_TIMERS_KEY, JSON.stringify(next));
      return next;
    });
  };

  const clearRestTimerEnd = (setId: number) => {
    setRestTimerEnds((prev) => {
      const next = { ...prev };
      delete next[setId];
      localStorage.setItem(REST_TIMERS_KEY, JSON.stringify(next));
      return next;
    });
  };

  const setActiveWorkout = (pid: number, st: string, sid?: number) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ programId: pid, startTime: st, sessionId: sid ?? null }));
    setProgramId(pid);
    setStartTime(st);
    setWorkoutPath(`/programs/${pid}/workout`);
    if (sid != null) setSessionId(sid);
    void requestNotificationPermission();
  };

  const updateLastWorkoutPath = (path: string) => setLastWorkoutPath(path);

  const confirmReadiness = (level: number) => {
    setReadinessState(level);
    localStorage.setItem(READINESS_KEY, String(level));
    // Persist to DB asynchronously (non-blocking)
    if (sessionId != null) {
      void setSessionReadiness(sessionId, level);
    }
  };

  const clearActiveWorkout = () => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(REST_TIMERS_KEY);
    localStorage.removeItem(OVERRIDES_KEY);
    localStorage.removeItem(READINESS_KEY);
    // Cancel all pending notification timeouts
    Object.values(restTimeoutRefs.current).forEach(clearTimeout);
    restTimeoutRefs.current = {};
    setProgramId(null);
    setStartTime(null);
    setWorkoutPath(null);
    setSessionId(null);
    setRestTimerEnds({});
    setLastWorkoutPath(null);
    setReadinessState(null);
    clearOverrides();
  };

  return (
    <WorkoutSessionContext.Provider
      value={{
        sessionId,
        overrides,
        setOverride,
        clearOverrides,
        completedSetIds,
        addCompletedSet,
        removeCompletedSet,
        hydrateCompletedSetIds,
        restTimerEnds,
        setRestTimerEnd,
        clearRestTimerEnd,
        lastWorkoutPath,
        updateLastWorkoutPath,
        programId,
        startTime,
        workoutPath,
        setActiveWorkout,
        clearActiveWorkout,
        readiness,
        confirmReadiness,
      }}
    >
      {children}
    </WorkoutSessionContext.Provider>
  );
}

// Returns null if used outside of a workout context (safe for shared components)
export function useWorkoutSession() {
  return useContext(WorkoutSessionContext);
}
