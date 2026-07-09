"use client";

import { deleteWorkoutSession } from "@/lib/actions/workout-sessions";
import { formatDistanceKm, formatPace, formatTime } from "@/lib/utils/format";
import type { SessionDetail } from "@/types/workout";
import { ChevronLeftIcon, Dumbbell, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

const FEELING_COLORS: Record<string, string> = {
  Tired: "bg-red-500/20 text-red-500",
  OK: "bg-yellow-500/20 text-yellow-500",
  Good: "bg-green-500/20 text-green-500",
  Awesome: "bg-blue-500/20 text-blue-500",
};

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function formatDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

export function SessionDetailClient({ detail }: { detail: SessionDetail }) {
  const router = useRouter();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const startTime = new Date(detail.startTime);
  const duration =
    detail.endTime
      ? formatDuration(new Date(detail.endTime).getTime() - startTime.getTime())
      : null;

  const totalVolume = detail.setsByExercise
    .filter((g) => g.exerciseCategory !== "cardio")
    .flatMap((g) => g.sets)
    .reduce((sum, s) => sum + Number(s.weightKg) * s.actualReps, 0);

  const totalDistanceM = detail.setsByExercise
    .filter((g) => g.exerciseCategory === "cardio")
    .flatMap((g) => g.sets)
    .reduce((sum, s) => sum + (s.distanceMeters ?? 0), 0);

  const feelingColor = detail.feeling ? (FEELING_COLORS[detail.feeling] ?? "") : "";

  async function handleDelete() {
    setDeleting(true);
    await deleteWorkoutSession(detail.id);
    router.push("/history");
  }

  return (
    <div className="h-[100dvh] bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-6 pb-4 shrink-0">
        <Link href="/history" className="flex items-center gap-0.5 text-primary active:opacity-70 -ml-1 min-h-[44px]">
          <ChevronLeftIcon className="h-5 w-5" />
          <span className="text-sm font-medium">Back</span>
        </Link>
        <button
          onClick={() => setShowDeleteConfirm(true)}
          className="w-10 h-10 flex items-center justify-center text-destructive active:opacity-70 transition-opacity"
        >
          <Trash2 className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-nav-safe">
        {/* Date + program heading */}
        <h1 className="text-3xl font-bold tracking-tight">{formatDate(startTime)}</h1>
        <p className="text-muted-foreground mt-1">
          {detail.programName ?? "Ad hoc workout"}
        </p>

        {/* Summary row */}
        <div className="flex items-center gap-3 mt-3 flex-wrap">
          {duration && (
            <span className="text-sm text-muted-foreground">{duration}</span>
          )}
          {totalVolume > 0 && (
            <span className="text-sm text-muted-foreground">
              · {totalVolume.toLocaleString()}kg total
            </span>
          )}
          {totalDistanceM > 0 && (
            <span className="text-sm text-muted-foreground">
              · {formatDistanceKm(totalDistanceM)} run
            </span>
          )}
          {detail.feeling && FEELING_COLORS[detail.feeling] && (
            <span
              className={`text-xs font-medium rounded-full px-2.5 py-1 ${feelingColor}`}
            >
              {detail.feeling}
            </span>
          )}
        </div>
        {detail.notes && (
          <p className="mt-3 text-sm text-muted-foreground">{detail.notes}</p>
        )}

        {/* Exercises */}
        <div className="mt-6 space-y-6">
          {detail.setsByExercise.map((group) => (
            <div key={group.exerciseName}>
              <h2 className="text-base font-semibold mb-2">
                {group.exerciseName}
              </h2>
              <div className="space-y-0">
                {group.sets.map((set) => {
                  const isRun = group.exerciseCategory === "cardio";
                  return (
                    <div
                      key={set.id}
                      className="py-2.5 border-b border-border text-sm"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground w-12">
                          {isRun && group.sets.length > 1
                            ? `Int ${set.setNumber}`
                            : isRun
                            ? "Run"
                            : `Set ${set.setNumber}`}
                        </span>
                        <span className="font-medium flex-1 text-center">
                          {isRun ? (
                            <>
                              <span>
                                {[
                                  set.distanceMeters ? formatDistanceKm(set.distanceMeters) : null,
                                  set.durationSeconds != null ? formatTime(Number(set.durationSeconds)) : null,
                                  set.distanceMeters && set.durationSeconds
                                    ? formatPace(Number(set.durationSeconds), set.distanceMeters)
                                    : null,
                                ]
                                  .filter(Boolean)
                                  .join(" · ") || "—"}
                              </span>
                              {(set.inclinePercent != null || set.heartRateZone != null) && (
                                <span className="block text-xs text-muted-foreground mt-0.5">
                                  {[
                                    set.inclinePercent != null ? `${set.inclinePercent}% incline` : null,
                                    set.heartRateZone != null ? `Z${set.heartRateZone}` : null,
                                  ].filter(Boolean).join(" · ")}
                                </span>
                              )}
                            </>
                          ) : set.durationSeconds != null
                            ? formatTime(Number(set.durationSeconds))
                            : Number(set.weightKg) > 0
                            ? `${set.actualReps} × ${Number(set.weightKg)}kg`
                            : set.actualReps > 0
                            ? `${set.actualReps} reps`
                            : "—"}
                        </span>
                        <span className="text-muted-foreground w-16 text-right">
                          {set.rir != null ? `RIR ${set.rir}` : `RPE ${set.rpe}`}
                        </span>
                      </div>
                      {set.notes && (
                        <p className="text-xs text-muted-foreground italic mt-1 pl-12 pr-1">
                          {set.notes}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {detail.setsByExercise.length === 0 && (
            <div className="flex flex-col items-center gap-3 pt-16 text-center">
              <Dumbbell className="w-10 h-10 text-muted-foreground/40" />
              <p className="text-muted-foreground text-sm">
                No sets logged for this session.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Delete confirmation sheet */}
      {showDeleteConfirm && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-end"
          onClick={() => setShowDeleteConfirm(false)}
        >
          <div
            className="w-full px-4 pb-8 space-y-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-card rounded-2xl overflow-hidden text-center">
              <div className="px-4 pt-5 pb-4 border-b border-border">
                <p className="font-semibold text-base">Delete Workout?</p>
                <p className="text-sm text-muted-foreground mt-1">
                  This will permanently delete this session and all its sets.
                </p>
              </div>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="w-full py-4 text-base font-semibold text-destructive active:bg-muted/50 transition-colors disabled:opacity-50"
              >
                {deleting ? "Deleting..." : "Delete Workout"}
              </button>
            </div>
            <div className="bg-card rounded-2xl overflow-hidden">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="w-full py-4 text-base font-semibold active:bg-muted/50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
