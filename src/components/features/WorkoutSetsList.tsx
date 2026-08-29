"use client";

import { BottomSheet } from "@/components/ui/BottomSheet";
import { LogRunModal } from "@/components/features/LogRunModal";
import { reorderProgramSets, updateProgramSet } from "@/lib/actions/programs";
import type { SetSuggestionDisplay } from "@/components/features/WorkoutSetsClient";
import { useWorkoutSetWriter } from "@/contexts/pending-queue-context";
import { useRenderedOverrides, useWorkoutSession } from "@/contexts/workout-session-context";
import { formatEnduranceDistance, formatEndurancePace, formatTime } from "@/lib/utils/format";
import { disciplineConfig, type Discipline } from "@/lib/utils/discipline";
import { haptics } from "@/lib/utils/haptics";
import { computeMapping, toFlatItems } from "@/lib/utils/set-mapping";
import type { FlatItem, RestFlatItem, SetFlatItem } from "@/lib/utils/set-mapping";
import type { PRResult, ProgramSet } from "@/types/workout";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Check, GripVertical, Minus, Play, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Effort chips for the miss sheet. "None" leaves it unlogged (0 = to failure). */
const MISS_RIR_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: "None" },
  { value: 0, label: "0" },
  { value: 1, label: "1" },
  { value: 2, label: "2" },
  { value: 3, label: "3" },
  { value: 4, label: "4" },
  { value: 5, label: "5+" },
];

