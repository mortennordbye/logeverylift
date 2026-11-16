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
import { type ExerciseLine, ExerciseList, KeyMark, PickList, PlannedSessionSheet, sheetRow } from "@/components/features/PlannedSessionActions";
import { PlanSheetPanel, SectionLabel } from "@/components/features/PlanSheetPanel";
import { DidYouDoItSheet } from "@/components/features/SessionAnswers";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { useUnits } from "@/contexts/user-settings-context";
import { updateRotationSession } from "@/lib/actions/planned-sessions";
import { dayMonth } from "@/lib/home/labels";
import {
  type BlockWeek,
  type DetailSession,
  type RotationRow,
  dayLabelOn,
  doneLabel,
  isMoved,
  rowAction,
  sessionSub,
  setsShort,
  weekDays,
  weekdayShort,
  weekRangeLabel,
} from "@/lib/utils/cycle-detail";
import { buildRunSetSummary } from "@/lib/utils/format";
import { keepDates } from "@/lib/utils/keep-dates";
import { dowOf } from "@/lib/utils/planned-sessions";
import { shortDay } from "@/lib/utils/seasons";
import { callAction } from "@/lib/utils/stale-bundle";
import type { Units } from "@/lib/utils/units";
import type { ProgramWithExercises } from "@/types/workout";
import { ChevronLeft, ChevronRight, Link2, MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";

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
  programsMap,
  templateHref,
  dayLabels,
  dayNotes,
  cut = false,
}: {
  weeks: BlockWeek[];
  initialWeek: number;
  sessions: DetailSession[];
  today: string;
  phaseLine: string | null;
  programs: ProgramOption[];
  programsMap: Record<number, ProgramWithExercises>;
  templateHref: string;
  /** The template's own names for days with no session, by weekday (1 = Monday). */
  dayLabels?: Record<number, string>;
  /** The notes of those labelled days, by weekday. */
  dayNotes?: Record<number, string>;
  /** A scheduled start ends the block early: "Week N" without "of M", as the Plan hero (round 10). */
  cut?: boolean;
}) {
  const units = useUnits();
  const [index, setIndex] = useState(initialWeek);
  const [open, setOpen] = useState<DetailSession | null>(null);
  // A labelled day with no session opens a small sheet with its label and note (J5-11).
  const [labelDay, setLabelDay] = useState<string | null>(null);
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
            {cut ? `Week ${index + 1}` : `Week ${index + 1} of ${weeks.length}`}
          </span>
          <span className="text-[13px] text-muted-foreground">{keepDates(weekRangeLabel(week))}</span>
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
          const label = dayLabelOn(dayLabels, day);
          // A label describes the day, so it stays when a session is moved onto it (round 10).
          let dayRow: ReactNode = null;
          if (list.length === 0 || label) {
            // A session moved off this day says where it went.
            const movedTo = list.length === 0 ? inWeek.find((s) => s.templateDate === day && isMoved(s)) : undefined;
            const restInner = (
              <>
                {dayCol(true, list.length === 0)}
                <span className="flex-1 min-w-0 flex flex-col">
                  {/* A label wraps: cut, it could not be read anywhere (J5-11). */}
                  <span className={`text-[15px] font-medium line-clamp-2 break-words ${label ? "text-foreground/80" : "text-muted-foreground"}`}>{label ?? "Rest"}</span>
                  {movedTo && <span className="text-[13px] text-muted-foreground truncate">Moved to {weekdayShort(movedTo.date)}</span>}
                </span>
                {label && chevron}
              </>
            );
            const restClass = "flex w-full items-center gap-3 px-3.5 py-2 min-h-12 border-b border-hairline text-left";
            dayRow = label ? (
              <button
                key={day}
                type="button"
                data-testid="week-row"
                aria-label={`${shortDay(day)}: ${label}`}
                onClick={() => setLabelDay(day)}
                className={`${restClass} active:bg-foreground/5`}
              >
                {restInner}
              </button>
            ) : (
              <div key={day} className={restClass} data-testid="week-row">
                {restInner}
              </div>
            );
          }
          const rows = list.map((s, i) => {
            const action = rowAction(s, today);
            const sub = sessionSub(s);
            const inner = (
              <>
                {dayCol(i === 0 && dayRow == null)}
                {s.brick && <Link2 role="img" aria-label="Brick, linked to the ride" className="w-4 h-4 shrink-0 text-muted-foreground" />}
                <span className="flex-1 min-w-0 flex flex-col">
                  <span data-testid="week-row-name" className={`text-[15px] font-medium line-clamp-2 break-words ${s.status === "skipped" ? "text-muted-foreground line-through" : ""}`}>{s.name}</span>
                  {/* Two lines, not one: a cut status line lost the sport at 320 px. */}
                  {sub && <span className="text-[13px] text-muted-foreground line-clamp-2 break-words" data-testid="week-row-sub">{sub}</span>}
                </span>
                {s.key && <KeyMark />}
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
          return dayRow ? [dayRow, ...rows] : rows;
        })}
        <TemplateLink
          href={templateHref}
          title="Edit weekly template"
          // A template edit rewrites the untouched sessions from this week's Monday on: before the start that is every week.
          sub={weeks[0].from > today ? "The cycle has not started, so changes apply to every week." : "Changes apply from this week on to days you have not changed."}
        />
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
        exercises={open?.programId != null ? exerciseLines(programsMap[open.programId], units) : null}
        onClose={() => setOpen(null)}
      />
      <BottomSheet open={labelDay !== null} onClose={() => setLabelDay(null)}>
        {labelDay && (
          <PlanSheetPanel
            label={`Day on ${shortDay(labelDay)}`}
            testId="day-label-sheet"
            kicker={<SectionLabel accent={labelDay === today}>{shortDay(labelDay)}</SectionLabel>}
            title={dayLabelOn(dayLabels, labelDay)}
          >
            {dayNotes?.[dowOf(labelDay)] && <p className="text-[15px] text-muted-foreground whitespace-pre-line break-words">{dayNotes[dowOf(labelDay)]}</p>}
            <TemplateLink href={templateHref} title="Edit weekly template" sub="Change the label or the note for this weekday." />
          </PlanSheetPanel>
        )}
      </BottomSheet>
      <DidYouDoItSheet key={answering?.id ?? "closed"} session={answering} dayLabel={answering ? shortDay(answering.date) : ""} onClose={() => setAnswering(null)} />
    </>
  );
}

