"use client";

/**
 * The sessions part of the cycle detail (docs/plans/plan-tab-redesign.md, P2):
 * - CycleWeek: a weekday cycle's dated sessions, one week at a time, with the
 *   session sheet and "Did you do it?" (J5_CycleDetailWeek, J5_SessionFuture,
 *   J5_DidYouDoIt).
 * - TemplateWeek: a draft weekday cycle with no dates yet, as its template.
 * - RotationOrder: a rotation cycle's order with the next session, and the
 *   sheet that skips or swaps one coming session by its position
 *   (J3_RotationDetail, J3_SessionToday).
 */

import type { AnswerSession } from "@/components/features/answer-session";
import { type ExerciseLine, ExerciseList, PickList, PlannedSessionSheet, sheetRow } from "@/components/features/PlannedSessionActions";
import { PlanSheetPanel, SectionLabel } from "@/components/features/PlanSheetPanel";
import { DidYouDoItSheet } from "@/components/features/SessionAnswers";
import type { LibraryRow } from "@/components/features/WorkoutsLibraryClient";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { useUnits } from "@/contexts/user-settings-context";
import { updateRotationSession } from "@/lib/actions/planned-sessions";
import {
  type BlockWeek,
  type DetailSession,
  type RotationRow,
  dayMonth,
  doneLabel,
  rowAction,
  sessionSub,
  setsShort,
  weekDays,
  weekdayShort,
  weekRangeLabel,
} from "@/lib/utils/cycle-detail";
import { buildRunSetSummary } from "@/lib/utils/format";
import { shortDay } from "@/lib/utils/seasons";
import { callAction } from "@/lib/utils/stale-bundle";
import type { Units } from "@/lib/utils/units";
import type { ProgramWithExercises } from "@/types/workout";
import { ChevronLeft, ChevronRight, Link2, MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type ProgramOption = { id: number; name: string };

/** A program's exercises with their sets in short, for the session sheet. */
function exerciseLines(program: ProgramWithExercises | undefined, units: Units): ExerciseLine[] | null {
  if (!program) return null;
  return program.programExercises.map((pe) => ({
    name: pe.exercise.name,
    sets: pe.exercise.category === "cardio" ? buildRunSetSummary(pe.programSets, pe.exercise.discipline, units) : setsShort(pe.programSets),
  }));
}

const card = "flex flex-col rounded-[20px] bg-widget overflow-hidden";
const chevron = (
  <span aria-hidden className="text-lg text-muted-foreground">
    ›
  </span>
);

function TemplateLink({ href, title, sub }: { href: string; title: string; sub: string }) {
  return (
    <Link href={href} className="flex items-center justify-between gap-3 px-3.5 py-3 min-h-[60px] active:bg-foreground/5">
      <span className="flex flex-col gap-0.5">
        <span className="text-[15px] font-medium">{title}</span>
        <span className="text-[13px] text-muted-foreground">{sub}</span>
      </span>
      {chevron}
    </Link>
  );
}

const weekButton = "w-11 h-11 rounded-full bg-widget flex items-center justify-center active:opacity-70 disabled:text-muted-foreground disabled:opacity-60";

export function CycleWeek({
  weeks,
  initialWeek,
  sessions,
  today,
  phaseLine,
  programs,
  library,
  programsMap,
  templateHref,
}: {
  weeks: BlockWeek[];
  initialWeek: number;
  sessions: DetailSession[];
  today: string;
  phaseLine: string | null;
  programs: ProgramOption[];
  library?: LibraryRow[];
  programsMap: Record<number, ProgramWithExercises>;
  templateHref: string;
}) {
  const units = useUnits();
  const [index, setIndex] = useState(initialWeek);
  const [open, setOpen] = useState<DetailSession | null>(null);
  const [answering, setAnswering] = useState<AnswerSession | null>(null);
  const week = weeks[index];
  const days = weekDays(week);
  const inWeek = sessions.filter((s) => s.date >= week.from && s.date <= week.to);
  const keyDates = inWeek.filter((s) => s.key && s.status !== "skipped").map((s) => s.date);

  return (
    <>
      <div className="flex items-center justify-between">
        <button type="button" aria-label="Previous week" disabled={index === 0} onClick={() => setIndex(index - 1)} className={weekButton}>
          <ChevronLeft className="w-[18px] h-[18px]" aria-hidden />
        </button>
        <div className="flex flex-col items-center" aria-live="polite">
          <span className="text-[15px] font-semibold">
            Week {index + 1} of {weeks.length}
          </span>
          <span className="text-[13px] text-muted-foreground">{weekRangeLabel(week)}</span>
        </div>
        <button type="button" aria-label="Next week" disabled={index === weeks.length - 1} onClick={() => setIndex(index + 1)} className={weekButton}>
          <ChevronRight className="w-[18px] h-[18px]" aria-hidden />
        </button>
      </div>

      <div className={card} data-testid="cycle-week">
        {days.map((day) => {
          const list = inWeek.filter((s) => s.date === day);
          const dayCol = (first: boolean, rest = false) => (
            <span className="w-11 shrink-0 flex flex-col">
              {first && (
                <>
                  <span className={`text-[13px] font-semibold ${day === today ? "text-brand" : rest ? "text-muted-foreground" : ""}`}>{weekdayShort(day)}</span>
                  <span className="text-xs text-muted-foreground">{dayMonth(day)}</span>
                </>
              )}
            </span>
          );
          if (list.length === 0) {
            return (
              <div key={day} className="flex items-center gap-3 px-3.5 py-2 min-h-12 border-b border-hairline" data-testid="week-row">
                {dayCol(true, true)}
                <span className="text-[15px] font-medium text-muted-foreground">Rest</span>
              </div>
            );
          }
          return list.map((s, i) => {
            const action = rowAction(s, today);
            const sub = sessionSub(s);
            const inner = (
              <>
                {dayCol(i === 0)}
                {s.brick && <Link2 role="img" aria-label="Brick, linked to the ride" className="w-4 h-4 shrink-0 text-muted-foreground" />}
                <span className="flex-1 min-w-0 flex flex-col">
                  <span className={`text-[15px] font-medium truncate ${s.status === "skipped" ? "text-muted-foreground line-through" : ""}`}>{s.name}</span>
                  {sub && <span className="text-[13px] text-muted-foreground truncate">{sub}</span>}
                </span>
                {s.key && <span className="shrink-0 rounded-full px-2.5 py-0.5 ring-1 ring-inset ring-brand text-brand text-xs font-semibold">Key</span>}
                {action && chevron}
              </>
            );
            const rowClass = "flex w-full items-center gap-3 px-3.5 py-2 min-h-12 border-b border-hairline text-left";
            return action ? (
              <button
                key={s.id}
                type="button"
                data-testid="week-row"
                aria-label={`${shortDay(s.date)}: ${s.name}${sub ? `, ${sub}` : ""}`}
                onClick={() => (action === "answer" ? setAnswering(s.answer) : setOpen(s))}
                className={`${rowClass} active:bg-foreground/5`}
              >
                {inner}
              </button>
            ) : (
              <div key={s.id} data-testid="week-row" className={rowClass}>
                {inner}
              </div>
            );
          });
        })}
        <TemplateLink href={templateHref} title="Edit weekly template" sub="Changes apply from this week on to days you have not changed." />
      </div>

      <PlannedSessionSheet
        session={open}
        today={today}
        week={open ? weekDays(weeks.find((w) => open.date >= w.from && open.date <= w.to) ?? week) : days}
        firstDay={weeks[0].from}
        lastDay={weeks[weeks.length - 1].to}
        keyDates={keyDates}
        phaseLine={phaseLine}
        programs={programs}
        library={library}
        exercises={open?.programId != null ? exerciseLines(programsMap[open.programId], units) : null}
        onClose={() => setOpen(null)}
      />
      <DidYouDoItSheet key={answering?.id ?? "closed"} session={answering} dayLabel={answering ? shortDay(answering.date) : ""} onClose={() => setAnswering(null)} />
    </>
  );
}

/** A draft weekday cycle with no dates yet: the template's week, Monday to Sunday. */
export function TemplateWeek({ days, templateHref }: { days: { dow: number; sessions: { name: string; sub: string }[] }[]; templateHref: string }) {
  const NAMES = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return (
    <div className={card} data-testid="template-week">
      {days.map((d) =>
        (d.sessions.length ? d.sessions : [null]).map((s, i) => (
          <div key={`${d.dow}-${i}`} className="flex items-center gap-3 px-3.5 py-2 min-h-12 border-b border-hairline">
            <span className={`w-11 shrink-0 text-[13px] font-semibold ${s ? "" : "text-muted-foreground"}`}>{i === 0 ? NAMES[d.dow] : ""}</span>
            {s ? (
              <span className="flex-1 min-w-0 flex flex-col">
                <span className="text-[15px] font-medium truncate">{s.name}</span>
                {s.sub && <span className="text-[13px] text-muted-foreground truncate">{s.sub}</span>}
              </span>
            ) : (
              <span className="text-[15px] font-medium text-muted-foreground">Rest</span>
            )}
          </div>
        )),
      )}
      <TemplateLink href={templateHref} title="Edit weekly template" sub="Set the program for each day of the week." />
    </div>
  );
}

function rotationSub(row: RotationRow, today: string, exerciseCount: number | undefined): string {
  if (row.mark === "next") return "Next";
  if (row.mark === "skipped") return "Skipped";
  if (row.mark === "done" && row.lastDone) return doneLabel(row.lastDone, today);
  if (row.rest) return "Rest day";
  return exerciseCount != null ? `${exerciseCount} exercise${exerciseCount === 1 ? "" : "s"}` : "";
}

export function RotationOrder({
  cycleId,
  rows,
  today,
  programs,
  programsMap,
  editHref,
  active,
}: {
  cycleId: number;
  rows: RotationRow[];
  today: string;
  programs: ProgramOption[];
  programsMap: Record<number, ProgramWithExercises>;
  editHref: string;
  /** Only a running rotation has coming sessions to skip or swap. */
  active: boolean;
}) {
  const units = useUnits();
  const [open, setOpen] = useState<RotationRow | null>(null);

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-xs font-semibold tracking-[1px] uppercase text-muted-foreground">Order</h2>
        <Link href={editHref} className="min-h-11 flex items-center text-[15px] text-brand active:opacity-70">
          Edit order
        </Link>
      </div>
      <div className={card} data-testid="rotation-order">
        {rows.map((r) => {
          const next = r.mark === "next";
          const sub = rotationSub(r, today, r.programId != null ? programsMap[r.programId]?.programExercises.length : undefined);
          const body = (
            <>
              <span
                className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-[13px] font-semibold ${next ? "bg-primary text-primary-foreground" : "bg-widget-2 text-foreground/80"}`}
              >
                {r.n}
              </span>
              <span className="flex flex-col gap-0.5 min-w-0">
                <span className={`text-[15px] font-medium truncate ${r.rest ? "text-foreground/80" : ""}`}>{r.name}</span>
                <span className={`text-[13px] ${next ? "text-brand" : "text-muted-foreground"}`}>{sub}</span>
              </span>
            </>
          );
          const left = "flex-1 min-w-0 flex items-center gap-3 py-3 pl-4 min-h-11";
          return (
            <div key={r.slotId} className="flex items-center border-b border-hairline last:border-b-0" data-testid="rotation-row">
              {r.programId != null ? (
                <Link href={`/programs/${r.programId}`} className={`${left} active:opacity-70`}>
                  {body}
                </Link>
              ) : (
                <div className={left}>{body}</div>
              )}
              {active && r.upcoming && r.upcoming.rotationPosition != null && (
                <button
                  type="button"
                  aria-label={`Actions for ${r.name}`}
                  onClick={() => setOpen(r)}
                  className="w-11 h-11 mr-1.5 shrink-0 rounded-full flex items-center justify-center text-muted-foreground active:bg-foreground/5"
                >
                  <MoreHorizontal className="w-[18px] h-[18px]" aria-hidden />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <p className="mx-1 text-[13px] text-muted-foreground">Repeats every {rows.length} days. A missed session waits for you.</p>

      <RotationSessionSheet
        cycleId={cycleId}
        row={open}
        count={rows.length}
        today={today}
        programs={programs}
        exercises={open?.programId != null ? exerciseLines(programsMap[open.programId], units) : null}
        onClose={() => setOpen(null)}
      />
    </section>
  );
}

/**
 * One coming session of a rotation (J3_SessionToday): its exercises, Start
 * workout when it is today's, and the two changes a rotation allows: swap
 * the program or skip it this time, by its position in the walk.
 */
export function RotationSessionSheet({
  cycleId,
  row,
  count,
  today,
  programs,
  exercises,
  onClose,
}: {
  cycleId: number;
  row: RotationRow | null;
  count: number;
  today: string;
  programs: ProgramOption[];
  exercises: ExerciseLine[] | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [swapping, setSwapping] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState(row);
  if (row !== last) {
    setLast(row);
    if (row && row.slotId !== last?.slotId) {
      setSwapping(false);
      setError(null);
    }
  }

  async function run(op: { op: "skip" } | { op: "unskip" } | { op: "change"; programId: number }) {
    const position = row?.upcoming?.rotationPosition;
    if (pending || position == null) return;
    setPending(true);
    setError(null);
    const result = await callAction(updateRotationSession({ ...op, cycleId, rotationPosition: position }));
    setPending(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    onClose();
    router.refresh();
  }

  const up = row?.upcoming;
  const isToday = up?.date === today && up.status === "planned";
  const label = isToday ? "Today" : row?.mark === "next" ? "Next" : row?.mark === "skipped" ? "Skipped" : "Later";

  return (
    <BottomSheet open={row !== null} onClose={onClose}>
      {row && up && (
        <PlanSheetPanel label={isToday ? "Today's session" : `${row.name}, position ${row.n} of ${count}`} testId="rotation-sheet">
          <div className="flex flex-col gap-0.5">
            <SectionLabel accent={isToday}>{label}</SectionLabel>
            <h2 className="text-2xl font-semibold">{row.name}</h2>
            {row.programId != null ? (
              <Link href={`/programs/${row.programId}`} className="flex items-center min-h-11 text-sm text-muted-foreground active:opacity-70">
                Position {row.n} of {count} ·&nbsp;<span className="text-brand">See program ›</span>
              </Link>
            ) : (
              <p className="flex items-center min-h-11 text-sm text-muted-foreground">
                Position {row.n} of {count}
              </p>
            )}
          </div>
          {swapping ? (
            <PickList
              title="Swap program"
              items={programs.filter((p) => p.id !== row.programId)}
              pending={pending}
              onPick={(programId) => run({ op: "change", programId })}
              onBack={() => setSwapping(false)}
              empty="No other programs yet."
            />
          ) : (
            <>
              {exercises && exercises.length > 0 && up.status === "planned" && <ExerciseList exercises={exercises} />}
              {isToday && row.programId != null && (
                <Link
                  href={`/programs/${row.programId}/workout`}
                  className="flex h-[52px] items-center justify-center rounded-2xl bg-primary text-base font-semibold text-primary-foreground active:opacity-80"
                >
                  Start workout
                </Link>
              )}
              <div className="flex flex-col rounded-2xl bg-widget-2 overflow-hidden">
                {up.status === "skipped" ? (
                  <button type="button" disabled={pending} onClick={() => run({ op: "unskip" })} className={`${sheetRow} border-b-0`}>
                    Plan again
                  </button>
                ) : (
                  <>
                    <button type="button" onClick={() => setSwapping(true)} className={sheetRow}>
                      Swap program
                      <span aria-hidden className="text-muted-foreground">
                        ›
                      </span>
                    </button>
                    <button type="button" disabled={pending} onClick={() => run({ op: "skip" })} className={`${sheetRow} border-b-0 text-muted-foreground`}>
                      Skip this time
                    </button>
                  </>
                )}
              </div>
            </>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </PlanSheetPanel>
      )}
    </BottomSheet>
  );
}
