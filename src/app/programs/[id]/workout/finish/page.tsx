"use client";

import {
  completeWorkoutSession,
  createWorkoutSession,
  deleteWorkoutSession,
} from "@/lib/actions/workout-sessions";
import { updateProgramSet } from "@/lib/actions/programs";
import { usePendingQueue } from "@/contexts/pending-queue-context";
import { useToast } from "@/contexts/toast-context";
import { useWorkoutSession } from "@/contexts/workout-session-context";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { WORKOUT_FEELINGS, type WorkoutFeeling } from "@/lib/validators/workout";
import { formatDateLong, formatDuration, formatTimeOfDay, toDateString } from "@/lib/utils/format";
import { Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, use, useMemo, useState } from "react";

type Feeling = WorkoutFeeling;
const FEELINGS: Feeling[] = [...WORKOUT_FEELINGS];

function FinishContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mountTime] = useState<number>(() => Date.now());
  const workoutSession = useWorkoutSession();
  const { enqueue: enqueuePending } = usePendingQueue();
  const { showToast } = useToast();

  const startTime = useMemo(() => {
    const contextStart = workoutSession?.startTime;
    if (contextStart) return new Date(contextStart);
    const raw = searchParams.get("start");
    return raw ? new Date(raw) : new Date();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const durationMinutes = useMemo(
    () => Math.max(1, Math.round((mountTime - startTime.getTime()) / 60000)),
    [mountTime, startTime],
  );

  const [feeling, setFeeling] = useState<Feeling>("Good");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  const saveSession = async () => {
    const existingSessionId = workoutSession?.sessionId;
    const isOffline = typeof navigator !== "undefined" && navigator.onLine === false;
    // Per-set overrides (weight/reps edited during the workout) are flushed
    // back to the program template so the next session starts from them.
    const overrideWrites = Object.entries(workoutSession?.overrides ?? {}).map(
      ([setId, ov]) => ({
        id: Number(setId),
        targetReps: ov.targetReps,
        weightKg: ov.weightKg,
        ...(ov.durationSeconds != null ? { durationSeconds: ov.durationSeconds } : {}),
      }),
    );
    // The client's end time, not the server's clock at write time: a queued
    // finish that replays hours later must still record when the workout
    // actually ended, or the session's duration is wrong.
    const endTime = new Date().toISOString();
    const trimmedNotes = notes.trim() || undefined;

    // Offline is checked BEFORE anything is awaited. These are Server Action
    // fetches — offline they reject, and this function used to blow up on the
    // override flush above, which left "Saving…" on screen forever and made
    // the queueing branch below unreachable.
    if (isOffline) {
      // A create+complete pair can't be queued safely (the second call needs
      // the first's response), so a session that was never created needs the
      // network.
      if (!existingSessionId) {
        showToast({ variant: "error", message: "Can't finish without a session — reconnect first" });
        return false;
      }
      overrideWrites.forEach((payload) =>
        enqueuePending({ kind: "updateProgramSet", payload }),
      );
      enqueuePending({
        kind: "completeWorkoutSession",
        payload: { sessionId: existingSessionId, endTime, feeling, notes: trimmedNotes },
      });
      showToast({ message: "Offline — workout saved locally, will sync when online", durationMs: 4000 });
      workoutSession?.clearActiveWorkout();
      router.replace("/");
      return true;
    }

    // Best-effort: a failed template flush costs the user next session's
    // starting weights, not this session's data, so it must not block the
    // save. The session write below is the one that matters.
    try {
      await Promise.all(overrideWrites.map((payload) => updateProgramSet(payload)));
    } catch (err) {
      console.error("[finish] override flush failed", err);
    }

    let sessionId = existingSessionId;
    if (sessionId == null) {
      // Fallback if the session wasn't pre-created (e.g. direct navigation).
      const created = await createWorkoutSession({
        date: toDateString(startTime),
        startTime: startTime.toISOString(),
      });
      if (!created.success) {
        showToast({ variant: "error", message: "Couldn't save workout — tap Save to retry" });
        return false;
      }
      sessionId = created.data.id;
    }

    const completed = await completeWorkoutSession({
      sessionId,
      endTime,
      feeling,
      notes: trimmedNotes,
    });
    // Keep the workout context and stay on the page when this fails — clearing
    // it would discard the feeling, notes and end time with no way back.
    if (!completed.success) {
      showToast({ variant: "error", message: "Couldn't save workout — tap Save to retry" });
      return false;
    }

    workoutSession?.clearActiveWorkout();
    router.replace("/");
    return true;
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveSession();
    } catch (err) {
      console.error("[finish] save failed", err);
      showToast({ variant: "error", message: "Couldn't save workout — tap Save to retry" });
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = async () => {
    setSaving(true);
    try {
      if (workoutSession?.sessionId) {
        const deleted = await deleteWorkoutSession(workoutSession.sessionId);
        // Don't clear the context on failure: the session and its logged sets
        // still exist server-side, so pretending it's discarded would leave an
        // open session the user thinks they got rid of.
        if (!deleted.success) {
          showToast({ variant: "error", message: "Couldn't discard workout — try again" });
          return;
        }
      }
      workoutSession?.clearActiveWorkout();
      router.replace("/");
    } catch (err) {
      console.error("[finish] discard failed", err);
      showToast({ variant: "error", message: "Couldn't discard workout — try again" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-[100dvh] bg-background flex flex-col pb-nav-safe">
      {/* Header */}
      <div className="flex items-center justify-center px-4 pt-6 pb-4 shrink-0">
        <div className="text-lg font-bold">Workout Complete</div>
      </div>

      <div className="flex-1 px-4 flex flex-col justify-between overflow-y-auto">
        <div className="space-y-4">
          {/* Summary card */}
          <div className="bg-card rounded-2xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Date</span>
              <span className="text-sm font-medium">{formatDateLong(startTime)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Started</span>
              <span className="text-sm font-medium">{formatTimeOfDay(startTime)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Duration</span>
              <span className="text-sm font-medium">
                {formatDuration(durationMinutes)}
              </span>
            </div>
          </div>

          {/* Feeling picker */}
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">
              How did it feel?
            </p>
            <div className="grid grid-cols-4 gap-2">
              {FEELINGS.map((f) => (
                <button
                  key={f}
                  onClick={() => setFeeling(f)}
                  className={`py-3 rounded-xl text-sm font-semibold transition-colors ${
                    feeling === f
                      ? "bg-primary text-primary-foreground"
                      : "bg-card text-foreground active:bg-muted"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">
              Notes <span className="normal-case font-normal">(optional)</span>
            </p>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything to remember for next time…"
              rows={3}
              maxLength={1000}
              className="w-full bg-card rounded-2xl px-4 py-3 text-sm resize-none outline-none focus:ring-2 ring-primary placeholder:text-muted-foreground/50"
            />
          </div>
        </div>

        {/* Action buttons */}
        <div className="pt-6 pb-2 space-y-3">
          <button
            onClick={() => setShowSaveConfirm(true)}
            disabled={saving}
            className="w-full rounded-xl bg-primary py-4 text-base font-semibold text-primary-foreground disabled:opacity-50 transition-all active:scale-95"
          >
            {saving ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="h-5 w-5 animate-spin" />
                Saving...
              </span>
            ) : (
              "Save Workout"
            )}
          </button>
          <button
            onClick={() => setShowDiscardConfirm(true)}
            disabled={saving}
            className="w-full py-3 text-sm font-medium text-destructive disabled:opacity-50 transition-opacity active:opacity-70"
          >
            Discard Workout
          </button>
        </div>
        <div aria-hidden="true" style={{ height: "var(--kb-height, 0px)" }} />
      </div>

      {/* Save confirmation sheet */}
      <BottomSheet
        open={showSaveConfirm}
        onClose={() => setShowSaveConfirm(false)}
      >
        <div className="w-full px-4 pb-8 space-y-2">
          <div className="bg-card rounded-2xl overflow-hidden text-center">
            <div className="px-4 pt-5 pb-4 border-b border-border">
              <p className="font-semibold text-base">Save this workout?</p>
              <p className="text-sm text-muted-foreground mt-1">Your sets and progress will be recorded.</p>
            </div>
            <button
              onClick={() => setShowSaveConfirm(false)}
              className="w-full py-4 text-base font-semibold text-primary active:bg-muted/50 transition-colors border-b border-border"
            >
              Cancel
            </button>
            <button
              onClick={() => { setShowSaveConfirm(false); handleSave(); }}
              className="w-full py-4 text-base font-semibold text-primary active:bg-muted/50 transition-colors"
            >
              Yes, save
            </button>
          </div>
        </div>
      </BottomSheet>

      {/* Discard confirmation sheet */}
      <BottomSheet
        open={showDiscardConfirm}
        onClose={() => setShowDiscardConfirm(false)}
      >
        <div className="w-full px-4 pb-8 space-y-2">
          <div className="bg-card rounded-2xl overflow-hidden text-center">
            <div className="px-4 pt-5 pb-4 border-b border-border">
              <p className="font-semibold text-base">Discard this workout?</p>
              <p className="text-sm text-muted-foreground mt-1">All logged sets will be deleted.</p>
            </div>
            <button
              onClick={() => setShowDiscardConfirm(false)}
              className="w-full py-4 text-base font-semibold text-primary active:bg-muted/50 transition-colors border-b border-border"
            >
              Cancel
            </button>
            <button
              onClick={handleDiscard}
              className="w-full py-4 text-base font-semibold text-destructive active:bg-muted/50 transition-colors"
            >
              Yes, discard
            </button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}

export default function WorkoutFinishPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  void use(params);
  return (
    <Suspense>
      <FinishContent />
    </Suspense>
  );
}
