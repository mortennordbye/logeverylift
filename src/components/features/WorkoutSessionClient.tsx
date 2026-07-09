"use client";

import { WorkoutExerciseList } from "@/components/features/WorkoutExerciseList";
import { ReadinessSheet } from "@/components/features/ReadinessSheet";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { useWorkoutSession } from "@/contexts/workout-session-context";
import type { ExerciseInsight, WorkoutInsight } from "@/lib/actions/workout-sets";
import { formatTime } from "@/lib/utils/format";
import type { Discipline } from "@/lib/utils/discipline";
import {
    removeExerciseFromProgram,
    reorderProgramExercises,
} from "@/lib/actions/programs";
import type { ProgramSet } from "@/types/workout";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";


type Exercise = {
  id: number;
  exerciseId: number;
  name: string;
  sets: ProgramSet[];
  isTimed?: boolean;
  isRunning?: boolean;
  discipline?: Discipline | null;
};

type LastSession = {
  feeling: string | null;
  notes: string | null;
  date: string;
  durationMinutes: number;
};

const FEELING_COLORS: Record<string, string> = {
  Tired: "bg-red-500/20 text-red-500",
  OK: "bg-yellow-500/20 text-yellow-500",
  Good: "bg-green-500/20 text-green-500",
  Awesome: "bg-blue-500/20 text-blue-500",
};

const EXERCISE_INSIGHT_COLORS: Record<ExerciseInsight["status"], string> = {
  progressing: "bg-emerald-500/15 text-emerald-600",
  held: "bg-muted text-muted-foreground",
  near_deload: "bg-amber-500/15 text-amber-600",
  deloading: "bg-red-500/15 text-red-500",
};

const EXERCISE_INSIGHT_ICON: Record<ExerciseInsight["status"], string> = {
  progressing: "↑",
  held: "→",
  near_deload: "⚠",
  deloading: "↓",
};

type Props = {
  programId: number;
  programName: string;
  exercises: Exercise[];
  lastSession?: LastSession | null;
  insight?: WorkoutInsight | null;
  periodization?: { headline: string; note: string } | null;
};

