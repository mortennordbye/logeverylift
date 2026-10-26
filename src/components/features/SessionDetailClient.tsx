"use client";

import { BottomSheet } from "@/components/ui/BottomSheet";
import { useToast } from "@/contexts/toast-context";
import { deleteWorkoutSession } from "@/lib/actions/workout-sessions";
import { updateLoggedSet, updateWorkoutSession } from "@/lib/actions/workout-sets";
import { formatDateShort, formatDistanceKm, loggedSetLabel, toDateString } from "@/lib/utils/format";
import { HONEST_REPS_FROM } from "@/lib/utils/pr-provenance";
import { callAction } from "@/lib/utils/stale-bundle";
import type { SessionDetail, WorkoutSet } from "@/types/workout";
import { ChevronLeftIcon, ChevronRight, Dumbbell, Trash2 } from "lucide-react";
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

const INPUT_CLASS =
  "w-full rounded-xl bg-muted px-3 py-3 text-base outline-none focus:ring-2 focus:ring-primary";

export function SessionDetailClient({ detail }: { detail: SessionDetail }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(detail.date);
  const [notes, setNotes] = useState(detail.notes ?? "");
  const [savingSession, setSavingSession] = useState(false);
  const [editingSet, setEditingSet] = useState<{ set: WorkoutSet; isRun: boolean } | null>(null);

  // Auto sessions have no sets and their day is the cycle's; a session still
  // in progress is edited on the workout screen.
  const editable = detail.source !== "auto" && detail.isCompleted;
  const sessionChanged = date !== detail.date || notes.trim() !== (detail.notes ?? "");

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
    const result = await callAction(deleteWorkoutSession(detail.id));
    if (!result.success) {
      setDeleting(false);
      return;
    }
    router.push("/history");
  }

  async function handleSaveSession() {
    setSavingSession(true);
    const result = await callAction(
      updateWorkoutSession({ sessionId: detail.id, date, notes: notes.trim() || null }),
    );
    setSavingSession(false);
    if (!result.success) {
      showToast({ variant: "error", message: result.error });
      return;
    }
    router.refresh();
  }

  return (
    <div className="h-[100dvh] bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-6 pb-4 shrink-0">
        <Link href="/history" className="flex items-center gap-0.5 text-primary active:opacity-70 -ml-1 min-h-[44px]">
          <ChevronLeftIcon className="h-5 w-5" />
          <span className="text-sm font-medium">Back</span>
        </Link>
        <div className="flex items-center gap-1">
          {editable && (
            <button
              onClick={() => {
                setEditing((e) => !e);
                setDate(detail.date);
                setNotes(detail.notes ?? "");
              }}
              className="min-h-[44px] px-3 text-sm font-semibold text-primary active:opacity-70"
            >
              {editing ? "Done" : "Edit"}
            </button>
          )}
          <button
            onClick={() => setShowDeleteConfirm(true)}
            aria-label="Delete workout"
            className="w-11 h-11 flex items-center justify-center text-destructive active:opacity-70 transition-opacity"
          >
            <Trash2 className="h-5 w-5" />
          </button>
        </div>
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
        {editing ? (
          <div className="mt-4 space-y-3 rounded-2xl bg-card p-4">
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">Date</span>
              <input
                type="date"
                value={date}
                max={toDateString(new Date())}
                onChange={(e) => setDate(e.target.value)}
                className={`${INPUT_CLASS} mt-1 dark:[color-scheme:dark]`}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">Notes</span>
              <textarea
                value={notes}
                maxLength={1000}
                rows={2}
                onChange={(e) => setNotes(e.target.value)}
                className={`${INPUT_CLASS} mt-1 resize-none`}
              />
            </label>
            {detail.date < HONEST_REPS_FROM && (
              <p className="text-xs text-muted-foreground">
                Records from before {formatDateShort(HONEST_REPS_FROM)} stay as they were.
              </p>
            )}
            <button
              onClick={handleSaveSession}
              disabled={!sessionChanged || !date || savingSession}
              className="w-full min-h-[44px] rounded-xl bg-primary text-sm font-semibold text-primary-foreground active:opacity-80 disabled:opacity-40"
            >
              {savingSession ? "Saving..." : "Save date and notes"}
            </button>
            {detail.setsByExercise.length > 0 && (
              <p className="text-xs text-muted-foreground">Tap a set to correct it.</p>
            )}
          </div>
        ) : (
          detail.notes && (
            <p className="mt-3 text-sm text-muted-foreground">{detail.notes}</p>
          )
        )}
        {detail.reactions.length > 0 && (
          <p className="mt-3 text-sm text-muted-foreground">
            {detail.reactions.map((r) => `${r.emoji} ${r.fromName}`).join(" · ")}
          </p>
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
                      role={editing ? "button" : undefined}
                      tabIndex={editing ? 0 : undefined}
                      aria-label={editing ? `Edit ${group.exerciseName} set ${set.setNumber}` : undefined}
                      onClick={editing ? () => setEditingSet({ set, isRun }) : undefined}
                      onKeyDown={
                        editing
                          ? (e) => {
                              if (e.key === "Enter" || e.key === " ") setEditingSet({ set, isRun });
                            }
                          : undefined
                      }
                      className={`py-2.5 border-b border-border text-sm ${editing ? "min-h-[44px] active:bg-muted/50" : ""}`}
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
                              <span>{loggedSetLabel(set, true)}</span>
                              {(set.inclinePercent != null || set.heartRateZone != null) && (
                                <span className="block text-xs text-muted-foreground mt-0.5">
                                  {[
                                    set.inclinePercent != null ? `${set.inclinePercent}% incline` : null,
                                    set.heartRateZone != null ? `Z${set.heartRateZone}` : null,
                                  ].filter(Boolean).join(" · ")}
                                </span>
                              )}
                            </>
                          ) : (
                            loggedSetLabel(set, false)
                          )}
                          {set.isFailed && (
                            <span className="ml-1.5 align-middle text-[10px] font-semibold uppercase text-destructive bg-destructive/15 rounded-full px-1.5 py-0.5">
                              Failed
                            </span>
                          )}
                        </span>
                        <span className="text-muted-foreground w-16 text-right">
                          {/* Three states, not two: effort logged as RIR, effort
                              logged as a bare RPE (older rows and logged runs),
                              or no effort logged at all. The last used to render
                              as "RPE 7" for every set, which was the app talking,
                              not the lifter. */}
                          {set.rir != null
                            ? `RIR ${set.rir}`
                            : set.rpe != null
                            ? `RPE ${set.rpe}`
                            : ""}
                        </span>
                        {editing && <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
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

      <SetEditSheet
        target={editingSet}
        onClose={() => setEditingSet(null)}
        onSaved={() => {
          setEditingSet(null);
          router.refresh();
        }}
      />

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

/**
 * Correct one logged set: weight, reps, failed and its note. A run keeps its
 * distance and time as logged; only the flag and note change.
 */
function SetEditSheet({
  target,
  onClose,
  onSaved,
}: {
  target: { set: WorkoutSet; isRun: boolean } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  return (
    <BottomSheet open={target != null} onClose={onClose}>
      {target && <SetEditForm key={target.set.id} {...target} onClose={onClose} onSaved={onSaved} />}
    </BottomSheet>
  );
}

function SetEditForm({
  set,
  isRun,
  onClose,
  onSaved,
}: {
  set: WorkoutSet;
  isRun: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { showToast } = useToast();
  const [weight, setWeight] = useState(String(Number(set.weightKg)));
  const [reps, setReps] = useState(String(set.actualReps));
  const [isFailed, setIsFailed] = useState(set.isFailed);
  const [notes, setNotes] = useState(set.notes ?? "");
  const [saving, setSaving] = useState(false);

  const weightKg = Number(weight);
  const actualReps = Number(reps);
  const valid =
    weight !== "" && reps !== "" && weightKg >= 0 && weightKg < 1000 && Number.isInteger(actualReps) && actualReps >= 0;

  async function handleSave() {
    setSaving(true);
    const result = await callAction(
      updateLoggedSet({ setId: set.id, weightKg, actualReps, isFailed, notes: notes.trim() || null }),
    );
    setSaving(false);
    if (!result.success) {
      showToast({ variant: "error", message: result.error });
      return;
    }
    onSaved();
  }

  return (
    <div className="bg-background rounded-t-2xl px-4 pt-5 pb-10 space-y-4">
      <div className="w-10 h-1 bg-muted rounded-full mx-auto" />
      <h2 className="text-xl font-bold">Edit set {set.setNumber}</h2>
      {!isRun && (
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">Weight (kg)</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.5"
              min={0}
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              className={`${INPUT_CLASS} mt-1`}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">Reps</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={reps}
              onChange={(e) => setReps(e.target.value)}
              className={`${INPUT_CLASS} mt-1`}
            />
          </label>
        </div>
      )}
      <label className="flex min-h-[44px] items-center justify-between rounded-xl bg-muted px-3">
        <span className="text-base">Failed</span>
        <input
          type="checkbox"
          checked={isFailed}
          onChange={(e) => setIsFailed(e.target.checked)}
          className="h-5 w-5 accent-destructive"
        />
      </label>
      <label className="block">
        <span className="text-xs font-medium text-muted-foreground">Note</span>
        <textarea
          value={notes}
          maxLength={500}
          rows={2}
          onChange={(e) => setNotes(e.target.value)}
          className={`${INPUT_CLASS} mt-1 resize-none`}
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={onClose}
          className="min-h-[44px] rounded-xl bg-muted text-sm font-semibold active:opacity-80"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={!valid || saving}
          className="min-h-[44px] rounded-xl bg-primary text-sm font-semibold text-primary-foreground active:opacity-80 disabled:opacity-40"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}
