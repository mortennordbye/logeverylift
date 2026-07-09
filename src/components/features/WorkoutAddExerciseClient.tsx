"use client";

import { addExerciseToProgram } from "@/lib/actions/programs";
import type { Exercise } from "@/types/workout";
import { ChevronLeft, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  programId: number;
  exercises: Exercise[];
};

export function WorkoutAddExerciseClient({ programId, exercises }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);

  const filtered = query.trim()
    ? exercises.filter((ex) =>
        ex.name.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : exercises;

  async function handleSelect(exerciseId: number) {
    setLoading(true);
    await addExerciseToProgram({ programId, exerciseId });
    router.push(`/programs/${programId}/workout`);
  }

  return (
    <div className="h-[100dvh] bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center px-4 pt-6 pb-2 shrink-0">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex items-center gap-0.5 text-primary text-sm font-medium min-h-[44px] -ml-1 active:opacity-70"
        >
          <ChevronLeft className="w-5 h-5" />
          Back
        </button>
      </div>
      <div className="px-4 pb-4 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight">Add Exercise</h1>
      </div>

      {/* Search */}
      <div className="px-4 pb-3 shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="search"
            placeholder="Search exercises…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-xl bg-muted pl-9 pr-4 py-3 text-base outline-none focus:ring-2 ring-primary"
          />
        </div>
      </div>

      {/* Exercise list */}
      <div className="flex-1 overflow-y-auto px-4">
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center pt-8">
            No exercises found
          </p>
        ) : (
          <ul className="space-y-1">
            {filtered.map((ex) => (
              <li key={ex.id}>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => handleSelect(ex.id)}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-card active:bg-muted/50 transition-colors text-left disabled:opacity-50 min-h-[44px]"
                >
                  <span className="text-sm font-medium">{ex.name}</span>
                  <span className="text-xs text-muted-foreground capitalize">
                    {ex.category}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