/** A draft weekday cycle with no dates yet: the template's week, Monday to Sunday. */
export function TemplateWeek({
  days,
  templateHref,
}: {
  /** `label` names a day with no session, such as "Mobility". */
  days: { dow: number; sessions: { name: string; sub: string }[]; label?: string | null }[];
  templateHref: string;
}) {
  const NAMES = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return (
    <div className={card} data-testid="template-week">
      {days.map((d) =>
        (d.sessions.length ? d.sessions : [null]).map((s, i) => (
          <div key={`${d.dow}-${i}`} className="flex items-center gap-3 px-3.5 py-2 min-h-12 border-b border-hairline">
            <span className={`w-11 shrink-0 text-[13px] font-semibold ${s ? "" : "text-muted-foreground"}`}>{i === 0 ? NAMES[d.dow] : ""}</span>
            {s ? (
              <span className="flex-1 min-w-0 flex flex-col">
                <span className="text-[15px] font-medium line-clamp-2 break-words">{s.name}</span>
                {s.sub && <span className="text-[13px] text-muted-foreground truncate">{s.sub}</span>}
              </span>
            ) : (
              <span className={`flex-1 min-w-0 truncate text-[15px] font-medium ${d.label ? "text-foreground/80" : "text-muted-foreground"}`}>{d.label ?? "Rest"}</span>
            )}
          </div>
        )),
      )}
      <TemplateLink href={templateHref} title="Edit weekly template" sub="Set the program for each day of the week." />
    </div>
  );
}

function rotationSub(row: RotationRow, today: string, exerciseCount: number | undefined): string {
  // A swapped turn keeps its mark when it is the next one (after a skip, say).
  if (row.mark === "next") return row.swapped ? "Next · Swapped" : "Next";
  if (row.mark === "skipped") return row.upcoming?.skipReason?.trim() ? `Skipped · ${row.upcoming.skipReason.trim()}` : "Skipped";
  if (row.mark === "swapped") return "Swapped";
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
                <span className={`text-[15px] font-medium line-clamp-2 break-words ${r.mark === "skipped" ? "text-muted-foreground line-through" : r.rest ? "text-foreground/80" : ""}`}>{r.name}</span>
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
  // A skipped turn names its reason, as its row and a skipped dated session do.
  const skipReason = up?.skipReason?.trim();
  const when = isToday ? "Today" : row?.mark === "next" ? "Next" : row?.mark === "skipped" ? (skipReason ? `Skipped · ${skipReason}` : "Skipped") : "Later";
  // A swapped turn says so, as its row does (J3-10).
  const label = row?.swapped ? `${when} · Swapped` : when;

  return (
    <BottomSheet open={row !== null} onClose={onClose}>
      {row && up && (
        <PlanSheetPanel
          label={isToday ? "Today's session" : `${row.name}, position ${row.n} of ${count}`}
          testId="rotation-sheet"
          kicker={<SectionLabel accent={isToday}>{label}</SectionLabel>}
          title={row.name}
          sub={
            <>
              {row.swappedFrom && <p className="text-sm text-muted-foreground">Swapped from {row.swappedFrom.name}</p>}
              {row.programId != null ? (
              <Link href={`/programs/${row.programId}`} className="flex items-center min-h-11 text-sm text-muted-foreground active:opacity-70">
                Position {row.n} of {count} ·&nbsp;<span className="text-brand">See program ›</span>
              </Link>
            ) : (
              <p className="flex items-center min-h-11 text-sm text-muted-foreground">
                Position {row.n} of {count}
              </p>
            )}
            </>
          }
        >
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
                    {row.swappedFrom && (
                      <button type="button" disabled={pending} onClick={() => run({ op: "change", programId: row.swappedFrom!.programId })} className={sheetRow}>
                        Back to {row.swappedFrom.name}
                      </button>
                    )}
                    <button type="button" onClick={() => setSwapping(true)} className={sheetRow}>
                      Swap program
                      <span aria-hidden className="text-muted-foreground">
                        ›
                      </span>
                    </button>
                    <button type="button" disabled={pending} onClick={() => run({ op: "skip" })} className={`${sheetRow} border-b-0`}>
                      Skip this session
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
