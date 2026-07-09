"use client";

/**
 * AddSetForm
 *
 * Form for adding sets to a program exercise - displays existing sets.
 */

import { deleteProgramSet } from "@/lib/actions/programs";
import { formatTime } from "@/lib/utils/format";
import type { ProgramSet } from "@/types/workout";
import { Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Props = {
  programId: number;
  programExerciseId: number;
  sets: ProgramSet[];
};

export function AddSetForm({ programId, programExerciseId, sets }: Props) {
  const router = useRouter();

  async function handleDelete(setId: number) {
    await deleteProgramSet(setId, programId, programExerciseId);
    router.refresh();
  }

  if (sets.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4">No sets planned yet.</p>
    );
  }

  return (
    <div className="flex flex-col">
      {sets.map((s, index) => (
        <div key={s.id}>
          {/* Set row */}
          <div className="flex items-center gap-4 py-4 border-b border-border">
            {/* Set number badge */}
            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0">
              <span className="text-sm font-bold">{index + 1}</span>
            </div>

            {/* Tappable set details */}
            <Link
              href={`/programs/${programId}/exercises/${programExerciseId}/sets/${s.id}`}
              className="flex-1 active:opacity-60 transition-opacity"
            >
              {s.durationSeconds != null ? (
                <p className="text-lg font-medium">
                  {formatTime(Number(s.durationSeconds))} timed
                </p>
              ) : (
                <p className="text-lg font-medium">
                  {s.targetReps ?? "?"} x {Number(s.weightKg ?? 0)}kg
                </p>
              )}
            </Link>

            {/* Delete button */}
            <button
              onClick={() => handleDelete(s.id)}
              className="w-10 h-10 flex items-center justify-center active:opacity-60 transition-opacity"
            >
              <Trash2Icon className="h-5 w-5 text-destructive" />
            </button>
          </div>

          {/* Rest time row */}
          {index < sets.length - 1 && (
            <div className="py-2 pl-14">
              <span className="text-xs text-muted-foreground uppercase tracking-wider">
                REST {formatTime(Number(s.restTimeSeconds))}
              </span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

