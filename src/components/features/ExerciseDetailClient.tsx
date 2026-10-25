"use client";

import { ExerciseProgressChart } from "@/components/features/ExerciseProgressChart";
import { formatPrValue, prTypeLabel } from "@/components/features/PrFeedList";
import { useToast } from "@/contexts/toast-context";
import { upsertExerciseNote } from "@/lib/actions/exercises";
import type { ExerciseHistorySession, ExerciseProgress, PrFeedEntry } from "@/lib/actions/metrics";
import { formatDateShort, loggedSetLabel } from "@/lib/utils/format";
import { callAction } from "@/lib/utils/stale-bundle";
import type { Exercise } from "@/types/workout";
import { ChevronLeftIcon, ChevronRight, Trophy } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1 mb-3">
      {children}
    </h2>
  );
}

/**
 * One exercise: the lifter's own note on it, progress chart, standing records
 * and recent sessions. Reached from the library and the workout.
 */
export function ExerciseDetailClient({
  exercise,
  note: initialNote,
  progress,
  records,
  history,
}: {
  exercise: Exercise;
  note: string | null;
  progress: ExerciseProgress[];
  records: PrFeedEntry[];
  history: ExerciseHistorySession[];
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [note, setNote] = useState(initialNote ?? "");
  const [savedNote, setSavedNote] = useState(initialNote ?? "");
  const isRun = exercise.category === "cardio";

  function handleBack() {
    // Opened from the library or a workout: go back there. Opened directly: the library.
    if (window.history.length > 1) router.back();
    else router.push("/exercises");
  }

  async function handleNoteBlur() {
    const next = note.trim();
    if (next === savedNote) return;
    const result = await callAction(upsertExerciseNote({ exerciseId: exercise.id, note: next }));
    if (!result.success) {
      setNote(savedNote);
      showToast({ variant: "error", message: "Couldn't save the note — try again" });
      return;
    }
    setNote(next);
    setSavedNote(next);
  }

  return (
    <div className="h-[100dvh] bg-background flex flex-col overflow-hidden">
      <div className="flex items-center px-4 pt-6 pb-4 shrink-0">
        <button
          onClick={handleBack}
          className="flex items-center gap-0.5 text-primary active:opacity-70 -ml-1 min-h-[44px]"
        >
          <ChevronLeftIcon className="h-5 w-5" />
          <span className="text-sm font-medium">Back</span>
        </button>
      </div>

      <main className="flex-1 overflow-y-auto px-4 pb-nav-safe space-y-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{exercise.name}</h1>
          <textarea
            aria-label="Your note"
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 1000))}
            onBlur={handleNoteBlur}
            placeholder="Your note: injuries, cues, what works"
            rows={2}
            className="mt-2 w-full rounded-xl bg-muted px-3 py-2 text-base placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>

        {!isRun && (
          <section className="rounded-2xl bg-muted p-4">
            <SectionLabel>Progress</SectionLabel>
            <ExerciseProgressChart data={progress} />
          </section>
        )}

        <section className="rounded-2xl bg-muted p-4">
          <SectionLabel>Records</SectionLabel>
          {records.length === 0 ? (
            <p className="text-sm text-muted-foreground px-1">No records yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {records.map((pr) => (
                <li key={pr.id} className="flex items-center gap-3 px-1 py-2.5">
                  <Trophy className="w-4 h-4 text-yellow-600 flex-none" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{prTypeLabel(pr)}</p>
                    <p className="text-xs text-muted-foreground">{formatDateShort(pr.achievedAt.slice(0, 10))}</p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums">{formatPrValue(pr)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <SectionLabel>History</SectionLabel>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground px-1">Not logged in a finished workout yet.</p>
          ) : (
            <div className="space-y-3">
              {history.map((session) => (
                <Link
                  key={session.sessionId}
                  href={`/history/${session.sessionId}`}
                  className="block bg-card rounded-2xl px-4 py-3 active:opacity-70"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">{formatDateShort(session.date)}</span>
                    <ChevronRight className="w-4 h-4 text-muted-foreground/40" />
                  </div>
                  <ul className="mt-1 space-y-0.5 text-sm">
                    {session.sets.map((set) => (
                      <li key={set.id} className="flex items-center gap-2">
                        <span className="text-muted-foreground w-12">
                          {set.setType === "warmup" ? "Warm" : `Set ${set.setNumber}`}
                        </span>
                        <span className="flex-1">
                          {loggedSetLabel(set, isRun)}
                          {set.isFailed && (
                            <span className="ml-1.5 align-middle text-[10px] font-semibold uppercase text-destructive bg-destructive/15 rounded-full px-1.5 py-0.5">
                              Failed
                            </span>
                          )}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {set.rir != null ? `RIR ${set.rir}` : set.rpe != null ? `RPE ${set.rpe}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Link>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