export function WorkoutSessionClient({
  programId,
  programName,
  exercises: initial,
  lastSession = null,
  insight = null,
  periodization = null,
}: Props) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [showReadiness, setShowReadiness] = useState(false);
  const workoutSession = useWorkoutSession();

  // Session creation/restore is handled by WorkoutSessionInitializer, mounted
  // in the workout layout so deep links to /workout/exercises/... also get a
  // session. Don't duplicate the effect here — it would race.

  // Show readiness check-in once the session is live and readiness is unknown
  useEffect(() => {
    if (workoutSession?.sessionId != null && workoutSession.readiness === null) {
      setShowReadiness(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workoutSession?.sessionId]);

  const startTime = useMemo(() => new Date(), []);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const origin = workoutSession?.startTime
      ? new Date(workoutSession.startTime)
      : startTime;
    setElapsed(Math.floor((Date.now() - origin.getTime()) / 1000));
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - origin.getTime()) / 1000));
    }, 1000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workoutSession?.startTime]);

  const [showActionSheet, setShowActionSheet] = useState(false);
  const [showFinishConfirm, setShowFinishConfirm] = useState(false);
  const [exercises, setExercises] = useState(initial);
  const [noteDismissed, setNoteDismissed] = useState(false);

  async function handleDeleteExercise(peId: number) {
    setExercises((prev) => prev.filter((e) => e.id !== peId));
    await removeExerciseFromProgram(peId, programId);
    router.refresh();
  }

  async function handleReorder(orderedIds: number[]) {
    setExercises((prev) =>
      orderedIds.map((id) => prev.find((e) => e.id === id)!),
    );
    await reorderProgramExercises(programId, orderedIds);
  }

  return (
    <div className="h-[100dvh] pb-nav-safe bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-6 pb-2 shrink-0">
        {isEditing ? (
          <button
            type="button"
            onClick={() => setIsEditing(false)}
            className="text-primary text-sm font-medium"
          >
            Done
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setShowFinishConfirm(true)}
            className="text-primary text-sm font-medium"
          >
            Finished
          </button>
        )}
        <h1 className="text-3xl font-bold tracking-tight">Workout</h1>
        <div className="flex items-center gap-3">
          {!isEditing && (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="text-primary text-sm font-medium"
            >
              Edit
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowActionSheet(true)}
            className="w-7 h-7 rounded-full border-2 border-primary flex items-center justify-center"
          >
            <Plus className="w-4 h-4 text-primary" />
          </button>
        </div>
      </div>
      {/* Program name + elapsed time */}
      <div className="px-4 pb-3 shrink-0 flex flex-col items-center gap-0.5">
        <p className="text-sm text-muted-foreground">{programName}</p>
        <p className="text-xs text-muted-foreground/60 tabular-nums">{formatTime(elapsed)}</p>
      </div>

      {/* Periodization phase note — only for programs in an active periodized cycle */}
      {periodization && (
        <div className="px-4 pb-3 shrink-0 flex flex-col items-center gap-0.5 text-center">
          <p className="text-xs font-semibold text-primary">{periodization.headline}</p>
          <p className="text-[10px] text-muted-foreground">{periodization.note}</p>
        </div>
      )}

      {/* Last session note */}
      {lastSession && !noteDismissed && (lastSession.notes || lastSession.feeling) && (
        <div className="px-4 pb-3 shrink-0">
          <div className="bg-card rounded-2xl px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Last session
              </span>
              <span className="text-[10px] text-muted-foreground">
                · {new Date(lastSession.date + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                {lastSession.durationMinutes > 0 && ` · ${lastSession.durationMinutes}m`}
              </span>
              {lastSession.feeling && FEELING_COLORS[lastSession.feeling] && (
                <span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ${FEELING_COLORS[lastSession.feeling]}`}>
                  {lastSession.feeling}
                </span>
              )}
              <button
                onClick={() => setNoteDismissed(true)}
                className="ml-auto text-muted-foreground/50 active:opacity-60 text-base leading-none"
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
            {lastSession.notes && (
              <p className="text-sm text-foreground/80 mt-1.5 line-clamp-3">{lastSession.notes}</p>
            )}
          </div>
        </div>
      )}

      {/* Workout-level insight banner */}
      {insight && insight.type !== "on_track" && (
        <div className="px-4 pb-3 shrink-0">
          <div className="bg-card rounded-2xl px-4 py-3">
            <p className="text-sm font-semibold">{insight.headline}</p>
            {insight.detail && (
              <p className="text-xs text-muted-foreground mt-0.5">{insight.detail}</p>
            )}
          </div>
        </div>
      )}

      {/* Exercise insight pills — only show non-held exercises */}
      {insight?.exerciseInsights && insight.exerciseInsights.length > 0 && (() => {
        const notable = insight.exerciseInsights.filter((ex) => ex.status !== "held");
        const heldCount = insight.exerciseInsights.length - notable.length;
        if (notable.length === 0 && heldCount === 0) return null;
        return (
          <div className="px-4 pb-3 shrink-0">
            <div className="flex gap-2 overflow-x-auto pb-0.5 items-center">
              {notable.map((ex) => (
                <span
                  key={ex.exerciseName}
                  className={`flex-shrink-0 inline-flex items-center gap-1 text-xs font-semibold rounded-full px-2.5 py-1 ${EXERCISE_INSIGHT_COLORS[ex.status]}`}
                >
                  <span>{EXERCISE_INSIGHT_ICON[ex.status]}</span>
                  {ex.exerciseName}
                </span>
              ))}
              {heldCount > 0 && (
                <span className="flex-shrink-0 text-xs text-muted-foreground">{heldCount} on track</span>
              )}
            </div>
          </div>
        );
      })()}

      {/* Exercises list + History */}
      <div className="flex-1 px-4 overflow-y-auto">
        <WorkoutExerciseList
          programId={programId}
          exercises={exercises}
          isEditing={isEditing}
          onDeleteExercise={handleDeleteExercise}
          onReorderExercises={handleReorder}
        />

      </div>

      {/* Finish confirmation sheet */}
      <BottomSheet
        open={showFinishConfirm}
        onClose={() => setShowFinishConfirm(false)}
      >
        <div className="w-full px-4 pb-8 space-y-2">
          <div className="bg-card rounded-2xl overflow-hidden text-center">
            <div className="px-4 pt-5 pb-4 border-b border-border">
              <p className="font-semibold text-base">Finish workout?</p>
              <p className="text-sm text-muted-foreground mt-1">You&apos;ll be taken to the summary screen.</p>
            </div>
            <button
              onClick={() => setShowFinishConfirm(false)}
              className="w-full py-4 text-base font-semibold text-primary active:bg-muted/50 transition-colors border-b border-border"
            >
              Cancel
            </button>
            <button
              onClick={() => router.push(`/programs/${programId}/workout/finish?start=${startTime.toISOString()}`)}
              className="w-full py-4 text-base font-semibold text-primary active:bg-muted/50 transition-colors"
            >
              Yes, finish
            </button>
          </div>
        </div>
      </BottomSheet>

      {/* Pre-workout readiness check-in */}
      {showReadiness && (
        <ReadinessSheet
          onConfirm={(level) => {
            workoutSession?.confirmReadiness(level);
            setShowReadiness(false);
          }}
        />
      )}

      {/* Action Sheet */}
      <BottomSheet
        open={showActionSheet}
        onClose={() => setShowActionSheet(false)}
      >
        <div className="w-full px-4 pb-8 space-y-2">
          <div className="bg-card rounded-2xl overflow-hidden">
            <Link
              href={`/programs/${programId}/workout/add-exercise`}
              onClick={() => setShowActionSheet(false)}
              className="flex items-center justify-center py-4 text-base font-medium active:bg-muted/50 transition-colors"
            >
              Add Exercise
            </Link>
          </div>
          <div className="bg-card rounded-2xl overflow-hidden">
            <button
              onClick={() => setShowActionSheet(false)}
              className="w-full flex items-center justify-center py-4 text-base font-semibold text-primary active:bg-muted/50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}

