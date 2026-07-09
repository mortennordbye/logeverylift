"use client";

import { BottomSheet } from "@/components/ui/BottomSheet";
import { buildRunSetSummary, buildSetSummary } from "@/lib/utils/format";
import type { ProgramWithExercises, TrainingCycleWithSlots } from "@/types/workout";
import { ChevronLeftIcon, ChevronRight, ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

// Full Tailwind class strings — must not be generated dynamically
const PALETTE = [
  { dot: "bg-blue-500",    light: "bg-blue-500/15",    text: "text-blue-500"    },
  { dot: "bg-violet-500",  light: "bg-violet-500/15",  text: "text-violet-500"  },
  { dot: "bg-emerald-500", light: "bg-emerald-500/15", text: "text-emerald-500" },
  { dot: "bg-orange-500",  light: "bg-orange-500/15",  text: "text-orange-500"  },
  { dot: "bg-rose-500",    light: "bg-rose-500/15",    text: "text-rose-500"    },
];

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type Props = {
  cycles: TrainingCycleWithSlots[];
  completedDates: string[]; // "YYYY-MM-DD"
  programsMap: Record<number, ProgramWithExercises>;
};

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getMonthGrid(year: number, month: number): (string | null)[] {
  const firstDay = new Date(year, month, 1);
  const lastDate = new Date(year, month + 1, 0).getDate();
  const startPad = (firstDay.getDay() + 6) % 7; // shift so Mon=0
  const cells: (string | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= lastDate; d++) cells.push(toDateStr(new Date(year, month, d)));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

type DayInfo = {
  cycleIndex: number | null;
  cycleId: number | null;
  cycleName: string | null;
  cycleStatus: string | null;
  cycleScheduleType: string | null;
  programId: number | null;
  programName: string | null;
  slotLabel: string | null;
  slotNotes: string | null;
  isScheduled: boolean;
};

function getDayInfo(dateStr: string, cycles: TrainingCycleWithSlots[]): DayInfo {
  const [y, m, d] = dateStr.split("-").map(Number);
  const jsDay = new Date(y, m - 1, d).getDay();
  const dayOfWeek = jsDay === 0 ? 7 : jsDay; // 1=Mon…7=Sun

  for (let i = 0; i < cycles.length; i++) {
    const cycle = cycles[i];
    if (!cycle.startDate) continue;

    const [sy, sm, sd] = cycle.startDate.split("-").map(Number);
    const endDate = new Date(sy, sm - 1, sd);
    endDate.setDate(endDate.getDate() + Number(cycle.durationWeeks) * 7);
    const endStr = toDateStr(endDate);

    if (dateStr < cycle.startDate || dateStr >= endStr) continue;

    if (cycle.scheduleType === "day_of_week") {
      const slot = cycle.slots.find((s) => s.dayOfWeek === dayOfWeek);
      if (slot) {
        return {
          cycleIndex: i,
          cycleId: cycle.id,
          cycleName: cycle.name,
          cycleStatus: cycle.status,
          cycleScheduleType: "day_of_week",
          programId: slot.programId ?? null,
          programName: slot.program?.name ?? null,
          slotLabel: slot.label ?? null,
          slotNotes: slot.notes ?? null,
          isScheduled: true,
        };
      }
    } else {
      // rotation — cycle is active but exact slot depends on completion history
      return {
        cycleIndex: i,
        cycleId: cycle.id,
        cycleName: cycle.name,
        cycleStatus: cycle.status,
        cycleScheduleType: "rotation",
        programId: null,
        programName: null,
        slotLabel: null,
        slotNotes: null,
        isScheduled: true,
      };
    }
  }

  return {
    cycleIndex: null,
    cycleId: null,
    cycleName: null,
    cycleStatus: null,
    cycleScheduleType: null,
    programId: null,
    programName: null,
    slotLabel: null,
    slotNotes: null,
    isScheduled: false,
  };
}

function formatSheetDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return `${WEEKDAY_NAMES[date.getDay()]}, ${MONTH_NAMES[m - 1]} ${d}, ${y}`;
}

export function CycleCalendarClient({ cycles, completedDates, programsMap }: Props) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const todayStr = toDateStr(today);
  const completedSet = new Set(completedDates);

  // Assign colors only to cycles that have a startDate
  const visibleCycles = cycles.filter((c) => c.startDate);
  const colorMap = new Map<number, (typeof PALETTE)[number]>();
  visibleCycles.forEach((c) => {
    const idx = cycles.indexOf(c);
    colorMap.set(idx, PALETTE[colorMap.size % PALETTE.length]);
  });

  const grid = getMonthGrid(year, month);

  function prevMonth() {
    if (month === 0) { setYear((y) => y - 1); setMonth(11); }
    else setMonth((m) => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setYear((y) => y + 1); setMonth(0); }
    else setMonth((m) => m + 1);
  }

  // Detail sheet data
  const sheetInfo = selectedDate ? getDayInfo(selectedDate, cycles) : null;
  const sheetCompleted = selectedDate ? completedSet.has(selectedDate) : false;
  const sheetProgram = sheetInfo?.programId ? programsMap[sheetInfo.programId] : null;
  const sheetColors = sheetInfo?.cycleIndex != null ? colorMap.get(sheetInfo.cycleIndex) : null;

  return (
    <div className="flex-1 overflow-hidden px-4 pb-2 flex flex-col">
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-2">
        <button onClick={prevMonth} className="w-10 h-10 flex items-center justify-center active:opacity-60">
          <ChevronLeftIcon className="w-5 h-5" />
        </button>
        <span className="text-base font-semibold">{MONTH_NAMES[month]} {year}</span>
        <button onClick={nextMonth} className="w-10 h-10 flex items-center justify-center active:opacity-60">
          <ChevronRightIcon className="w-5 h-5" />
        </button>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7">
        {DAY_LABELS.map((label) => (
          <div key={label} className="text-center text-xs font-medium text-muted-foreground py-1">
            {label}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 flex-1">
        {grid.map((dateStr, idx) => {
          if (!dateStr) return <div key={`pad-${idx}`} />;

          const info = getDayInfo(dateStr, cycles);
          const isToday = dateStr === todayStr;
          const isCompleted = completedSet.has(dateStr);
          const isPast = dateStr < todayStr;
          const isSelected = dateStr === selectedDate;
          const colors = info.cycleIndex !== null ? colorMap.get(info.cycleIndex) : null;
          const dayNum = parseInt(dateStr.split("-")[2], 10);

          // Short program label for cell — use slot label or first word of program name (max 6 chars)
          const rawLabel = info.slotLabel ?? info.programName ?? null;
          const cellLabel = info.isScheduled && rawLabel
            ? (rawLabel.split(" ")[0].slice(0, 6))
            : null;

          return (
            <button
              key={dateStr}
              onClick={() => setSelectedDate(dateStr)}
              className={`flex flex-col items-center justify-center rounded-lg active:opacity-60 transition-opacity
                ${colors && info.isScheduled ? colors.light : ""}
                ${isSelected ? "ring-1 ring-primary/50" : ""}
              `}
            >
              <span
                className={`
                  w-8 h-8 flex items-center justify-center rounded-full text-sm font-medium
                  ${isToday ? "bg-primary text-primary-foreground" : ""}
                  ${!isToday && isPast && !info.isScheduled ? "text-muted-foreground/40" : ""}
                `}
              >
                {dayNum}
              </span>

              {info.isScheduled && colors ? (
                <span className={`w-1.5 h-1.5 rounded-full mt-0.5 ${colors.dot} ${isCompleted ? "opacity-100" : "opacity-30"}`} />
              ) : isCompleted ? (
                <span className="w-1.5 h-1.5 rounded-full mt-0.5 bg-primary" />
              ) : (
                <span className="w-1.5 h-1.5 mt-0.5" />
              )}

              {cellLabel && (
                <span className={`text-[9px] font-semibold leading-none mt-0.5 truncate max-w-full px-0.5 ${colors ? colors.text : "text-muted-foreground"} ${isCompleted ? "opacity-100" : "opacity-50"}`}>
                  {cellLabel}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      {visibleCycles.length > 0 && (
        <div className="mt-3 flex flex-col gap-1.5 shrink-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Cycles
          </p>
          {visibleCycles.map((cycle) => {
            const idx = cycles.indexOf(cycle);
            const colors = colorMap.get(idx);
            return (
              <div key={cycle.id} className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${colors?.dot}`} />
                <span className="text-sm font-medium">{cycle.name}</span>
                <span className="text-xs text-muted-foreground capitalize">· {cycle.status}</span>
              </div>
            );
          })}
          <div className="flex items-center gap-5 mt-2 pt-2 border-t border-border">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-foreground opacity-20" />
              <span className="text-xs text-muted-foreground">Scheduled</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-foreground opacity-80" />
              <span className="text-xs text-muted-foreground">Completed</span>
            </div>
          </div>
        </div>
      )}

      {visibleCycles.length === 0 && (
        <p className="text-sm text-muted-foreground text-center mt-4">
          No cycles with a start date yet.
        </p>
      )}

      {/* Day detail bottom sheet */}
      <BottomSheet open={!!selectedDate} onClose={() => setSelectedDate(null)}>
        {selectedDate && sheetInfo && (
          <div className="w-full px-4 pb-8 space-y-2">
            <div className="bg-card rounded-2xl overflow-hidden">
              {/* Date + completion header */}
              <div className="px-4 pt-5 pb-4 border-b border-border">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-base font-bold">{formatSheetDate(selectedDate)}</p>
                  {selectedDate === todayStr && (
                    <span className="text-xs font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full shrink-0">
                      Today
                    </span>
                  )}
                </div>
                {sheetCompleted && (
                  <p className="text-sm text-emerald-500 font-medium mt-1.5">✓ Workout completed</p>
                )}
              </div>

              {sheetInfo.isScheduled ? (
                <>
                  {/* Cycle row */}
                  <div className="px-4 py-3.5 border-b border-border flex items-center gap-3">
                    {sheetColors && (
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${sheetColors.dot}`} />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-muted-foreground">Cycle</p>
                      <p className="font-medium truncate">{sheetInfo.cycleName}</p>
                    </div>
                    <span className="text-xs text-muted-foreground capitalize shrink-0">{sheetInfo.cycleStatus}</span>
                  </div>

                  {/* Program row */}
                  {sheetInfo.programId ? (
                    <Link
                      href={`/programs/${sheetInfo.programId}`}
                      onClick={() => setSelectedDate(null)}
                      className="flex items-center gap-3 px-4 py-3.5 border-b border-border active:bg-muted/50 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-muted-foreground">Program</p>
                        <p className="font-medium truncate">{sheetInfo.programName}</p>
                        {sheetInfo.slotLabel && (
                          <p className="text-xs text-muted-foreground mt-0.5">{sheetInfo.slotLabel}</p>
                        )}
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                    </Link>
                  ) : (
                    <div className="px-4 py-3.5 border-b border-border">
                      <p className="text-xs text-muted-foreground">Program</p>
                      <p className="text-sm text-muted-foreground italic mt-0.5">No program assigned</p>
                    </div>
                  )}

                  {/* Exercise list */}
                  {sheetProgram && sheetProgram.programExercises.length > 0 && (
                    <div className="divide-y divide-border">
                      {sheetProgram.programExercises.map((pe) => {
                        const summary = pe.exercise.category === "cardio"
                          ? buildRunSetSummary(pe.programSets, pe.exercise.discipline)
                          : buildSetSummary(pe.programSets, pe.exercise.isTimed);
                        return (
                          <div key={pe.id} className="px-4 py-3">
                            <p className="text-sm font-medium">{pe.exercise.name}</p>
                            {summary && (
                              <p className="text-xs text-muted-foreground mt-0.5">{summary}</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Rotation notice */}
                  {sheetInfo.cycleScheduleType === "rotation" && (
                    <div className="px-4 py-3.5">
                      <p className="text-sm text-muted-foreground italic">
                        Rotation cycle — exact program depends on your completion history.
                      </p>
                    </div>
                  )}

                  {/* Notes */}
                  {sheetInfo.slotNotes && (
                    <div className="px-4 py-3.5 border-t border-border">
                      <p className="text-xs text-muted-foreground">Notes</p>
                      <p className="text-sm mt-0.5">{sheetInfo.slotNotes}</p>
                    </div>
                  )}
                </>
              ) : (
                <div className="px-4 py-8 text-center">
                  <p className="text-muted-foreground text-sm">
                    {sheetCompleted ? "Unscheduled workout" : "Rest day"}
                  </p>
                </div>
              )}
            </div>

            <button
              onClick={() => setSelectedDate(null)}
              className="w-full bg-card rounded-2xl py-4 text-base font-semibold text-primary active:bg-muted/50 transition-colors"
            >
              Close
            </button>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
