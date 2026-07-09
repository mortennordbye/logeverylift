"use client";

import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { ActiveCycleInfo, Program } from "@/types/workout";

type Props = {
  activeCycleInfo: ActiveCycleInfo | null;
  programs: Program[];
};

export default function NewWorkoutClient({ activeCycleInfo, programs }: Props) {
  const router = useRouter();
  const [showAllPrograms, setShowAllPrograms] = useState(false);

  const hasCycleProgram =
    activeCycleInfo !== null &&
    activeCycleInfo.todaySlot !== null &&
    activeCycleInfo.todaySlot?.program != null;

  const cycleProgram = hasCycleProgram
    ? activeCycleInfo!.todaySlot!.program!
    : null;

  return (
    <div className="flex-1 overflow-y-auto px-4">
      {hasCycleProgram && cycleProgram && (
        <>
          {/* Cycle card */}
          <div className="rounded-2xl bg-card p-5 mb-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              Today&apos;s Cycle
            </p>
            <p className="text-sm text-muted-foreground mb-1">
              {activeCycleInfo!.cycle.name} · Week{" "}
              {activeCycleInfo!.currentWeek}/{activeCycleInfo!.cycle.durationWeeks}
            </p>
            <p className="text-xl font-bold mb-4">{cycleProgram.name}</p>
            <div className="flex gap-3">
              <button
                onClick={() => router.push("/")}
                className="flex-1 py-3 rounded-lg border border-border text-sm font-medium active:bg-muted/50 transition-colors"
              >
                Skip today
              </button>
              <button
                onClick={() => router.push(`/programs/${cycleProgram.id}/workout`)}
                className="flex-1 py-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium active:opacity-80 transition-opacity"
              >
                Start
              </button>
            </div>
          </div>

          {/* Different program toggle */}
          {!showAllPrograms && (
            <button
              onClick={() => setShowAllPrograms(true)}
              className="flex items-center gap-1 text-sm text-primary font-medium mb-4 active:opacity-70 transition-opacity"
            >
              <ChevronDownIcon className="h-4 w-4" />
              Different program
            </button>
          )}
        </>
      )}

      {/* Program list */}
      {(!hasCycleProgram || showAllPrograms) && programs.length > 0 && (
        <div className="flex flex-col divide-y divide-border rounded-2xl bg-card overflow-hidden mb-4">
          {programs.map((program) => (
            <Link
              key={program.id}
              href={`/programs/${program.id}/workout`}
              className="flex items-center justify-between px-4 py-3.5 active:bg-muted/50 transition-colors"
            >
              <span className="text-base font-medium">{program.name}</span>
              <ChevronRightIcon className="h-5 w-5 text-muted-foreground" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