/** Short label for the in-workout PR celebration badge. */
function prBadgeLabel(pr: PRResult): string {
  switch (pr.type) {
    case "weight":
      return `${pr.value}kg`;
    case "estimated_1rm":
      return `~${Math.round(pr.value)}kg 1RM`;
    case "reps_at_weight":
      return `${pr.value} reps`;
    case "distance":
      return formatEnduranceDistance(disciplineConfig(pr.discipline).inputUnit, pr.value);
    case "pace":
      return pr.distanceMeters != null
        ? formatEndurancePace(disciplineConfig(pr.discipline).paceFormatter, pr.value, pr.distanceMeters)
        : "PR";
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

type WorkoutSetsListProps = {
  sets: ProgramSet[];
  programId: number;
  programExerciseId: number;
  isEditing?: boolean;
  isWorkout?: boolean;
  isTimed?: boolean;
  isRunning?: boolean;
  discipline?: Discipline | null;
  exerciseId?: number;
  sessionId?: number;
  onDeleteSet?: (setId: number) => void;
  suggestions?: Record<number, SetSuggestionDisplay>;
  onApplySuggestion?: (setId: number, weightKg: number, adjustedReps?: number, durationSeconds?: number, distanceMeters?: number) => void;
  onApplyRepSuggestion?: (setId: number, reps: number) => void;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

// 30s, 1m, 1:30, 2m, 2:30, 3m, 4m, 5m
const REST_OPTIONS = [30, 60, 90, 120, 150, 180, 240, 300];

// ─── Main component ───────────────────────────────────────────────────────────

export function WorkoutSetsList({
  sets,
  programId,
  programExerciseId,
  isEditing = false,
  isWorkout = false,
  isTimed = false,
  isRunning = false,
  discipline = null,
  exerciseId,
  sessionId,
  onDeleteSet,
  suggestions,
  onApplySuggestion,
  onApplyRepSuggestion,
}: WorkoutSetsListProps) {
  const router = useRouter();
  const workoutSession = useWorkoutSession();
  // Rendered output only — toggleSet/confirmRunLog below read
  // workoutSession.overrides directly, because they write to the database.
  const renderedOverrides = useRenderedOverrides();

  // Queue-backed set writes (offline queue + retry toast + stale-bundle
  // reload). unlogWithRetry removes the row a set toggle-off orphans — without
  // it the un-log was client-state only, so history/volume/PRs kept the value
  // the user had just corrected away.
  const { logWithRetry, unlogWithRetry } = useWorkoutSetWriter();

  const workoutSessionRef = useRef(workoutSession);
  useEffect(() => { workoutSessionRef.current = workoutSession; }, [workoutSession]);
  const [flatItems, setFlatItems] = useState<FlatItem[]>(() =>
    toFlatItems(sets),
  );
  // In workout mode, completedSets is backed by the session context so it
  // survives navigation away and back within the workout layout.
  const completedSets = isWorkout && workoutSession
    ? workoutSession.completedSetIds
    : undefined;
  const [localCompletedSets, setLocalCompletedSets] = useState<Set<number>>(new Set());
  const activeCompletedSets = completedSets ?? localCompletedSets;
  // PR celebration state: setId → best PR from the completed set
  const [prCelebration, setPrCelebration] = useState<{
    setId: number;
    label: string;
  } | null>(null);
  // Track which sets have PRs for the badge display
  const [prSetIds, setPrSetIds] = useState<Set<number>>(new Set());
  const [restTimers, setRestTimers] = useState<Map<number, number>>(new Map());
  const [exerciseTimer, setExerciseTimer] = useState<{
    setId: number;
    // remaining/total cover the whole countdown: opt-in start delay + work.
    remaining: number;
    total: number;
    // Work portion only — what the set prescribes and what gets logged.
    workSeconds: number;
    endsAt: number;
  } | null>(null);
  const [editingRestItemId, setEditingRestItemId] = useState<string | null>(null);
  const [restDraft, setRestDraft] = useState(60);
  const [pendingRunSetId, setPendingRunSetId] = useState<number | null>(null);
  // Which set's progress dots were tapped. Holds the suggestion rather than the
  // id so the sheet keeps rendering the window it was opened on.
  const [sessionDetail, setSessionDetail] = useState<{
    setNumber: number;
    suggestion: SetSuggestionDisplay;
  } | null>(null);
  // Long-press on a set's toggle: record what was actually done rather than
  // taking the tap's word for it. Holds the set the press opened it on.
  const [missSheet, setMissSheet] = useState<{
    setId: number;
    setNumber: number;
    targetReps: number;
  } | null>(null);
  const [missReps, setMissReps] = useState(0);
  const [missRir, setMissRir] = useState<number | null>(null);
  // Dismissed for this exercise, this session. Deliberately not persisted: the
  // prompt is one tap, and the session it is holding open is worth re-offering
  // if the lifter comes back to the exercise.
  const [effortSkipped, setEffortSkipped] = useState(false);
  const [restMinStr, setRestMinStr] = useState("1");
  const [restSecStr, setRestSecStr] = useState("0");
  const restRowRef = useRef<HTMLDivElement>(null);

  // Center the selected preset when the picker opens, so the row never sits
  // on a position that leaves a partial circle peeking past the scroll edge.
  useEffect(() => {
    if (editingRestItemId === null) return;
    const selected = restRowRef.current?.querySelector<HTMLButtonElement>(
      `[data-rest-seconds="${restDraft}"]`,
    );
    selected?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [editingRestItemId, restDraft]);

  useEffect(() => {
    setFlatItems(toFlatItems(sets));
  }, [sets]);

  // Restore active rest timers from persisted end timestamps on mount
  useEffect(() => {
    if (!isWorkout || !workoutSession) return;
    const now = Date.now();
    const initial = new Map<number, number>();
    Object.entries(workoutSession.restTimerEnds).forEach(([id, endMs]) => {
      const remaining = Math.round((Number(endMs) - now) / 1000);
      if (remaining > 0) {
        initial.set(Number(id), remaining);
      } else {
        workoutSession.clearRestTimerEnd(Number(id));
      }
    });
    if (initial.size > 0) setRestTimers(initial);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When sets are pre-completed (e.g. marked via exercise checkmark), show their
  // rest timers as already finished (0) rather than showing the configured duration.
  useEffect(() => {
    if (!isWorkout) return;
    setRestTimers((prev) => {
      const next = new Map(prev);
      let changed = false;
      flatItems.forEach((item, i) => {
        if (
          item.type === "set" &&
          activeCompletedSets.has(item.set.id) &&
          flatItems[i + 1]?.type === "rest" &&
          !next.has(item.set.id)
        ) {
          next.set(item.set.id, 0);
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCompletedSets, flatItems]);

  // ── Persist helpers ─────────────────────────────────────────────────────────

  async function saveCurrentState(items: FlatItem[]) {
    const { orderedSetIds, restAssignments } = computeMapping(items);
    if (orderedSetIds.length > 0) {
      await reorderProgramSets(programExerciseId, orderedSetIds);
    }

    // Build a map of current DB values so we only write sets whose rest changed
    const currentRests = new Map<number, number>(
      items
        .filter((i): i is SetFlatItem => i.type === "set")
        .map((i) => [i.set.id, Number(i.set.restTimeSeconds)]),
    );

    const changed = Array.from(restAssignments.entries()).filter(
      ([setId, seconds]) => currentRests.get(setId) !== seconds,
    );

    if (changed.length > 0) {
      await Promise.all(
        changed.map(([setId, seconds]) =>
          updateProgramSet({ id: setId, restTimeSeconds: seconds }),
        ),
      );
    }

    router.refresh();
  }

  // ── The miss sheet ──────────────────────────────────────────────────────────

  /**
   * Long-press a set's toggle to log what actually happened.
   *
   * A short tap still claims the prescription, which is honest — it is a claim
   * the lifter made. This is the path for the set that fell short, and it
   * replaces the trip through the set editor to find "Mark set as failed".
   * Reps start at the target, so a press that only adds an effort value costs
   * one more tap than a plain log.
   */
  const openMissSheet = (setId: number, setNumber: number) => {
    const set = flatItems.find(
      (i): i is SetFlatItem => i.type === "set" && i.set.id === setId,
    )?.set;
    if (!set) return;
    const target = workoutSession?.overrides[setId]?.targetReps ?? set.targetReps ?? 0;
    setMissReps(target);
    setMissRir(workoutSession?.overrides[setId]?.rir ?? null);
    setMissSheet({ setId, setNumber, targetReps: target });
  };

  /**
   * The exercise's effort prompt, or null when it has nothing to ask.
   *
   * It asks only when a cap is prescribed (D-2: nobody is nagged for effort
   * they did not ask to be measured on), only once the last working set is
   * logged, and only while that set carries no effort. Until it is answered
   * the session is `unknown` — neither a clear nor a miss — so the prompt is
   * the thing standing between the lifter and their dots moving, and it says so.
   */
  const effortPrompt = (() => {
    if (!isWorkout || effortSkipped) return null;
    const working = flatItems.filter(
      (i): i is SetFlatItem => i.type === "set" && (i.set.setType ?? "working") === "working",
    );
    const last = working[working.length - 1];
    if (!last || last.set.targetRir == null) return null;
    if (!activeCompletedSets.has(last.set.id)) return null;
    if (workoutSession?.overrides[last.set.id]?.rir != null) return null;
    const setItems = flatItems.filter((i): i is SetFlatItem => i.type === "set");
    return {
      set: last.set,
      setIndex: setItems.findIndex((s) => s.set.id === last.set.id),
    };
  })();

  /**
   * Answer the prompt: re-log the set with the reserve the lifter reported.
   *
   * Through the same queue-backed writer as every other log, not fired at the
   * Server Action directly — this is a write to an already-logged set and it
   * has to survive going offline like the rest of them.
   */
  const logEffort = async (set: ProgramSet, setIndex: number, rir: number) => {
    if (sessionId == null || exerciseId == null) return;
    const ov = workoutSession?.overrides[set.id];
    const tr = ov?.targetReps ?? set.targetReps ?? 0;
    workoutSession?.setOverride(set.id, {
      ...ov,
      targetReps: tr,
      weightKg: ov?.weightKg ?? Number(set.weightKg ?? 0),
      rir,
    });
    await logWithRetry({
      sessionId,
      exerciseId,
      setNumber: setIndex + 1,
      programSetId: set.id,
      targetReps: tr > 0 ? tr : undefined,
      actualReps: ov?.actualReps ?? tr,
      weightKg: ov?.weightKg ?? Number(set.weightKg ?? 0),
      durationSeconds: ov?.durationSeconds ?? set.durationSeconds ?? undefined,
      distanceMeters: ov?.distanceMeters ?? set.distanceMeters ?? undefined,
      rir,
      restTimeSeconds: 0,
      notes: ov?.notes ?? null,
      isCompleted: true,
      isFailed: ov?.isFailed ?? false,
      wasEasy: ov?.wasEasy ?? false,
    });
  };

  const saveMissSheet = () => {
    if (!missSheet) return;
    const { setId, targetReps } = missSheet;
    const set = flatItems.find(
      (i): i is SetFlatItem => i.type === "set" && i.set.id === setId,
    )?.set;
    const existing = workoutSession?.overrides[setId];
    // setOverride replaces the whole record, so anything already on it (a
    // corrected weight, a note) has to be carried across.
    workoutSession?.setOverride(setId, {
      ...existing,
      targetReps: existing?.targetReps ?? targetReps,
      weightKg: existing?.weightKg ?? Number(set?.weightKg ?? 0),
      actualReps: missReps,
      rir: missRir ?? undefined,
    });
    setMissSheet(null);
    void toggleSet(setId, { actualReps: missReps, rir: missRir });
  };

  // ── Set completion ──────────────────────────────────────────────────────────

  /**
   * Toggle a set's completion.
   *
   * `logged` carries what the miss sheet collected. It is passed in rather
   * than read back off the override because setOverride is React state: the
   * write and this call happen in the same tick, so the override the log path
   * would read is still the previous one.
   */
  const toggleSet = async (
    setId: number,
    logged?: { actualReps: number; rir: number | null },
  ) => {
    const flatIndex = flatItems.findIndex((i) => i.id === `set-${setId}`);
    const setItems = flatItems.filter(
      (i): i is SetFlatItem => i.type === "set",
    );
    const setIndex = setItems.findIndex((s) => s.set.id === setId);

    if (activeCompletedSets.has(setId)) {
      if (completedSets) {
        workoutSession!.removeCompletedSet(setId);
      } else {
        setLocalCompletedSets((prev) => { const s = new Set(prev); s.delete(setId); return s; });
      }
      setRestTimers((timers) => {
        const t = new Map(timers);
        t.delete(setId);
        return t;
      });
      setPrSetIds((prev) => { const s = new Set(prev); s.delete(setId); return s; });
      if (isWorkout && workoutSession) workoutSession.clearRestTimerEnd(setId);
      // Remove the row server-side too, using the same set identity the log
      // path writes with (the plan slot, plus setIndex + 1).
      if (isWorkout && sessionId != null && exerciseId != null && setIndex >= 0) {
        void unlogWithRetry({ sessionId, exerciseId, setNumber: setIndex + 1, programSetId: setId });
      }
    } else {
      haptics.tap();
      // Collect all preceding sets that aren't already completed (catch-up)
      const precedingUncompleted = flatItems
        .slice(0, flatIndex)
        .filter((item): item is SetFlatItem =>
          item.type === "set" && !activeCompletedSets.has(item.set.id),
        );

      // Mark preceding sets + current set complete in context
      if (completedSets) {
        precedingUncompleted.forEach((item) => workoutSession!.addCompletedSet(item.set.id));
        workoutSession!.addCompletedSet(setId);
      } else {
        setLocalCompletedSets((prev) => {
          const s = new Set(prev);
          precedingUncompleted.forEach((item) => s.add(item.set.id));
          s.add(setId);
          return s;
        });
      }
      // Start timer from the rest item immediately after this set in the flat list
      const nextFlatItem = flatIndex >= 0 ? flatItems[flatIndex + 1] : undefined;
      const restSeconds =
        nextFlatItem?.type === "rest" ? nextFlatItem.seconds : 0;

      // Zero out rest timers for ALL preceding sets (catch-up — no waiting)
      setRestTimers((timers) => {
        const t = new Map(timers);
        for (let i = 0; i < flatIndex; i++) {
          const item = flatItems[i];
          if (item.type === "set") {
            t.set(item.set.id, 0);
          }
        }
        if (restSeconds > 0) {
          t.set(setId, restSeconds);
        }
        return t;
      });
      if (restSeconds > 0 && isWorkout && workoutSession) {
        workoutSession.setRestTimerEnd(setId, Date.now() + restSeconds * 1000);
      }

      // Log preceding uncompleted sets to DB (catch-up, rest = 0)
      if (isWorkout && sessionId != null && exerciseId != null) {
        for (const item of precedingUncompleted) {
          const sIdx = setItems.findIndex((s) => s.set.id === item.set.id);
          const ov = workoutSession?.overrides[item.set.id];
          // Zod requires targetReps to be positive when present — for timed
          // sets it's 0 by default, so coerce 0 to undefined.
          const tr = ov?.targetReps ?? item.set.targetReps ?? 0;
          void logWithRetry({
            sessionId,
            exerciseId,
            setNumber: sIdx + 1,
            programSetId: item.set.id,
            targetReps: tr > 0 ? tr : undefined,
            // The achieved count when the session recorded one (the miss sheet
            // or a correction in the editor), otherwise the target: catching a
            // set up with one tap is a claim that it went to plan.
            actualReps: ov?.actualReps ?? tr,
            weightKg: ov?.weightKg ?? Number(item.set.weightKg ?? 0),
            durationSeconds: ov?.durationSeconds ?? item.set.durationSeconds ?? undefined,
            distanceMeters: ov?.distanceMeters ?? item.set.distanceMeters ?? undefined,
            // No rpe: the lifter caught these sets up with one tap and said
            // nothing about effort. When rir is present the server derives rpe
            // from it; when it isn't, the set is logged with effort unknown.
            rir: ov?.rir,
            restTimeSeconds: 0,
            notes: ov?.notes ?? null,
            isCompleted: true,
          });
        }
      }

      // Log the completed set to the database (await for PR detection)
      if (isWorkout && sessionId != null && exerciseId != null) {
        const setData = setItems[setIndex]?.set;
        if (setData) {
          const ov = workoutSession?.overrides[setData.id];
          const tr = ov?.targetReps ?? setData.targetReps ?? 0;
          // The target is the goal either way; what changes is the achieved
          // count. A recorded one wins, a set taken to failure with nothing
          // recorded is 0, and a plain tap claims the target.
          const failed = ov?.isFailed ?? false;
          const achieved = logged?.actualReps ?? ov?.actualReps ?? (failed ? 0 : tr);
          const result = await logWithRetry({
            sessionId,
            exerciseId,
            setNumber: setIndex + 1,
            programSetId: setData.id,
            targetReps: tr > 0 ? tr : undefined,
            actualReps: achieved,
            weightKg: ov?.weightKg ?? Number(setData.weightKg ?? 0),
            durationSeconds: ov?.durationSeconds ?? setData.durationSeconds ?? undefined,
            distanceMeters: ov?.distanceMeters ?? setData.distanceMeters ?? undefined,
            // A failed set was taken to failure ⇒ RIR 0; otherwise use the logged
            // value, which may be absent — a tap says the set is done, not how
            // hard it was.
            rir: failed ? 0 : (logged?.rir ?? ov?.rir),
            restTimeSeconds: restSeconds,
            notes: ov?.notes ?? null,
            isCompleted: true,
            isFailed: failed,
            // A failed set can't also have been easy.
            wasEasy: !failed && (ov?.wasEasy ?? false),
          });
          // Only celebrate when an existing record was beaten (previousValue defined).
          // First-time baselines are stored silently — no celebration.
          const beatenPRs = result.success
            ? result.data.newPRs.filter((pr) => pr.previousValue !== undefined)
            : [];
          if (beatenPRs.length > 0) {
            const best = beatenPRs[0];
            const label = prBadgeLabel(best);
            haptics.success();
            setPrSetIds((prev) => new Set(prev).add(setData.id));
            setPrCelebration({ setId: setData.id, label });
            setTimeout(() => setPrCelebration(null), 2500);
          }
        }
      }

      // Auto-carry weight to next set (only if next set has no weight configured yet)
      const currentSet = setItems[setIndex]?.set;
      const nextSet = setItems[setIndex + 1]?.set;
      if (
        currentSet &&
        nextSet &&
        currentSet.weightKg != null &&
        (nextSet.weightKg == null || Number(nextSet.weightKg) === 0) &&
        !activeCompletedSets.has(nextSet.id)
      ) {
        await updateProgramSet({
          id: nextSet.id,
          weightKg: Number(currentSet.weightKg),
        });
        router.refresh();
      }
    }
  };

  // ── Run confirmation handler ────────────────────────────────────────────────

  const confirmRunLog = async (
    setId: number,
    distanceMeters: number,
    runDurationSeconds: number,
    rpe: number,
    inclinePercent: number | null,
    heartRateZone: number | null,
  ) => {
    setPendingRunSetId(null);
    const flatIndex = flatItems.findIndex((i) => i.id === `set-${setId}`);
    const setItems = flatItems.filter((i): i is SetFlatItem => i.type === "set");
    const setIndex = setItems.findIndex((s) => s.set.id === setId);

    if (completedSets) {
      workoutSession!.addCompletedSet(setId);
    } else {
      setLocalCompletedSets((prev) => { const s = new Set(prev); s.add(setId); return s; });
    }

    const nextFlatItem = flatIndex >= 0 ? flatItems[flatIndex + 1] : undefined;
    const restSeconds = nextFlatItem?.type === "rest" ? nextFlatItem.seconds : 0;

    if (restSeconds > 0) {
      setRestTimers((timers) => { const t = new Map(timers); t.set(setId, restSeconds); return t; });
      if (isWorkout && workoutSession) {
        workoutSession.setRestTimerEnd(setId, Date.now() + restSeconds * 1000);
      }
    }

    if (isWorkout && sessionId != null && exerciseId != null) {
      await logWithRetry({
        sessionId,
        exerciseId,
        setNumber: setIndex + 1,
        programSetId: setId,
        actualReps: 0,
        weightKg: 0,
        distanceMeters,
        durationSeconds: runDurationSeconds > 0 ? runDurationSeconds : undefined,
        inclinePercent: inclinePercent ?? undefined,
        heartRateZone: heartRateZone ?? undefined,
        rpe,
        restTimeSeconds: restSeconds,
        isCompleted: true,
      });
    }
  };

  // ── Rest timer countdown ────────────────────────────────────────────────────

  useEffect(() => {
    const interval = setInterval(() => {
      const session = workoutSessionRef.current;
      const now = Date.now();
      setRestTimers((timers) => {
        if (timers.size === 0) return timers;
        const newTimers = new Map(timers);
        let changed = false;
        timers.forEach((remaining, id) => {
          if (remaining > 0) {
            const endMs = session?.restTimerEnds[id];
            const next = endMs
              ? Math.max(0, Math.ceil((endMs - now) / 1000))
              : Math.max(0, remaining - 1);
            if (next !== remaining) {
              newTimers.set(id, next);
              changed = true;
            }
          }
        });
        return changed ? newTimers : timers;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Recompute rest timers from stored end timestamps when the app returns to the
  // foreground. iOS suspends the tick interval (and can evict React state) while
  // backgrounded, and `visibilitychange` alone is unreliable for standalone PWAs
  // — so we also listen to pageshow/focus, and rebuild each timer straight from
  // restTimerEnds (restoring entries that were dropped, not just adjusting live
  // ones). Existing non-anchored entries (e.g. pre-completed 0s) are left intact.
  useEffect(() => {
    if (!isWorkout) return;
    const resync = () => {
      const session = workoutSessionRef.current;
      if (!session) return;
      const now = Date.now();
      setRestTimers((timers) => {
        const newTimers = new Map(timers);
        let changed = false;
        Object.entries(session.restTimerEnds).forEach(([id, endMs]) => {
          const setId = Number(id);
          const actual = Math.max(0, Math.ceil((Number(endMs) - now) / 1000));
          if (newTimers.get(setId) !== actual) {
            newTimers.set(setId, actual);
            changed = true;
          }
        });
        return changed ? newTimers : timers;
      });
    };
    const onVisible = () => { if (document.visibilityState === 'visible') resync(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', resync);
    window.addEventListener('focus', resync);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', resync);
      window.removeEventListener('focus', resync);
    };
  }, [isWorkout]);

  // ── Exercise timer countdown ─────────────────────────────────────────────────

  useEffect(() => {
    if (!exerciseTimer) return;
    if (exerciseTimer.remaining === 0) {
      // Hold "00:00" on screen briefly so the user sees the timer hit zero
      // before the overlay clears. Without this delay the React render that
      // would paint 00:00 races with the toggleSet/clear and the user's last
      // visible frame is 00:01 — feels like the timer was cut a second short.
      const completeId = setTimeout(() => {
        void toggleSet(exerciseTimer.setId);
        setExerciseTimer(null);
      }, 600);
      return () => clearTimeout(completeId);
    }
    const id = setTimeout(() => {
      setExerciseTimer((prev) => {
        if (!prev) return null;
        const remaining = Math.max(0, Math.ceil((prev.endsAt - Date.now()) / 1000));
        return { ...prev, remaining };
      });
    }, 1000);
    return () => clearTimeout(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exerciseTimer?.remaining, exerciseTimer?.setId]);

  // Recalculate exercise timer when the app returns to the foreground. Same iOS
  // caveat as the rest timer — visibilitychange isn't enough on standalone PWAs,
  // so pageshow/focus are wired up too.
  useEffect(() => {
    const resync = () => {
      setExerciseTimer((prev) => {
        if (!prev) return null;
        const remaining = Math.max(0, Math.ceil((prev.endsAt - Date.now()) / 1000));
        return { ...prev, remaining };
      });
    };
    const onVisible = () => { if (document.visibilityState === 'visible') resync(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', resync);
    window.addEventListener('focus', resync);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', resync);
      window.removeEventListener('focus', resync);
    };
  }, []);

  function startExerciseTimer(setId: number, durationSeconds: number, startDelaySeconds = 0) {
    const total = durationSeconds + startDelaySeconds;
    setExerciseTimer({ setId, remaining: total, total, workSeconds: durationSeconds, endsAt: Date.now() + total * 1000 });
  }

  // ── Rest editing ────────────────────────────────────────────────────────────

  function insertRest(insertIndex: number) {
    const existingRests = flatItems
      .filter((i): i is RestFlatItem => i.type === "rest")
      .map((i) => i.seconds);
    const defaultSeconds =
      existingRests.length > 0
        ? existingRests[Math.floor(existingRests.length / 2)]
        : 60;

    const newId = `rest-new-${Date.now()}`;
    const newItem: RestFlatItem = { type: "rest", id: newId, seconds: defaultSeconds };
    const newItems = [
      ...flatItems.slice(0, insertIndex),
      newItem,
      ...flatItems.slice(insertIndex),
    ];
    setFlatItems(newItems);
    setRestDraft(defaultSeconds);
    setRestMinStr(String(Math.floor(defaultSeconds / 60)));
    setRestSecStr(String(defaultSeconds % 60));
    setEditingRestItemId(newId);
  }

  async function handleSaveRest() {
    if (!editingRestItemId) return;

    // Capture old duration before overwriting flatItems
    const oldDuration = (flatItems.find((i) => i.id === editingRestItemId) as RestFlatItem | undefined)?.seconds;

    const newItems = flatItems.map((i) =>
      i.id === editingRestItemId ? { ...i, seconds: restDraft } : i,
    );
    setFlatItems(newItems);
    setEditingRestItemId(null);

    // If a rest timer is actively counting down, shift its end time by the duration delta
    if (isWorkout && workoutSession && oldDuration !== undefined && oldDuration !== restDraft) {
      const restIdx = flatItems.findIndex((i) => i.id === editingRestItemId);
      const precedingSet = flatItems
        .slice(0, restIdx)
        .reverse()
        .find((i): i is SetFlatItem => i.type === "set");
      if (precedingSet) {
        const setId = precedingSet.set.id;
        const currentEndMs = workoutSession.restTimerEnds[setId];
        if (currentEndMs && currentEndMs > Date.now()) {
          const newEndMs = currentEndMs + (restDraft - oldDuration) * 1000;
          workoutSession.setRestTimerEnd(setId, newEndMs);
          // Update local countdown immediately (don't wait for the next 1s tick)
          setRestTimers((prev) => {
            const newRemaining = Math.max(0, Math.ceil((newEndMs - Date.now()) / 1000));
            return new Map(prev).set(setId, newRemaining);
          });
        }
      }
    }

    await saveCurrentState(newItems);
  }

  async function handleDeleteRest(restItemId: string) {
    const newItems = flatItems.filter((i) => i.id !== restItemId);
    setFlatItems(newItems);
    await saveCurrentState(newItems);
  }

  // ── Drag and drop ───────────────────────────────────────────────────────────

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = flatItems.findIndex((i) => i.id === active.id);
    const newIndex = flatItems.findIndex((i) => i.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    haptics.tick();
    const reordered = arrayMove(flatItems, oldIndex, newIndex);
    setFlatItems(reordered);
    await saveCurrentState(reordered);
  }

  // ── Suggestion propagation ──────────────────────────────────────────────────
  // The page is per-exercise, so all sets in `flatItems` belong to the same
  // exercise. When the user applies a suggestion to one set, propagate to any
  // other uncompleted set with an *identical* pending suggestion that the user
  // has not already manually overridden — saves clicking the same button N
  // times for N working sets that share a progression.
  function siblingsForApply(targetSetId: number): number[] {
    const target = suggestions?.[targetSetId];
    if (!target) return [targetSetId];
    return flatItems
      .filter((i): i is SetFlatItem => i.type === "set")
      .filter((item) => !activeCompletedSets.has(item.set.id))
      .filter((item) => {
        if (workoutSession?.overrides[item.set.id]) return item.set.id === targetSetId;
        const s = suggestions?.[item.set.id];
        return (
          s != null &&
          s.reason === target.reason &&
          s.suggestedWeightKg === target.suggestedWeightKg &&
          s.suggestedReps === target.suggestedReps &&
          s.suggestedDurationSeconds === target.suggestedDurationSeconds &&
          s.suggestedDistanceMeters === target.suggestedDistanceMeters
        );
      })
      .map((item) => item.set.id);
  }

  const handleApplySuggestion = onApplySuggestion
    ? (setId: number, weightKg: number, adjustedReps?: number, durationSeconds?: number, distanceMeters?: number) => {
        for (const id of siblingsForApply(setId)) {
          onApplySuggestion(id, weightKg, adjustedReps, durationSeconds, distanceMeters);
        }
      }
    : undefined;

  const handleApplyRepSuggestion = onApplyRepSuggestion
    ? (setId: number, reps: number) => {
        for (const id of siblingsForApply(setId)) {
          onApplyRepSuggestion(id, reps);
        }
      }
    : undefined;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={flatItems.map((i) => i.id)}
          strategy={verticalListSortingStrategy}
        >
          {flatItems.map((item, index) => {
            if (item.type === "set") {
              const setNumber =
                flatItems.slice(0, index).filter((i) => i.type === "set")
                  .length + 1;
              return (
                <div key={item.id}>
                  <SortableSetRow
                    id={item.id}
                    set={item.set}
                    setNumber={setNumber}
                    totalSets={flatItems.filter((i) => i.type === "set").length}
                    isEditing={isEditing}
                    isWorkout={isWorkout}
                    isTimed={isTimed}
                    isRunning={isRunning}
                    discipline={discipline}
                    isCompleted={activeCompletedSets.has(item.set.id)}
                    programId={programId}
                    programExerciseId={programExerciseId}
                    onToggle={() => toggleSet(item.set.id)}
                    onLongPressToggle={
                      isWorkout && workoutSession
                        ? () => openMissSheet(item.set.id, setNumber)
                        : undefined
                    }
                    onDelete={() => onDeleteSet?.(item.set.id)}
                    onStartTimer={startExerciseTimer}
                    onOpenLogRun={isRunning ? (id) => setPendingRunSetId(id) : undefined}
                    suggestion={suggestions?.[item.set.id]}
                    onShowSessions={(suggestion) =>
                      setSessionDetail({ setNumber, suggestion })
                    }
                    onApplySuggestion={handleApplySuggestion}
                    onApplyRepSuggestion={handleApplyRepSuggestion}
                    overrideDurationSeconds={isWorkout ? renderedOverrides[item.set.id]?.durationSeconds : undefined}
                    overrideStartDelaySeconds={isWorkout ? renderedOverrides[item.set.id]?.startDelaySeconds : undefined}
                    overrideNotes={isWorkout ? renderedOverrides[item.set.id]?.notes ?? null : null}
                    overrideActualReps={isWorkout ? renderedOverrides[item.set.id]?.actualReps : undefined}
                    failed={isWorkout ? (renderedOverrides[item.set.id]?.isFailed ?? false) : false}
                    hasPR={prSetIds.has(item.set.id)}
                  />
                  {isEditing && flatItems[index + 1]?.type !== "rest" && (
                    <InsertRestButton onClick={() => insertRest(index + 1)} />
                  )}
                </div>
              );
            } else {
              // Find preceding set for the rest timer
              const precedingSet = flatItems
                .slice(0, index)
                .reverse()
                .find((i): i is SetFlatItem => i.type === "set");
              const restRemaining = precedingSet
                ? restTimers.get(precedingSet.set.id)
                : undefined;
              const restProgress =
                restRemaining !== undefined && item.seconds > 0
                  ? ((item.seconds - restRemaining) / item.seconds) * 100
                  : 0;
              return (
                <div key={item.id}>
                  <SortableRestRow
                    id={item.id}
                    seconds={item.seconds}
                    isEditing={isEditing}
                    isWorkout={isWorkout}
                    restRemaining={restRemaining}
                    restProgress={restProgress}
                    onDelete={() => handleDeleteRest(item.id)}
                    onEdit={() => {
                      setRestDraft(item.seconds);
                      setRestMinStr(String(Math.floor(item.seconds / 60)));
                      setRestSecStr(String(item.seconds % 60));
                      setEditingRestItemId(item.id);
                    }}
                  />
                </div>
              );
            }
          })}
        </SortableContext>
      </DndContext>

      {/* One effort prompt per exercise, not one per set.
          Section 6, change 3: it only appears where a cap is prescribed, so
          the setting the lifter chose is the thing that adds the tap. Roughly
          five taps a workout, against one per set for everyone. */}
      {effortPrompt && (
        <div className="mt-3 rounded-2xl bg-card border border-border p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium">Last set — how much was left?</span>
            <button
              onClick={() => setEffortSkipped(true)}
              className="text-xs text-muted-foreground font-medium min-h-[44px] px-2"
            >
              Skip
            </button>
          </div>
          <div className="flex gap-2">
            {MISS_RIR_OPTIONS.filter((o) => o.value != null).map(({ value, label }) => (
              <button
                key={label}
                onClick={() => void logEffort(effortPrompt.set, effortPrompt.setIndex, value!)}
                className="flex-1 h-11 rounded-xl text-sm font-semibold bg-muted text-foreground active:scale-95 transition-transform"
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground/70 mt-2">
            This exercise only counts a session once you say how much was in
            reserve. Skipping leaves it neither cleared nor missed.
          </p>
        </div>
      )}

      {/* PR Celebration overlay */}
      {prCelebration !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
          <div className="flex flex-col items-center gap-3 animate-pr-pop">
            {/* Confetti dots */}
            <div className="relative w-32 h-32 flex items-center justify-center">
              {[0, 60, 120, 180, 240, 300].map((deg) => (
                <div
                  key={deg}
                  className="absolute w-2.5 h-2.5 rounded-full bg-primary animate-confetti"
                  style={{
                    transform: `rotate(${deg}deg) translateY(-52px)`,
                    animationDelay: `${(deg / 360) * 0.3}s`,
                  }}
                />
              ))}
              <div className="text-4xl">🏆</div>
            </div>
            <div className="bg-card border border-border rounded-2xl px-6 py-3 shadow-lg text-center">
              <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">
                Personal Record
              </p>
              <p className="text-2xl font-bold mt-0.5">{prCelebration.label}</p>
            </div>
          </div>
        </div>
      )}

      {/* Exercise timer overlay */}
      {exerciseTimer !== null && (() => {
        // The countdown runs delay + work as one continuous sweep. The delay
        // (opt-in prep time) elapses first; on the ring it occupies the tail
        // segment, drawn in amber, so the drain crosses amber → primary.
        const C = 2 * Math.PI * 44;
        const { remaining, total, workSeconds } = exerciseTimer;
        const delaySeconds = total - workSeconds;
        const workRemaining = Math.min(remaining, workSeconds);
        const delayRemaining = Math.max(0, remaining - workSeconds);
        const inDelay = delayRemaining > 0;
        const delayStartDeg = (workSeconds / total) * 360;
        return (
        <div className="fixed inset-0 bg-background z-50 flex flex-col items-center justify-center gap-12">
          {/* Circular progress ring */}
          <div className="relative w-80 h-80">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
              <circle
                cx="50"
                cy="50"
                r="44"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                className="text-primary/15"
              />
              {delaySeconds > 0 && (
                // Delay-zone track: keeps the delay/work boundary visible after
                // the delay drains. Butt caps — round caps on a zero-length dash
                // leave a phantom dot at the boundary.
                <circle
                  cx="50"
                  cy="50"
                  r="44"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  className="text-amber-500/20"
                  strokeDasharray={`${(C * delaySeconds) / total} ${C}`}
                  transform={`rotate(${delayStartDeg} 50 50)`}
                />
              )}
              <circle
                cx="50"
                cy="50"
                r="44"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                className="text-primary transition-[stroke-dashoffset] duration-1000 ease-linear"
                strokeDasharray={`${C}`}
                strokeDashoffset={`${C * (1 - workRemaining / total)}`}
              />
              {delaySeconds > 0 && (
                <circle
                  cx="50"
                  cy="50"
                  r="44"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  className="text-amber-500 transition-[stroke-dashoffset] duration-1000 ease-linear"
                  strokeDasharray={`${C}`}
                  strokeDashoffset={`${C - (C * delayRemaining) / total}`}
                  transform={`rotate(${delayStartDeg} 50 50)`}
                />
              )}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
              <span className="text-8xl font-bold tabular-nums tracking-tight">
                {formatTime(inDelay ? delayRemaining : workRemaining)}
              </span>
              {inDelay ? (
                <span className="text-sm text-amber-500 font-semibold uppercase tracking-wider">
                  Get ready
                </span>
              ) : (
                <span className="text-sm text-muted-foreground font-medium">
                  of {formatTime(workSeconds)}
                </span>
              )}
            </div>
          </div>

          <div className="flex gap-4">
            <button
              onClick={() => setExerciseTimer(null)}
              className="px-10 py-4 rounded-2xl bg-muted text-foreground text-base font-semibold active:scale-95 transition-all"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                void toggleSet(exerciseTimer.setId);
                setExerciseTimer(null);
              }}
              className="px-10 py-4 rounded-2xl bg-primary text-primary-foreground text-base font-semibold active:scale-95 transition-all flex items-center gap-2"
            >
              <Check className="w-5 h-5" />
              Done
            </button>
          </div>
        </div>
        );
      })()}

      {/* Log Run Modal */}
      {pendingRunSetId !== null && (() => {
        const setItems = flatItems.filter((i): i is SetFlatItem => i.type === "set");
        const runSet = setItems.find((s) => s.set.id === pendingRunSetId)?.set;
        const setNumber = setItems.findIndex((s) => s.set.id === pendingRunSetId) + 1;
        return (
          <LogRunModal
            open={true}
            onClose={() => setPendingRunSetId(null)}
            discipline={discipline}
            onConfirm={(dist, dur, rpe, incline, hrZone) => confirmRunLog(pendingRunSetId, dist, dur, rpe, incline, hrZone)}
            targetDistanceMeters={workoutSession?.overrides[pendingRunSetId]?.distanceMeters ?? runSet?.distanceMeters}
            targetDurationSeconds={workoutSession?.overrides[pendingRunSetId]?.durationSeconds ?? runSet?.durationSeconds}
            targetInclinePercent={runSet?.inclinePercent}
            targetHeartRateZone={runSet?.targetHeartRateZone}
            setNumber={setNumber}
            totalSets={setItems.length}
          />
        );
      })()}

      {/* Rest duration picker */}
      <BottomSheet
        open={editingRestItemId !== null}
        onClose={handleSaveRest}
        blur
      >
        <div className="w-full bg-card rounded-t-3xl p-6">
          <div className="flex items-center justify-between mb-6">
            <span className="text-sm text-muted-foreground uppercase tracking-wider">
              Select Rest Time
            </span>
            <button
              onClick={handleSaveRest}
              className="text-primary text-sm font-medium"
            >
              Done
            </button>
          </div>
          <div ref={restRowRef} className="flex gap-2 overflow-x-auto pb-4 no-scrollbar">
            {REST_OPTIONS.map((seconds) => (
              <button
                key={seconds}
                data-rest-seconds={seconds}
                onClick={(e) => {
                  setRestDraft(seconds);
                  setRestMinStr(String(Math.floor(seconds / 60)));
                  setRestSecStr(String(seconds % 60));
                  e.currentTarget.scrollIntoView({
                    inline: "center",
                    block: "nearest",
                    behavior: "smooth",
                  });
                }}
                className={`flex-shrink-0 w-20 h-20 rounded-full flex flex-col items-center justify-center font-bold transition-all active:scale-95 ${
                  restDraft === seconds
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground"
                }`}
              >
                {seconds < 60 ? (
                  <>
                    <span className="text-lg">{seconds}</span>
                    <span className="text-xs opacity-70">s</span>
                  </>
                ) : seconds % 60 === 0 ? (
                  <>
                    <span className="text-lg">{seconds / 60}</span>
                    <span className="text-xs opacity-70">m</span>
                  </>
                ) : (
                  <>
                    <span className="text-lg">
                      {Math.floor(seconds / 60)}:
                      {String(seconds % 60).padStart(2, "0")}
                    </span>
                    <span className="text-xs opacity-70">m</span>
                  </>
                )}
              </button>
            ))}
          </div>
          <div className="mt-4 flex items-end justify-center gap-2">
            <div className="flex flex-col items-center gap-1">
              <input
                type="text"
                inputMode="numeric"
                value={restMinStr}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, "");
                  setRestMinStr(val);
                  const mins = Math.max(0, Math.min(59, parseInt(val) || 0));
                  setRestDraft(mins * 60 + (restDraft % 60));
                }}
                onBlur={() => setRestMinStr(String(Math.floor(restDraft / 60)))}
                className="w-24 rounded-xl bg-background border border-border px-2 py-3 text-center text-3xl font-bold outline-none focus:ring-2 ring-primary"
              />
              <span className="text-xs text-muted-foreground">min</span>
            </div>
            <span className="text-3xl font-bold pb-6">:</span>
            <div className="flex flex-col items-center gap-1">
              <input
                type="text"
                inputMode="numeric"
                value={restSecStr}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, "");
                  setRestSecStr(val);
                  const secs = Math.max(0, Math.min(59, parseInt(val) || 0));
                  setRestDraft(Math.floor(restDraft / 60) * 60 + secs);
                }}
                onBlur={() => setRestSecStr(String(restDraft % 60))}
                className="w-24 rounded-xl bg-background border border-border px-2 py-3 text-center text-3xl font-bold outline-none focus:ring-2 ring-primary"
              />
              <span className="text-xs text-muted-foreground">sec</span>
            </div>
          </div>
        </div>
      </BottomSheet>

      {/* What actually happened on the set, from a long press on its toggle */}
      <BottomSheet open={missSheet !== null} onClose={() => setMissSheet(null)} blur>
        <div className="w-full bg-card rounded-t-3xl p-6">
          <div className="flex items-center justify-between mb-5">
            <span className="text-sm text-muted-foreground uppercase tracking-wider">
              Set {missSheet?.setNumber}
            </span>
            <button
              onClick={() => setMissSheet(null)}
              className="text-muted-foreground text-sm font-medium"
            >
              Cancel
            </button>
          </div>

          <div className="flex items-center justify-between mb-2">
            <span className="text-base font-medium">Reps done</span>
            <span className="text-xs text-muted-foreground">
              {missSheet != null && missReps < missSheet.targetReps
                ? `${missSheet.targetReps - missReps} short of ${missSheet.targetReps}`
                : `target ${missSheet?.targetReps ?? 0}`}
            </span>
          </div>
          <div className="flex items-center gap-4 mb-6">
            <button
              onClick={() => setMissReps((r) => Math.max(0, r - 1))}
              aria-label="One rep fewer"
              className="w-12 h-12 rounded-full bg-muted flex items-center justify-center active:scale-95 transition-transform"
            >
              <Minus className="w-5 h-5" />
            </button>
            <span className="flex-1 text-center text-3xl font-semibold tabular-nums">
              {missReps}
            </span>
            <button
              onClick={() => setMissReps((r) => Math.min(99, r + 1))}
              aria-label="One rep more"
              className="w-12 h-12 rounded-full bg-muted flex items-center justify-center active:scale-95 transition-transform"
            >
              <Plus className="w-5 h-5" />
            </button>
          </div>

          <div className="flex items-center justify-between mb-3">
            <span className="text-base font-medium">
              Reps in reserve{" "}
              <span className="text-xs text-muted-foreground">(optional)</span>
            </span>
            <span className="text-xs text-muted-foreground">
              {missRir == null
                ? "Not logged"
                : missRir === 0
                  ? "to failure"
                  : missRir === 5
                    ? "5+ left"
                    : `${missRir} left`}
            </span>
          </div>
          <div className="flex gap-2 mb-6">
            {MISS_RIR_OPTIONS.map(({ value, label }) => (
              <button
                key={label}
                onClick={() => setMissRir(value)}
                className={`flex-1 h-11 rounded-xl text-sm font-semibold transition-all active:scale-95 ${
                  missRir === value
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <button
            onClick={saveMissSheet}
            className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-semibold active:scale-[0.98] transition-transform"
          >
            Log set
          </button>
        </div>
      </BottomSheet>

      {/* Why the dots read the way they do */}
      <BottomSheet
        open={sessionDetail !== null}
        onClose={() => setSessionDetail(null)}
        blur
      >
        <div className="w-full bg-card rounded-t-3xl p-6">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm text-muted-foreground uppercase tracking-wider">
              Set {sessionDetail?.setNumber} progress
            </span>
            <button
              onClick={() => setSessionDetail(null)}
              className="text-primary text-sm font-medium"
            >
              Done
            </button>
          </div>
          {sessionDetail && (
            <>
              <p className="text-xs text-muted-foreground mb-4">
                {sessionDetail.suggestion.hitsAchieved} of{" "}
                {sessionDetail.suggestion.hitsRequired} sessions in a row.
              </p>
              <ul className="flex flex-col gap-2">
                {sessionDetail.suggestion.sessions?.map((session, i) => (
                  <li
                    // Two sessions of the same program on one day are two
                    // window slots (E-16), so the date alone is not unique.
                    key={`${session.date}-${i}`}
                    className="flex items-center justify-between gap-3 py-2 border-t border-border first:border-t-0"
                  >
                    <span className="text-sm font-medium shrink-0">
                      {formatSessionDate(session.date)}
                    </span>
                    <span
                      className={`text-xs text-right ${
                        session.status === "cleared"
                          ? "text-primary"
                          : session.status === "missed"
                            ? "text-orange-500"
                            : "text-muted-foreground"
                      }`}
                    >
                      {describeSessionOutcome(session)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-[10px] text-muted-foreground/70 mt-4">
                Sessions that did not answer the question — cut short, reported
                as tired, logged with no effort where an effort cap asked for
                one, or run under progression settings you have since changed —
                neither bank progress nor count against you.
              </p>
            </>
          )}
        </div>
      </BottomSheet>
    </>
  );
}

// ─── Progress detail ──────────────────────────────────────────────────────────

/** "Mon 3 Jun" from the session's stored date, which is already a plain date. */
function formatSessionDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/** One session's line in the dot detail sheet. */
function describeSessionOutcome(
  session: NonNullable<SetSuggestionDisplay["sessions"]>[number],
): string {
  if (session.status === "cleared") return "Cleared";
  if (session.status === "missed") {
    // The reps were there and the reserve was not. Reporting that as "short of
    // target" would send the lifter looking for a rep they did not miss.
    if (session.effortShort) return "Harder than prescribed";
    return session.shortfall != null
      ? `${session.shortfall} rep${session.shortfall === 1 ? "" : "s"} short`
      : "Short of target";
  }
  // Unknown, and the reason is worth naming — "nothing happened" is the report
  // this view exists to prevent.
  if (session.unknownReason === "effort") return "No effort logged";
  // The lifter changed a setting after this session, so it was judged under a
  // rule that no longer applies. Saying so is the whole point of E-13: the
  // alternative is a dot count that moves for reasons nothing on screen explains.
  if (session.unknownReason === "reconfigured") return "Before you changed the rule";
  if (session.unknownReason === "tired" || session.feeling === "Tired") {
    return "Tired — not counted";
  }
  if (session.prescribedSets != null && session.loggedSets < session.prescribedSets) {
    return `${session.loggedSets} of ${session.prescribedSets} sets logged`;
  }
  return "Not counted";
}

// ─── Insert rest button ───────────────────────────────────────────────────────

function InsertRestButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-2 py-1 text-muted-foreground/50 hover:text-primary transition-colors group"
    >
      <div className="flex-1 border-t border-dashed border-border group-hover:border-primary/40 transition-colors" />
      <span className="flex items-center gap-0.5 text-xs font-medium shrink-0">
        <Plus className="w-3 h-3" />
        REST
      </span>
      <div className="flex-1 border-t border-dashed border-border group-hover:border-primary/40 transition-colors" />
    </button>
  );
}

// ─── Suggestion chip ──────────────────────────────────────────────────────────

const CHIP_TONES = {
  primary: "bg-primary/15 text-primary",
  orange: "bg-orange-500/15 text-orange-600",
  amber: "bg-amber-500/15 text-amber-600",
} as const;

/**
 * A progression suggestion the user can apply, e.g. "↑ 85kg".
 *
 * Stays mounted after it is applied, switching to a settled "✓ 85kg" of the
 * same size instead of unmounting. Removing it used to shrink the row on the
 * very tap that applied it — with sibling propagation that collapsed two rows
 * at once and lifted the rest of the list 40px, so the next set slid up under
 * the finger that had just tapped. Holding the space also gives the tap the
 * only confirmation it has ever had.
 *
 * Never `disabled`: a disabled button swallows the click without running the
 * handler, so the row's own onClick would fire and navigate to the set editor.
 * The handler always stops propagation and only acts when there is something
 * to apply.
 */
function SuggestionChip({
  tone,
  applied,
  onApply,
  children,
}: {
  tone: keyof typeof CHIP_TONES;
  applied: boolean;
  onApply: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-disabled={applied}
      onClick={(e) => {
        e.stopPropagation();
        if (applied) return;
        onApply();
      }}
      className={`flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-semibold transition-opacity ${CHIP_TONES[tone]} ${applied ? "opacity-50" : "active:opacity-60"}`}
    >
      {children}
    </button>
  );
}

// ─── Sortable set row ─────────────────────────────────────────────────────────

function SortableSetRow({
  id,
  set,
  setNumber,
  totalSets,
  isEditing,
  isWorkout,
  isTimed,
  isRunning,
  discipline,
  isCompleted,
  programId,
  programExerciseId,
  onToggle,
  onLongPressToggle,
  onDelete,
  onStartTimer,
  onOpenLogRun,
  suggestion,
  onShowSessions,
  onApplySuggestion,
  onApplyRepSuggestion,
  overrideDurationSeconds,
  overrideStartDelaySeconds,
  overrideNotes,
  overrideActualReps,
  failed,
  hasPR,
}: {
  id: string;
  set: ProgramSet;
  setNumber: number;
  totalSets: number;
  isEditing: boolean;
  isWorkout: boolean;
  isTimed: boolean;
  isRunning: boolean;
  discipline: Discipline | null;
  isCompleted: boolean;
  programId: number;
  programExerciseId: number;
  onToggle: () => void;
  /** Long-press the toggle to record reps and effort. Absent = not offered. */
  onLongPressToggle?: () => void;
  onDelete: () => void;
  onStartTimer?: (setId: number, duration: number, startDelaySeconds?: number) => void;
  onOpenLogRun?: (setId: number) => void;
  suggestion?: SetSuggestionDisplay;
  onShowSessions?: (suggestion: SetSuggestionDisplay) => void;
  onApplySuggestion?: (setId: number, weightKg: number, adjustedReps?: number, durationSeconds?: number, distanceMeters?: number) => void;
  onApplyRepSuggestion?: (setId: number, reps: number) => void;
  overrideDurationSeconds?: number;
  overrideStartDelaySeconds?: number;
  overrideNotes?: string | null;
  /** Reps the session recorded for this set, when they differ from the target. */
  overrideActualReps?: number;
  failed?: boolean;
  hasPR?: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: !isEditing });

  const router = useRouter();
  const cfg = disciplineConfig(discipline);

  const setEditHref = isWorkout
    ? `/programs/${programId}/workout/exercises/${programExerciseId}/sets/${set.id}`
    // Carry edit mode through to the set editor so its "Sets" back link returns here in edit mode.
    : `/programs/${programId}/exercises/${programExerciseId}/sets/${set.id}${isEditing ? "?edit=true" : ""}`;

  const handleRowClick = () => {
    if (isEditing || isWorkout) router.push(setEditHref);
    // In program view mode (not editing, not workout) — do nothing
  };

  // Long-press the toggle to open the miss sheet. Only for a strength set
  // that has not been logged: a timed set's control is a play button, and a
  // logged set is corrected in the editor, which is where the notes are.
  const canLongPress =
    onLongPressToggle != null && !isCompleted && !isTimed && !isRunning && !isEditing;
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);

  const cancelLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };
  // Clear a press in flight when the row unmounts mid-hold (a drag-reorder, or
  // the exercise being left), so the sheet cannot open on a set that is gone.
  useEffect(() => cancelLongPress, []);

  const startLongPress = () => {
    if (!canLongPress) return;
    longPressFired.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      haptics.tap();
      onLongPressToggle?.();
    }, 450);
  };

  const handlePlayClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    // The press already opened the sheet; the click that follows it is not a
    // second instruction to log the set.
    if (longPressFired.current) {
      longPressFired.current = false;
      return;
    }
    if (isEditing || !isWorkout) return;
    if (isRunning && !isCompleted) {
      onOpenLogRun?.(set.id);
    } else if (isTimed && !isCompleted) {
      onStartTimer?.(set.id, overrideDurationSeconds ?? set.durationSeconds ?? 60, overrideStartDelaySeconds ?? set.startDelaySeconds ?? 0);
    } else {
      onToggle();
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
      className={`flex items-center gap-3 py-4 border-t border-b border-border transition-opacity duration-200${(isEditing || isWorkout) ? " cursor-pointer" : ""}${isWorkout && isCompleted ? " opacity-50" : ""}`}
      onClick={handleRowClick}
    >
      {isEditing && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="tap-slop w-7 h-7 rounded-full bg-destructive flex items-center justify-center shrink-0"
        >
          <Minus className="w-4 h-4 text-white" />
        </button>
      )}

      {isWorkout && (
        <button
          onClick={handlePlayClick}
          onPointerDown={startLongPress}
          onPointerUp={cancelLongPress}
          onPointerLeave={cancelLongPress}
          onPointerCancel={cancelLongPress}
          // iOS shows a selection callout on a long press otherwise.
          onContextMenu={(e) => e.preventDefault()}
          className={`tap-slop select-none w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-all duration-150 border-2 active:scale-90 ${
            isCompleted
              ? failed
                ? "bg-destructive border-destructive"
                : "bg-primary border-primary"
              : "border-primary bg-transparent"
          }`}
        >
          {isCompleted ? (
            failed ? (
              <X className="w-4 h-4 text-destructive-foreground" />
            ) : (
              <Check className="w-4 h-4 text-primary-foreground" />
            )
          ) : (
            <Play className="w-3 h-3 text-primary fill-primary" />
          )}
        </button>
      )}

      <div className="relative w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0">
        <span className="text-xs font-bold">{setNumber}</span>
        {isWorkout && suggestion?.sessionsUntilDeload === 1 && (
          <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-amber-500 border-2 border-background" />
        )}
      </div>

      {set.setType === "warmup" && (
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted rounded px-1.5 py-0.5 shrink-0">
          Warm-up
        </span>
      )}

      <div className="flex-1">
        {isRunning ? (
          <div>
            <div className="flex items-center gap-2">
              {set.distanceMeters ? (
                <p className="text-lg font-medium">
                  {formatEnduranceDistance(cfg.inputUnit, set.distanceMeters)}
                </p>
              ) : (
                <p className="text-lg font-medium text-muted-foreground">
                  {totalSets > 1 ? `Interval ${setNumber}` : cfg.label}
                </p>
              )}
              {set.targetHeartRateZone != null && (
                <span
                  className={`text-[10px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 shrink-0 ${
                    set.targetHeartRateZone >= 4
                      ? "bg-amber-500/15 text-amber-600"
                      : "bg-primary/10 text-primary"
                  }`}
                >
                  Z{set.targetHeartRateZone}
                </span>
              )}
            </div>
            {set.durationSeconds != null && (
              <p className="text-sm text-muted-foreground">
                {formatTime(set.durationSeconds)}
                {set.distanceMeters != null && set.distanceMeters > 0 && set.durationSeconds > 0
                  ? ` · ${formatEndurancePace(cfg.paceFormatter, set.durationSeconds, set.distanceMeters)}`
                  : ""}
              </p>
            )}
          </div>
        ) : isTimed || set.durationSeconds != null ? (
          <p className="text-lg font-medium">
            {formatTime(overrideDurationSeconds ?? Number(set.durationSeconds ?? 60))}
            {(overrideStartDelaySeconds ?? set.startDelaySeconds ?? 0) > 0 && (
              <span className="text-xs text-muted-foreground font-normal ml-1.5">
                +{overrideStartDelaySeconds ?? set.startDelaySeconds}s
              </span>
            )}
          </p>
        ) : (
          <p className="text-lg font-medium">
            {Number(set.weightKg ?? 0) > 0
              ? `${set.targetReps ?? "?"} x ${Number(set.weightKg)}kg`
              : `${set.targetReps ?? "?"} reps`}
            {/* The prescription still reads as the prescription; what was
                actually done sits beside it. Without this a set logged short
                looks identical to one that went to plan. */}
            {overrideActualReps != null && overrideActualReps !== set.targetReps && (
              <span className="text-sm text-muted-foreground font-normal ml-1.5">
                · {overrideActualReps} done
              </span>
            )}
          </p>
        )}
        {overrideNotes && (
          <p className="text-xs text-muted-foreground italic mt-0.5 line-clamp-2">
            {overrideNotes}
          </p>
        )}
        {/* Kept mounted after the set is completed. Unmounting it removed two
            lines from the row at the instant of the tap — up to 86px of jump
            when one tap catch-up-logs several sets — and threw away the "last
            time" context exactly when the user wants to compare against it.
            The row already dims via opacity-50 when completed, so it reads as
            history without extra work; the chips below simply stop acting. */}
        {isWorkout && suggestion && (() => {
          const currentWeight = Number(set.weightKg ?? 0);
          const currentReps = set.targetReps ?? 0;
          const weightPending =
            (suggestion.reason === "progressed" || suggestion.reason === "deload") &&
            currentWeight !== suggestion.suggestedWeightKg;
          const retryWeightPending =
            suggestion.reason === "retry" &&
            suggestion.suggestedReps === undefined &&
            currentWeight !== suggestion.suggestedWeightKg;
          // The three below compare against the set's current value like the
          // weight chips above, rather than just asking whether the suggestion
          // exists. Without that they were pending forever: taking the bump
          // never turned the chip's arrow into a tick, so a timed or endurance
          // set gave no sign the tap had registered.
          const retryRepsPending =
            suggestion.reason === "retry" &&
            suggestion.suggestedReps !== undefined &&
            suggestion.suggestedReps !== currentReps;
          // A reset moves two numbers at once, so it is outstanding while
          // either of them is still to be taken.
          const resetPending =
            suggestion.reason === "reset" &&
            (currentWeight !== suggestion.suggestedWeightKg ||
              (suggestion.suggestedReps !== undefined &&
                suggestion.suggestedReps !== currentReps));
          const repsPending =
            suggestion.reason === "progressed-reps" &&
            suggestion.suggestedReps !== undefined &&
            suggestion.suggestedReps > currentReps;
          const timePending =
            suggestion.reason === "progressed-time" &&
            suggestion.suggestedDurationSeconds !== undefined &&
            suggestion.suggestedDurationSeconds !== (set.durationSeconds ?? 0);
          const distancePending =
            suggestion.reason === "progressed-distance" &&
            suggestion.suggestedDistanceMeters !== undefined &&
            suggestion.suggestedDistanceMeters !== (set.distanceMeters ?? 0);
          const lastValue = isRunning
            ? suggestion.basedOnDistanceMeters != null
              ? formatEnduranceDistance(cfg.inputUnit, suggestion.basedOnDistanceMeters)
              : ""
            : isTimed
            ? suggestion.basedOnDurationSeconds != null
              ? formatTime(suggestion.basedOnDurationSeconds)
              : ""
            : suggestion.basedOnWeightKg > 0
            ? `${suggestion.basedOnWeightKg}kg`
            : suggestion.basedOnReps > 0
            ? `${suggestion.basedOnReps} reps`
            : "";
          const showRpe = !isRunning && !isTimed && suggestion.basedOnRpe != null;
          // Parenthesise the qualifier only when there is a value in front of
          // it. Timed sets routinely have no basedOn* value, which rendered a
          // bare "Last: (OK)" that reads as a broken template.
          const lastQualifier = `${suggestion.basedOnFeeling}${showRpe ? `, RPE ${suggestion.basedOnRpe}` : ""}`;
          const lastLabel = lastValue
            ? `Last: ${lastValue} (${lastQualifier})`
            : `Last: ${lastQualifier}`;

          // Progress dots: how many qualifying sessions are banked toward the
          // next bump. Shown for every progression-driven suggestion, not just
          // held ones — they used to vanish on the session the bump arrived,
          // which is exactly when "2 of 2" explains where the bump came from.
          const showProgressDots =
            suggestion.reason !== "manual" && suggestion.hitsRequired > 0;

          return (
            <div className="mt-0.5">
              {/* First line: last set info + PR badge + progress dots + manual badge.
                  min-h-5 is load-bearing: the PR badge is 20px (py-0.5 + text-xs)
                  while the label beside it is a 16px text line, so a set that earns
                  a PR grew this line 16 -> 20px on the tap that logged it and pushed
                  every row below it down 4px. Reserving the taller of the two means
                  the badge lands in space that already exists. Same reasoning as the
                  suggestion chip below, which stays mounted instead of unmounting. */}
              <div className="flex items-center gap-2 flex-wrap min-h-5">
                <span className="text-xs text-muted-foreground">{lastLabel}</span>
                {hasPR && (
                  <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-600 text-xs font-semibold">
                    🏆 PR
                  </span>
                )}
                {suggestion.reason === "manual" && (
                  <span className="text-[10px] text-muted-foreground/50 font-medium">
                    Manual
                  </span>
                )}
                {showProgressDots && (
                  // Tappable, because strictness without an explanation reads as
                  // the app being broken: one set short in three of the last
                  // five has to be visible on screen, not inferable. The dots
                  // themselves stay 6px; the hit area around them does not.
                  <button
                    type="button"
                    aria-label={`Progress: ${suggestion.hitsAchieved} of ${suggestion.hitsRequired} sessions`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onShowSessions?.(suggestion);
                    }}
                    disabled={!suggestion.sessions?.length}
                    className="flex items-center gap-1 -m-3 p-3 disabled:pointer-events-none"
                  >
                    {Array.from({ length: suggestion.hitsRequired }).map((_, i) => (
                      <div
                        key={i}
                        className={`w-1.5 h-1.5 rounded-full ${
                          i < suggestion.hitsAchieved
                            ? "bg-primary"
                            : "bg-muted-foreground/30"
                        }`}
                      />
                    ))}
                  </button>
                )}
              </div>
              {/* Second line: action buttons + readiness label */}
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {suggestion.reason === "progressed" && (
                  <SuggestionChip
                    tone="primary"
                    applied={!weightPending || isCompleted}
                    onApply={() => onApplySuggestion?.(set.id, suggestion.suggestedWeightKg)}
                  >
                    {/* Direction comes from the comparison, not the reason: a
                        suggestion is built from the last *logged* weight, so
                        after a lighter session a "progressed" value can sit
                        below the weight on the row. It is still worth offering
                        for today's session — it just isn't an increase. */}
                    {!weightPending
                      ? "✓"
                      : suggestion.suggestedWeightKg > currentWeight
                      ? "↑"
                      : "↓"}{" "}
                    {`${suggestion.suggestedWeightKg}kg`}
                    {suggestion.easyOverride && " — felt easy"}
                  </SuggestionChip>
                )}
                {suggestion.reason === "deload" && (
                  <SuggestionChip
                    tone="orange"
                    applied={!weightPending || isCompleted}
                    onApply={() => onApplySuggestion?.(set.id, suggestion.suggestedWeightKg)}
                  >
                    {weightPending ? "↓" : "✓"} {suggestion.suggestedWeightKg}kg — deload
                  </SuggestionChip>
                )}
                {suggestion.reason === "retry" && suggestion.suggestedReps === undefined && (
                  <SuggestionChip
                    tone="amber"
                    applied={!retryWeightPending || isCompleted}
                    onApply={() => onApplySuggestion?.(set.id, suggestion.suggestedWeightKg)}
                  >
                    {/* Same as the progressed chip: a retry is measured against
                        history, so it can still sit below the weight on the row. */}
                    {!retryWeightPending
                      ? "✓"
                      : suggestion.suggestedWeightKg > currentWeight
                      ? "↑"
                      : "↓"}{" "}
                    {suggestion.suggestedWeightKg}kg — retry
                  </SuggestionChip>
                )}
                {suggestion.reason === "retry" && suggestion.suggestedReps !== undefined && (
                  <SuggestionChip
                    tone="amber"
                    applied={!retryRepsPending || isCompleted}
                    onApply={() => onApplySuggestion?.(set.id, suggestion.suggestedWeightKg, suggestion.suggestedReps)}
                  >
                    {!retryRepsPending
                      ? "✓"
                      : (suggestion.suggestedReps ?? 0) > currentReps
                      ? "↑"
                      : "↓"}{" "}
                    {suggestion.suggestedReps} reps — retry
                  </SuggestionChip>
                )}
                {suggestion.reason === "progressed-reps" && suggestion.suggestedReps !== undefined && (
                  <SuggestionChip
                    tone="primary"
                    applied={!repsPending || isCompleted}
                    onApply={() => onApplyRepSuggestion?.(set.id, suggestion.suggestedReps!)}
                  >
                    {repsPending ? "↑" : "✓"} {suggestion.suggestedReps} reps
                    {suggestion.easyOverride && " — felt easy"}
                  </SuggestionChip>
                )}
                {suggestion.reason === "reset" && suggestion.suggestedReps !== undefined && (
                  <SuggestionChip
                    tone="primary"
                    applied={!resetPending || isCompleted}
                    onApply={() => onApplySuggestion?.(set.id, suggestion.suggestedWeightKg, suggestion.suggestedReps)}
                  >
                    {/* Both halves in one chip, because they are one move: the
                        reps drop is what the heavier load costs. Applying only
                        the weight would leave the lifter chasing the top of
                        the range at a load they have just earned. */}
                    {resetPending ? "↑" : "✓"} {suggestion.suggestedWeightKg}kg —
                    back to {suggestion.suggestedReps} reps
                    {suggestion.easyOverride && " — felt easy"}
                  </SuggestionChip>
                )}
                {suggestion.reason === "progressed-time" && suggestion.suggestedDurationSeconds !== undefined && (
                  <SuggestionChip
                    tone="primary"
                    applied={!timePending || isCompleted}
                    onApply={() => onApplySuggestion?.(set.id, suggestion.suggestedWeightKg, undefined, suggestion.suggestedDurationSeconds)}
                  >
                    {timePending ? "↑" : "✓"} {formatTime(suggestion.suggestedDurationSeconds)} duration
                  </SuggestionChip>
                )}
                {suggestion.reason === "progressed-distance" && suggestion.suggestedDistanceMeters !== undefined && (
                  <SuggestionChip
                    tone="primary"
                    applied={!distancePending || isCompleted}
                    onApply={() => onApplySuggestion?.(set.id, suggestion.suggestedWeightKg, undefined, undefined, suggestion.suggestedDistanceMeters)}
                  >
                    {distancePending ? "↑" : "✓"} {formatEnduranceDistance(cfg.inputUnit, suggestion.suggestedDistanceMeters)}
                  </SuggestionChip>
                )}
                {/* Distinct from "held", which renders nothing but the dots.
                    "Not enough sessions yet" and "you have not told me how hard
                    that was" are different answers, and showing both as silence
                    is what left people guessing. Nothing to apply, so it is a
                    label rather than a chip. */}
                {suggestion.reason === "held-unknown" && (
                  <span className="text-[10px] font-medium text-amber-600 dark:text-amber-500">
                    Log effort to progress
                  </span>
                )}
                {/* Same idea, two more answers the dots cannot give. Both mean
                    "this will not move until you change something", and both
                    name the thing. Nothing to apply, so both are labels. */}
                {suggestion.reason === "held-no-increment" && (
                  <span className="text-[10px] font-medium text-amber-600 dark:text-amber-500">
                    Set a weight increment to progress
                  </span>
                )}
                {suggestion.reason === "held-anchored" && (
                  <span className="text-[10px] text-muted-foreground/60">
                    Target set by your training cycle
                  </span>
                )}
                {suggestion.readinessModulated && (
                  <span className="text-[10px] text-muted-foreground/60">
                    ↓ adjusted for readiness
                  </span>
                )}
              </div>
            </div>
          );
        })()}
      </div>

      {isEditing && (
        <button
          {...attributes}
          {...listeners}
          className="w-8 h-8 flex items-center justify-center shrink-0 touch-none"
        >
          <GripVertical className="w-5 h-5 text-muted-foreground" />
        </button>
      )}
    </div>
  );
}

// ─── Sortable rest row ────────────────────────────────────────────────────────

function SortableRestRow({
  id,
  seconds,
  isEditing,
  isWorkout,
  restRemaining,
  restProgress,
  onDelete,
  onEdit,
}: {
  id: string;
  seconds: number;
  isEditing: boolean;
  isWorkout: boolean;
  restRemaining: number | undefined;
  restProgress: number;
  onDelete: () => void;
  onEdit: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: !isEditing });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
      className="pb-2 border-b border-border"
    >
      {isEditing ? (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onDelete}
            className="tap-slop w-7 h-7 rounded-full bg-destructive flex items-center justify-center shrink-0"
          >
            <Minus className="w-4 h-4 text-white" />
          </button>
          <div className="w-7 shrink-0" />
          <div className="w-7 shrink-0" />
          <button
            type="button"
            onClick={onEdit}
            className="flex-1 text-left active:opacity-60 transition-opacity"
          >
            <div className="text-xs text-muted-foreground uppercase tracking-wider">
              REST {formatTime(seconds)}
            </div>
          </button>
          <button
            {...attributes}
            {...listeners}
            className="w-8 h-8 flex items-center justify-center shrink-0 touch-none"
          >
            <GripVertical className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>
      ) : (
        <div onClick={isWorkout ? onEdit : undefined} className={isWorkout ? "cursor-pointer active:opacity-60 transition-opacity" : ""}>
          {/* tabular-nums: this re-renders every second, and proportional
              digits made the label breathe as the numbers changed. */}
          <div className="text-xs text-muted-foreground uppercase tracking-wider tabular-nums">
            REST{" "}
            {restRemaining !== undefined && restRemaining > 0
              ? formatTime(restRemaining)
              : formatTime(seconds)}
          </div>
          <div className="mt-1 h-1 bg-primary/20 rounded-full overflow-hidden">
            {/* scaleX, not width — width animates on the layout thread and
                relayouts every tick; transform is GPU-composited. */}
            <div
              className="h-full w-full origin-left bg-primary rounded-full transition-transform duration-1000 ease-linear"
              style={{ transform: `scaleX(${restProgress / 100})` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

