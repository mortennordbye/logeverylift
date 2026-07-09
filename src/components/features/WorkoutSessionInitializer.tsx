"use client";

import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { useWorkoutSession } from "@/contexts/workout-session-context";
import { createWorkoutSession } from "@/lib/actions/workout-sessions";
import { getActiveSessionCompletedProgramSetIds } from "@/lib/actions/workout-sets";
import { toDateString } from "@/lib/utils/format";

const STALE_MS = 8 * 60 * 60 * 1000;

/**
 * Mounted in the workout layout so every route under /programs/[id]/workout/*
 * — including deep links straight to an exercise — guarantees a workout
 * session exists for the visited program. Without this, deep links would
 * inherit a stale session from a different program (or none at all), and
 * `logWorkoutSet` would silently fail when the user tapped a set.
 */
export function WorkoutSessionInitializer({ programId }: { programId: number }) {
  const workoutSession = useWorkoutSession();
  const hydrateCompletedSetIds = workoutSession?.hydrateCompletedSetIds;
  const sessionId = workoutSession?.sessionId ?? null;
  // Set when arriving via a "Make up" prompt (?makeup=YYYY-MM-DD): the original
  // missed day this session is making up for. Validated YYYY-MM-DD only.
  const makeupParam = useSearchParams().get("makeup");
  const intendedDate = makeupParam && /^\d{4}-\d{2}-\d{2}$/.test(makeupParam)
    ? makeupParam
    : undefined;

  // Rehydrate completed-set toggles from the server once the session id is
  // known. `completedSetIds` lives only in React state; if iOS evicted the
  // PWA's JS context while backgrounded, localStorage restores the session
  // but the toggles would otherwise come back empty and the workout would
  // look reset even though the DB still has the rows.
  useEffect(() => {
    if (sessionId == null || !hydrateCompletedSetIds) return;
    let ignore = false;
    const pull = async () => {
      const result = await getActiveSessionCompletedProgramSetIds(sessionId);
      if (ignore || !result.success) return;
      hydrateCompletedSetIds(new Set(result.data));
    };
    void pull();
    // Re-pull whenever the app returns to the foreground. After a long iOS
    // background the JS context can be evicted, leaving completedSetIds empty
    // until this fires — without it the workout looks reset even though the DB
    // still holds the rows. pageshow/focus cover standalone-PWA cases where
    // visibilitychange doesn't fire.
    const onVisible = () => { if (document.visibilityState === 'visible') void pull(); };
    const onResume = () => { void pull(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onResume);
    window.addEventListener('focus', onResume);
    return () => {
      ignore = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onResume);
      window.removeEventListener('focus', onResume);
    };
  }, [sessionId, hydrateCompletedSetIds]);

  useEffect(() => {
    const raw = localStorage.getItem("activeWorkout");
    let storedProgramId: number | null = null;
    let storedStart: string | null = null;
    let storedSessionId: number | null = null;
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as {
          programId: number;
          startTime: string;
          sessionId: number | null;
        };
        storedProgramId = parsed.programId;
        storedStart = parsed.startTime;
        storedSessionId = parsed.sessionId;
      } catch {
        // fall through and re-init
      }
    }

    // Drop a session that's been around longer than the activity window —
    // mirrors the rule in workout-session-context.tsx.
    if (storedStart != null && Date.now() - new Date(storedStart).getTime() > STALE_MS) {
      localStorage.removeItem("activeWorkout");
      localStorage.removeItem("restTimerEnds");
      localStorage.removeItem("workoutOverrides");
      localStorage.removeItem("workoutReadiness");
      storedProgramId = null;
      storedStart = null;
      storedSessionId = null;
    }

    // Same program as last time — restore without a new DB session.
    if (
      storedProgramId === programId &&
      storedSessionId != null &&
      storedStart != null
    ) {
      workoutSession?.setActiveWorkout(programId, storedStart, storedSessionId);
      return;
    }

    // Already initialized for this program in-memory.
    if (
      workoutSession?.sessionId != null &&
      workoutSession.programId === programId
    ) {
      return;
    }

    // Different program (or none) — start a fresh session.
    const startTime = new Date();
    void (async () => {
      const result = await createWorkoutSession({
        date: toDateString(startTime),
        startTime: startTime.toISOString(),
        programId,
        intendedDate,
      });
      if (result.success) {
        workoutSession?.setActiveWorkout(
          programId,
          startTime.toISOString(),
          result.data.id,
        );
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programId]);

  return null;
}
