"use client";

import { PlanSheetPanel, SHEET_CANCEL, SectionLabel } from "@/components/features/PlanSheetPanel";
import { LABEL, PRIMARY_BUTTON } from "@/components/features/season-ui";
import type { LibraryRow } from "@/components/features/WorkoutsLibraryClient";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { updatePlannedSession } from "@/lib/actions/planned-sessions";
import { type DetailSession, dayMonth, sessionDayLabel, sessionState, weekdayShort } from "@/lib/utils/cycle-detail";
import { shortDay } from "@/lib/utils/seasons";
import { callAction } from "@/lib/utils/stale-bundle";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export type PlannedSessionLite = {
  id: number;
  date: string;
  status: "planned" | "done" | "missed" | "skipped";
  touched: boolean;
  templateDate: string | null;
};

/**
 * Move, skip, plan again or reset one dated session (docs/plans/sessions.md,
 * 5), from the calendar's day sheet. A logged session has no actions: past
 * sessions never change.
 */
export function PlannedSessionActions({
  session,
  today,
  lastDay,
  name,
}: {
  session: PlannedSessionLite;
  today: string;
  /** The last day of the block: the latest a session can move to. */
  lastDay: string;
  name: string;
}) {
  const router = useRouter();
  const [moving, setMoving] = useState(false);
  const [date, setDate] = useState(session.date < today ? today : session.date);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (session.status === "done") return null;

  async function run(op: Parameters<typeof updatePlannedSession>[0]) {
    if (pending) return;
    setPending(true);
    setError(null);
    const result = await callAction(updatePlannedSession(op));
    setPending(false);
    if (result.success) {
      setMoving(false);
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  const button = "min-h-[44px] rounded-xl px-4 text-sm font-medium active:opacity-70 disabled:opacity-50";
  const canReset = session.touched && session.templateDate != null && session.templateDate >= today;

  return (
    <div className="px-4 pb-3.5 flex flex-col gap-2">
      {moving ? (
        <div className="flex items-center gap-2">
          <label className="flex-1 text-sm">
            <span className="sr-only">New day for {name}</span>
            <input
              type="date"
              value={date}
              min={today}
              max={lastDay}
              onChange={(e) => setDate(e.target.value)}
              className="w-full min-h-[44px] rounded-xl border border-border bg-background px-3"
            />
          </label>
          <button
            type="button"
            disabled={pending || !date}
            onClick={() => run({ op: "move", id: session.id, date })}
            className={`${button} bg-primary text-primary-foreground`}
          >
            Save
          </button>
          <button type="button" onClick={() => setMoving(false)} className={`${button} border border-border`}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {session.status === "skipped" ? (
            session.date >= today && (
              <button type="button" disabled={pending} onClick={() => run({ op: "unskip", id: session.id })} className={`${button} border border-border`}>
                Plan {name} again
              </button>
            )
          ) : (
            <>
              <button type="button" disabled={pending} onClick={() => setMoving(true)} className={`${button} border border-border`}>
                Move {name}
              </button>
              <button type="button" disabled={pending} onClick={() => run({ op: "skip", id: session.id })} className={`${button} border border-border`}>
                Skip {name}
              </button>
            </>
          )}
          {canReset && (
            <button type="button" disabled={pending} onClick={() => run({ op: "reset", id: session.id })} className={`${button} text-muted-foreground`}>
              Back to the template
            </button>
          )}
        </div>
      )}
      {session.status === "skipped" && <p className="text-xs text-muted-foreground">Skipped</p>}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export type ExerciseLine = { name: string; sets: string };

/** A row of a sheet's action list: 52 px, a hairline under it, a chevron when it opens more. */
export const sheetRow =
  "flex w-full items-center justify-between min-h-[52px] px-3.5 border-b border-hairline text-left text-[15px] font-medium active:bg-foreground/5 disabled:opacity-50";

/** The exercises of a program, as the session sheet lists them. */
export function ExerciseList({ exercises }: { exercises: ExerciseLine[] }) {
  return (
    <ul className="flex flex-col rounded-2xl bg-widget-2 overflow-hidden">
      {exercises.map((e, i) => (
        <li key={i} className="flex justify-between gap-3 px-3.5 py-3 border-b border-hairline last:border-b-0 text-[15px]">
          <span>{e.name}</span>
          <span className="text-muted-foreground shrink-0">{e.sets}</span>
        </li>
      ))}
    </ul>
  );
}

/** A list of programs or workouts to pick one from, with a way back. */
export function PickList({
  title,
  items,
  pending,
  onPick,
  onBack,
  empty,
}: {
  title: string;
  items: { id: number; name: string; sub?: string }[];
  pending: boolean;
  onPick: (id: number) => void;
  onBack: () => void;
  empty: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-[17px] font-semibold">{title}</h3>
        <button type="button" onClick={onBack} className="min-h-11 px-2 text-[15px] text-brand active:opacity-70">
          Back
        </button>
      </div>
      {items.length === 0 && <p className="text-sm text-muted-foreground">{empty}</p>}
      <div className="flex flex-col rounded-2xl bg-widget-2 overflow-hidden">
        {items.map((it) => (
          <button key={it.id} type="button" disabled={pending} onClick={() => onPick(it.id)} className={`${sheetRow} flex-col !items-start justify-center gap-0.5 py-2`}>
            <span>{it.name}</span>
            {it.sub && <span className="text-[13px] font-normal text-muted-foreground">{it.sub}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * One dated session of a weekday cycle, from its row on the cycle detail
 * (docs/design/plan-redesign/J5_SessionFuture.dc.html): move it to another
 * day of its week, swap its program, use a workout (endurance only), give it
 * a label and a note, put it back to the template, skip it or plan it again.
 * Today's session also lists its exercises and starts the workout. Every
 * change is one `updatePlannedSession` call, for this day only.
 */
export function PlannedSessionSheet({
  session,
  today,
  week,
  firstDay,
  lastDay,
  keyDates,
  phaseLine,
  programs,
  library,
  exercises,
  onClose,
}: {
  session: DetailSession | null;
  today: string;
  /** The days of the week the session is in: where it can move. */
  week: string[];
  /** The block's first and last day: a session moves only inside them. */
  firstDay: string;
  lastDay: string;
  /** Days of this week with a key session (endurance only). */
  keyDates: string[];
  /** "Phase 1 · General" for a phase of a season. */
  phaseLine: string | null;
  programs: { id: number; name: string }[];
  /** The workouts library; only with the endurance switch on. */
  library?: LibraryRow[];
  exercises: ExerciseLine[] | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [view, setView] = useState<"main" | "swap" | "workout" | "label">("main");
  const [moving, setMoving] = useState(false);
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState(session);
  if (session !== last) {
    setLast(session);
    if (session && session.id !== last?.id) {
      setView("main");
      setMoving(false);
      setError(null);
    }
  }

  async function run(op: Parameters<typeof updatePlannedSession>[0]) {
    if (pending) return;
    setPending(true);
    setError(null);
    const result = await callAction(updatePlannedSession(op));
    setPending(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    onClose();
    router.refresh();
  }

  const s = session;
  const isToday = s?.date === today;
  // The header line says the state too: "Tue 17 Nov · Skipped" (J5-08, J5-13).
  const state = s ? sessionState(s) : null;
  const canReset = s != null && s.touched && s.templateDate != null && s.templateDate >= today;
  const otherKeys = keyDates.filter((d) => d !== s?.date);
  const anyPast = week.some((d) => d < today);
  // A missed key session: the day home suggests, or why there is none (D19).
  const moveDay = s?.moveTo?.date ?? null;
  const moveReason = s?.moveTo && s.moveTo.date === null ? s.moveTo.reason : null;
  const moveNote = [
    otherKeys.length ? `${otherKeys.map(weekdayShort).join(", ")} ${otherKeys.length === 1 ? "has a key session" : "have key sessions"}.` : null,
    anyPast ? "You cannot pick a day in the past." : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <BottomSheet open={s !== null} onClose={onClose}>
      {s && (
        <PlanSheetPanel
          label={`Session on ${sessionDayLabel(s.date, "")}`}
          testId="session-sheet"
          kicker={<SectionLabel accent={isToday}>{state ? `${sessionDayLabel(s.date, today)} · ${state}` : sessionDayLabel(s.date, today)}</SectionLabel>}
          title={s.summary ? `${s.name} · ${s.summary}` : s.name}
          sub={
            (phaseLine || s.programId != null) &&
            (s.programId != null ? (
              <Link href={`/programs/${s.programId}`} className="flex items-center min-h-11 text-sm text-muted-foreground active:opacity-70">
                {phaseLine ? `${phaseLine} · ` : ""}
                <span className="text-brand">See program ›</span>
              </Link>
            ) : (
              <p className="flex items-center min-h-11 text-sm text-muted-foreground">{phaseLine}</p>
            ))
          }
        >

          {view === "main" && (
            <>
              {moveDay && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run({ op: "move", id: s.id, date: moveDay })}
                  className="flex h-[52px] items-center justify-center rounded-2xl bg-primary text-base font-semibold text-primary-foreground active:opacity-80 disabled:opacity-50"
                >
                  Move to {shortDay(moveDay)}
                </button>
              )}
              {moveReason && <p className="text-sm text-muted-foreground">{moveReason}</p>}
              {isToday && s.status === "planned" && exercises && exercises.length > 0 && <ExerciseList exercises={exercises} />}
              {isToday && s.status === "planned" && s.programId != null && (
                <Link
                  href={`/programs/${s.programId}/workout?planned=${s.id}`}
                  className="flex h-[52px] items-center justify-center rounded-2xl bg-primary text-base font-semibold text-primary-foreground active:opacity-80"
                >
                  Start workout
                </Link>
              )}
              <div className="flex flex-col rounded-2xl bg-widget-2 overflow-hidden">
                {s.status !== "skipped" && (
                  <>
                    <button type="button" aria-expanded={moving} onClick={() => setMoving(!moving)} className={`${sheetRow} ${moving ? "border-b-0" : ""}`}>
                      Move to another day
                      <span aria-hidden className={`text-muted-foreground transition-transform ${moving ? "rotate-180" : ""}`}>
                        ⌄
                      </span>
                    </button>
                    {moving && (
                      <div className="flex flex-col gap-2.5 px-2.5 pb-3 border-b border-hairline">
                        <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${week.length}, minmax(0, 1fr))` }}>
                          {week.map((d) => {
                            const current = d === s.date;
                            const key = otherKeys.includes(d);
                            const closed = d < today || d < firstDay || d > lastDay;
                            return (
                              <button
                                key={d}
                                type="button"
                                aria-label={`${weekdayShort(d)} ${dayMonth(d)}${current ? ", current day" : key ? ", key session" : ""}`}
                                aria-pressed={current}
                                disabled={closed || current || pending}
                                onClick={() => run({ op: "move", id: s.id, date: d })}
                                className={`h-[52px] min-w-0 rounded-xl flex flex-col items-center justify-center gap-0.5 text-[13px] font-semibold active:opacity-70 ${
                                  current
                                    ? "bg-[color-mix(in_oklab,var(--brand)_18%,transparent)] text-brand"
                                    : `bg-widget ${key ? "ring-1 ring-inset ring-brand" : ""} ${closed ? "opacity-40" : ""}`
                                }`}
                              >
                                <span>{weekdayShort(d)}</span>
                                <span className={`text-[11px] font-medium ${current ? "text-brand" : "text-muted-foreground"}`}>{dayMonth(d).split(" ")[0]}</span>
                              </button>
                            );
                          })}
                        </div>
                        {moveNote && <span className="text-xs text-muted-foreground">{moveNote}</span>}
                      </div>
                    )}
                    <button type="button" onClick={() => setView("swap")} className={sheetRow}>
                      Swap program
                      <span aria-hidden className="text-muted-foreground">
                        ›
                      </span>
                    </button>
                    {library && (
                      <button type="button" onClick={() => setView("workout")} className={sheetRow}>
                        Use a workout
                        <span aria-hidden className="text-muted-foreground">
                          ›
                        </span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setLabel(s.label ?? "");
                        setNote(s.notes ?? "");
                        setView("label");
                      }}
                      className={sheetRow}
                    >
                      Label and note
                      <span aria-hidden className="text-muted-foreground">
                        ›
                      </span>
                    </button>
                  </>
                )}
                {canReset && (
                  <button type="button" disabled={pending} onClick={() => run({ op: "reset", id: s.id })} className={`${sheetRow} flex-col !items-start justify-center gap-0.5 min-h-[60px] py-2`}>
                    Back to the template
                    <span className="text-[13px] font-normal text-muted-foreground">This day was changed</span>
                  </button>
                )}
                {s.status === "skipped" ? (
                  <button type="button" disabled={pending} onClick={() => run({ op: "unskip", id: s.id })} className={`${sheetRow} border-b-0`}>
                    Plan again
                  </button>
                ) : (
                  <button type="button" disabled={pending} onClick={() => run({ op: "skip", id: s.id })} className={`${sheetRow} border-b-0 text-destructive`}>
                    Skip this session
                  </button>
                )}
              </div>
            </>
          )}

          {view === "swap" && (
            <PickList
              title="Swap program"
              items={programs.filter((p) => p.id !== s.programId)}
              pending={pending}
              onPick={(programId) => run({ op: "change", id: s.id, programId })}
              onBack={() => setView("main")}
              empty="No other programs yet."
            />
          )}

          {view === "workout" && library && (
            <PickList
              title="Use a workout"
              items={library.map((w) => ({ id: w.id, name: w.name, sub: w.summary }))}
              pending={pending}
              onPick={(workoutId) => run({ op: "set_workout", id: s.id, workoutId })}
              onBack={() => setView("main")}
              empty="No workouts yet. Ask your assistant to create workouts."
            />
          )}

          {view === "label" && (
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                run({ op: "change", id: s.id, label: label.trim() || null, notes: note.trim() || null });
              }}
            >
              <label className="flex flex-col gap-1.5">
                <span className={LABEL}>Label</span>
                <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={100} className="h-12 rounded-xl bg-widget-2 px-3 text-base text-foreground outline-none focus:ring-2 ring-brand" />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={LABEL}>Note</span>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} className="rounded-xl bg-widget-2 px-3 py-2.5 text-base text-foreground outline-none focus:ring-2 ring-brand resize-none" />
              </label>
              <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
                Save
              </button>
              <button type="button" onClick={() => setView("main")} className={SHEET_CANCEL}>
                Cancel
              </button>
            </form>
          )}

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <p className="text-[13px] text-muted-foreground">Only this day changes. The template stays the same.</p>
        </PlanSheetPanel>
      )}
    </BottomSheet>
  );
}
