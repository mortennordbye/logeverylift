"use client";

import { BackLink, useLeaveDeleted } from "@/components/ui/BackLink";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { PlanSheetPanel, SHEET_CANCEL } from "@/components/features/PlanSheetPanel";
import { ButtonReason, Chip, DESTRUCTIVE_TEXT, INNER_FIELD, LABEL, PRIMARY_BUTTON, RACE_KIND_LABELS, RaceKindChips, RacePriorityRow, SectionLabel, Segmented, TriDistanceOptions } from "@/components/features/season-ui";
import {
  addRaceAction,
  clearReplanAction,
  deleteSeasonAction,
  fitTaperAction,
  movePhaseAction,
  removePhaseAction,
  removeRaceAction,
  resumeSeasonAction,
  setPhaseAction,
  updateRaceAction,
} from "@/lib/actions/seasons";
import { TakeStartSheet } from "@/components/features/TakeStartSheet";
import type { ScheduledDraft } from "@/lib/utils/cycle-start";
import { takeStartLines, type RunningBlock } from "@/lib/utils/season-start";
import { keepDates } from "@/lib/utils/keep-dates";
import { badgeAccent, nextPhaseBadge, phaseBarTone } from "@/lib/utils/plan-list";
import { callAction } from "@/lib/utils/stale-bundle";
import {
  PHASE_TYPE_LABELS,
  dayLabel,
  daysBetweenStr,
  lengthField,
  rangeLabel,
  runLength,
  seasonPaused,
  shortDay,
  switchLengthUnit,
  type LengthUnit,
  type RaceDiscipline,
  type RacePriority,
  type TaperFit,
  type TriDistance,
} from "@/lib/utils/seasons";
import type { PhaseType } from "@/lib/utils/periodization";
import type { ActionResult } from "@/types/workout";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type ScreenReaderInstructions,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

export type SeasonRaceView = {
  id: number;
  name: string;
  raceDate: string;
  discipline: RaceDiscipline;
  distance: TriDistance | null;
  distanceMeters: number | null;
  priority: RacePriority;
};

export type SeasonPhaseView = {
  id: number;
  name: string;
  phaseType: PhaseType | null;
  durationWeeks: number;
  durationDays: number | null;
  start: string;
  end: string;
  lengthDays: number;
  state: "done" | "active" | "planned";
};

type Props = {
  season: { id: number; name: string; goal: string | null; startDate: string; endDate: string; nextGoal: string | null };
  /** The user's today, YYYY-MM-DD, from the server. */
  today: string;
  enduranceEnabled: boolean;
  replan: { reason: string | null } | null;
  races: SeasonRaceView[];
  /** The A race the season plans for (seasonARace), if any. */
  aRaceId: number | null;
  phases: SeasonPhaseView[];
  taperFit: TaperFit;
  next: { cycleId: number; name: string; plannedStart: string; scheduled: boolean } | null;
  gapBefore: number;
  overrunAfter: number;
  /** The running cycle and the scheduled draft: what Resume ends and drops. */
  running: RunningBlock | null;
  scheduled: ScheduledDraft | null;
};

const PHASE_TYPES = Object.keys(PHASE_TYPE_LABELS) as PhaseType[];
const TRI_WORD: Record<TriDistance, string> = { full: "Full", half: "Half", olympic: "Olympic", sprint: "Sprint" };

type RaceDraft = { id?: number; name: string; raceDate: string; discipline: RaceDiscipline; distance: TriDistance | null; km: string; priority: RacePriority };
type PhaseDraft = { phase: SeasonPhaseView; phaseType: PhaseType | null; unit: LengthUnit; length: string; unitNote: string | null };

/** "Triathlon · Half · 29 Aug 2027" or "Run · 10 km · 3 May 2027". */
function raceSub(r: SeasonRaceView): string {
  const kind = r.discipline === "triathlon" ? (r.distance ? `Triathlon · ${TRI_WORD[r.distance]}` : "Triathlon") : r.distanceMeters ? `${RACE_KIND_LABELS[r.discipline]} · ${Math.round(r.distanceMeters / 100) / 10} km` : RACE_KIND_LABELS[r.discipline];
  return `${kind} · ${dayLabel(r.raceDate)}`;
}

/** The new order and the 1-based position for a drop, or null when nothing moved. */
export function phaseDrop(ids: number[], activeId: number, overId: number): { order: number[]; position: number } | null {
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from < 0 || to < 0 || from === to) return null;
  return { order: arrayMove(ids, from, to), position: to + 1 };
}

const DRAG_INSTRUCTIONS: ScreenReaderInstructions = {
  draggable: "To move a phase, press space or enter. Use the up and down arrow keys to move it, space or enter to drop it, or escape to cancel.",
};

/** What a screen reader hears during a drag: the phase names, not dnd-kit's item ids. */
export function phaseAnnouncements(nameOf: (id: UniqueIdentifier) => string): Announcements {
  return {
    onDragStart: ({ active }) => `Picked up ${nameOf(active.id)}.`,
    onDragOver: ({ active, over }) => (over ? `${nameOf(active.id)} is over ${nameOf(over.id)}.` : `${nameOf(active.id)} is over no phase.`),
    onDragEnd: ({ active, over }) =>
      over && over.id !== active.id ? `${nameOf(active.id)} dropped in the place of ${nameOf(over.id)}.` : `${nameOf(active.id)} was not moved.`,
    onDragCancel: ({ active }) => `${nameOf(active.id)} was not moved.`,
  };
}

/**
 * A season (J4_SeasonDetail): the re-plan banner, the A race with its
 * countdown and the phase bar, the phases (drag to reorder, tap to change
 * type or length), and the races. Endurance-only parts are not rendered when
 * the switch is off, unless the season already has races.
 */
export function SeasonDetailClient(p: Props) {
  const router = useRouter();
  const leaveDeleted = useLeaveDeleted();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [race, setRace] = useState<RaceDraft | null>(null);
  const [phase, setPhase] = useState<PhaseDraft | null>(null);
  const [menu, setMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmRemoveRace, setConfirmRemoveRace] = useState(false);
  const [confirmResume, setConfirmResume] = useState(false);
  // An error belongs to the sheet or the page action that caused it: opening
  // or closing a sheet starts afresh, so an old error never shows elsewhere.
  const sheet =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      setError(null);
      set(v);
    };
  const toRace = sheet(setRace);
  const toPhase = sheet(setPhase);
  const toMenu = sheet(setMenu);
  const toDelete = sheet(setConfirmDelete);
  const toRemoveRace = sheet(setConfirmRemoveRace);
  const toResume = sheet(setConfirmResume);
  const showRaces = p.enduranceEnabled || p.races.length > 0;
  const aRace = showRaces ? (p.races.find((r) => r.id === p.aRaceId) ?? null) : null;

  // The order on screen: follows the server, and moves at once on a drop.
  const [order, setOrder] = useState(() => p.phases.map((ph) => ph.id));
  const incoming = p.phases.map((ph) => ph.id).join(",");
  const lastIncoming = useRef(incoming);
  /* eslint-disable react-hooks/refs -- reset local state when the server's order changes (React's "storing information from previous renders") */
  if (lastIncoming.current !== incoming) {
    lastIncoming.current = incoming;
    setOrder(p.phases.map((ph) => ph.id));
  }
  /* eslint-enable react-hooks/refs */
  const byId = new Map(p.phases.map((ph) => [ph.id, ph]));
  const phases = order.map((id) => byId.get(id)).filter((ph): ph is SeasonPhaseView => ph != null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function run<T>(promise: Promise<ActionResult<T>>, after?: () => void) {
    setBusy(true);
    setError(null);
    const result = await callAction(promise);
    setBusy(false);
    if (!result.success) {
      setError(result.error);
      return false;
    }
    after?.();
    router.refresh();
    return true;
  }

  async function handleDragEnd(event: DragEndEvent) {
    if (!event.over) return;
    const drop = phaseDrop(order, Number(event.active.id), Number(event.over.id));
    if (!drop) return;
    const before = order;
    setOrder(drop.order);
    const ok = await run(movePhaseAction({ seasonId: p.season.id, cycleId: Number(event.active.id), position: drop.position }));
    if (!ok) setOrder(before);
  }

  function saveRace() {
    if (!race) return;
    const fields = {
      name: race.name.trim(),
      raceDate: race.raceDate,
      discipline: race.discipline,
      distance: race.discipline === "triathlon" ? race.distance : null,
      distanceMeters: race.discipline === "triathlon" || !race.km ? null : Math.round(Number(race.km) * 1000),
      priority: race.priority,
    };
    const action = race.id ? updateRaceAction({ seasonId: p.season.id, raceId: race.id, ...fields }) : addRaceAction({ seasonId: p.season.id, ...fields });
    void run(action, () => setRace(null));
  }

  function savePhase() {
    if (!phase) return;
    const n = Number(phase.length);
    if (!phase.length || n <= 0) return;
    const length = phase.unit === "days" ? { durationDays: n } : { durationWeeks: n, durationDays: null };
    const phaseType = p.enduranceEnabled ? { phaseType: phase.phaseType } : {};
    void run(setPhaseAction({ seasonId: p.season.id, cycleId: phase.phase.id, ...phaseType, ...length }), () => setPhase(null));
  }

  async function fitTaper() {
    const ok = await run(fitTaperAction({ seasonId: p.season.id }));
    // Fitting the taper is the re-plan the flag asked for.
    if (ok && p.replan) await run(clearReplanAction({ seasonId: p.season.id }));
  }

  async function deleteSeason() {
    setBusy(true);
    setError(null);
    const result = await callAction(deleteSeasonAction({ seasonId: p.season.id }));
    setBusy(false);
    if (!result.success) return setError(result.error);
    leaveDeleted("/cycles", [`/seasons/${p.season.id}`]);
  }

  const paused = seasonPaused(p.next, phases, p.today);
  const fit = p.taperFit;
  // A paused chain's dates assume a Resume today, so they raise no taper warning (J8-12).
  const misfit = !paused && (fit.status === "early" || fit.status === "late");
  const fitLine = misfit ? `Taper ends ${fit.days} day${fit.days === 1 ? "" : "s"} ${fit.status === "early" ? "before" : "after"} the race` : null;
  const showBanner = p.replan != null || (misfit && showRaces);
  const bannerTitle = p.replan
    ? misfit
      ? "Race date changed. The taper no longer ends on race day."
      : "Your races changed. The phases stay as they are."
    : "The taper does not end on race day.";

  const countdownTo = aRace?.raceDate ?? p.season.endDate;
  const daysLeft = daysBetweenStr(p.today, countdownTo);

  // Resume starts the next phase today when its day has come, else schedules
  // it: either way the running cycle ends then and another start is dropped.
  const resumeDay = p.next ? (p.next.plannedStart <= p.today ? p.today : p.next.plannedStart) : p.today;
  const resumeLines = p.next ? takeStartLines({ seasonId: p.season.id, day: resumeDay, running: p.running, scheduled: p.scheduled }) : [];
  const resume = () => run(resumeSeasonAction({ seasonId: p.season.id }), () => setConfirmResume(false));

  // The same badge as the Plan list (nextPhaseBadge): one answer to paused or next.
  function badge(ph: SeasonPhaseView): string {
    if (ph.state === "active") return "Now";
    if (p.next?.cycleId !== ph.id) return "";
    return nextPhaseBadge(p.next, phases, p.today);
  }
  const anyActive = phases.some((ph) => ph.state === "active");

  // An open sheet covers the page, so its error shows in the sheet.
  // Why Save race or Save phase is off.
  const raceReason = !race ? null : !race.name.trim() ? "Give the race a name." : !race.raceDate ? "Pick the race day." : null;
  const phaseReason = phase && !Number(phase.length) ? "Type a length." : null;
  const errorLine = error && (
    <p role="alert" className="text-sm text-[#ff6b5a]">
      {error}
    </p>
  );

  return (
    <>
      <header className="flex items-center justify-between px-4 pt-4">
        <BackLink fallback={{ href: "/cycles", label: "Plan" }} />
        <button type="button" aria-label="More actions" onClick={() => toMenu(true)} className="flex h-11 w-11 items-center justify-center rounded-full bg-widget active:opacity-70">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="12" r="1.8" />
            <circle cx="12" cy="12" r="1.8" />
            <circle cx="19" cy="12" r="1.8" />
          </svg>
        </button>
      </header>

      <div className="flex flex-col gap-4 px-4 pt-1 pb-nav-safe">
        <div className="flex flex-col gap-1">
          <h1 className="home-display text-[34px] leading-9 uppercase break-words">{p.season.name}</h1>
          <span className="text-[13px] text-muted-foreground">
            {keepDates(`${dayLabel(p.season.startDate)} to ${dayLabel(p.season.endDate)}`)}
          </span>
          {/* With no A race the hero card carries the goal. */}
          {p.season.goal && aRace && <span className="text-sm text-foreground/75">{p.season.goal}</span>}
          {p.season.nextGoal && <span className="text-[13px] text-muted-foreground">Next goal is {p.season.nextGoal}</span>}
        </div>

        {race == null && phase == null && !confirmDelete && !confirmResume && errorLine}

        {showBanner && (
          <section data-testid="replan-banner" className="flex flex-col gap-2.5 rounded-2xl border border-[color-mix(in_oklab,var(--home-fg)_16%,transparent)] bg-widget-2 px-4 py-3.5">
            <span className="text-[15px] font-semibold">{bannerTitle}</span>
            {p.replan?.reason && <span className="text-[13px] text-muted-foreground">{keepDates(`${p.replan.reason}.`)}</span>}
            <div className="flex items-center gap-2">
              {misfit && (
                <button type="button" disabled={busy} onClick={fitTaper} className="min-h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground active:opacity-80 disabled:opacity-50">
                  Fit the taper
                </button>
              )}
              {p.replan && (
                <button type="button" disabled={busy} onClick={() => run(clearReplanAction({ seasonId: p.season.id }))} className="min-h-11 px-3 text-sm font-medium active:opacity-70 disabled:opacity-50">
                  Keep as it is
                </button>
              )}
            </div>
          </section>
        )}

        <section data-testid="season-hero" className="flex flex-col gap-3.5 rounded-[20px] bg-widget px-[18px] py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <span className={LABEL}>{keepDates(aRace ? `${aRace.priority} race · ${dayLabel(aRace.raceDate)}` : `Goal by ${dayLabel(p.season.endDate)}`)}</span>
              <span className="text-[17px] font-semibold break-words">{aRace ? aRace.name : (p.season.goal ?? p.season.name)}</span>
              {/* The race-day plan (docs/plans/nutrition-and-race-day.md, 6): half and full for now. */}
              {aRace && p.enduranceEnabled && aRace.discipline === "triathlon" && (aRace.distance === "half" || aRace.distance === "full") && (
                <Link href={`/races/${aRace.id}/plan`} className="flex min-h-11 items-center text-sm font-medium text-primary active:opacity-70">
                  Race plan ›
                </Link>
              )}
            </div>
            {daysLeft >= 0 && (
              <div className="flex shrink-0 flex-col items-end" aria-label={`${daysLeft} days to go`}>
                <span className="home-display text-[44px] leading-10">{daysLeft}</span>
                <span className="text-xs text-muted-foreground">{daysLeft === 1 ? "day" : "days"}</span>
              </div>
            )}
          </div>
          {phases.length > 0 && (
            <div className="flex h-2.5 gap-[3px]" aria-hidden="true" data-testid="phase-bar">
              {phases.map((ph) => {
                // A phase that has not started is never filled (phaseBarTone), as on the Plan list.
                const tone = phaseBarTone(ph.state, !anyActive && p.next?.cycleId === ph.id);
                return (
                  <div
                    key={ph.id}
                    data-tone={tone}
                    style={{ flex: `${ph.lengthDays} 1 0` }}
                    className={`min-w-2 rounded ${tone === "grey" || tone === "next" ? "bg-[#707076]" : "bg-primary"} ${tone === "current" || tone === "next" ? "outline-2 outline-offset-1 outline-primary" : ""}`}
                  />
                );
              })}
            </div>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <SectionLabel>Phases</SectionLabel>
          {phases.length > 0 && (
            <DndContext
              id="season-phases"
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
              accessibility={{ announcements: phaseAnnouncements((id) => byId.get(Number(id))?.name ?? "phase"), screenReaderInstructions: DRAG_INSTRUCTIONS }}
            >
              <SortableContext items={order} strategy={verticalListSortingStrategy}>
                <ul data-testid="season-phases" className="flex flex-col overflow-hidden rounded-[20px] bg-widget">
                  {phases.map((ph) => (
                    <PhaseRow
                      key={ph.id}
                      phase={ph}
                      sub={`${p.enduranceEnabled && ph.phaseType ? `${PHASE_TYPE_LABELS[ph.phaseType]} · ` : ""}${runLength(ph)} · ${rangeLabel(ph.start, ph.end)}`}
                      warn={misfit && "taperId" in fit && fit.taperId === ph.id && showRaces ? fitLine : null}
                      badge={badge(ph)}
                      onOpen={() => toPhase({ phase: ph, phaseType: ph.phaseType, ...lengthField(ph), unitNote: null })}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          )}
          <Link href={`/seasons/${p.season.id}/phases/new`} className="flex min-h-11 items-center self-start px-1 text-[15px] font-medium text-primary active:opacity-70">
            + Add phase
          </Link>
          <span className="mx-1 text-[13px] text-muted-foreground">Each phase starts the day after the one before.</span>
          {p.next && !p.next.scheduled && (
            <div className="mx-1 flex items-center justify-between gap-3">
              <p className="text-[13px] text-muted-foreground">
                {paused ? "Paused. The next phase is not scheduled." : `“${p.next.name}” is not started.`}
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => (resumeLines.length > 0 ? toResume(true) : resume())}
                className="min-h-11 shrink-0 text-sm font-medium text-primary active:opacity-70"
              >
                {paused ? "Resume" : "Start"}
              </button>
            </div>
          )}
          {p.gapBefore > 0 && <p className="mx-1 text-[13px] text-muted-foreground">The first phase starts {p.gapBefore} days after the season starts.</p>}
          {p.overrunAfter > 0 && <p className="mx-1 text-[13px] text-muted-foreground">The last phase runs {p.overrunAfter} days past the season end.</p>}
        </section>

        {showRaces && (
          <section className="flex flex-col gap-2">
            <SectionLabel>Races</SectionLabel>
            {p.races.length > 0 && (
              <ul className="flex flex-col overflow-hidden rounded-[20px] bg-widget">
                {p.races.map((r) => (
                  <li key={r.id} className="border-b border-hairline last:border-0">
                    <button
                      type="button"
                      disabled={!p.enduranceEnabled}
                      onClick={() =>
                        toRace({ id: r.id, name: r.name, raceDate: r.raceDate, discipline: r.discipline, distance: r.distance, km: r.distanceMeters ? String(r.distanceMeters / 1000) : "", priority: r.priority })
                      }
                      className="flex min-h-11 w-full items-center gap-3 px-4 py-3 text-left active:opacity-80"
                    >
                      <span aria-label={`${r.priority} race`} className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold ${r.priority === "A" ? "bg-primary text-primary-foreground" : "bg-widget-2"}`}>
                        {r.priority}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span data-testid="race-name" className="line-clamp-2 break-words text-[15px] font-medium">{r.name}</span>
                        <span className="text-[13px] text-muted-foreground">{keepDates(raceSub(r))}</span>
                      </span>
                      <Chevron />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {p.enduranceEnabled && (
              <button
                type="button"
                onClick={() => toRace({ name: "", raceDate: "", discipline: "triathlon", distance: "half", km: "", priority: "A" })}
                className="flex min-h-11 items-center self-start px-1 text-[15px] font-medium text-primary active:opacity-70"
              >
                + Add race
              </button>
            )}
          </section>
        )}
      </div>

      <BottomSheet open={menu} onClose={() => toMenu(false)}>
        <PlanSheetPanel label="Season actions" title={p.season.name}>
          <div className="flex flex-col overflow-hidden rounded-2xl bg-widget-2">
            <Link href={`/seasons/${p.season.id}/edit`} className={MENU_ROW}>
              Edit details
            </Link>
            <Link href={`/seasons/${p.season.id}/history`} className={MENU_ROW}>
              Change history
            </Link>
            <button
              type="button"
              onClick={() => {
                setMenu(false);
                toDelete(true);
              }}
              className={`${MENU_ROW} ${DESTRUCTIVE_TEXT}`}
            >
              Delete season
            </button>
          </div>
        </PlanSheetPanel>
      </BottomSheet>

      <BottomSheet open={confirmDelete} onClose={() => toDelete(false)}>
        <PlanSheetPanel
          label="Delete this season?"
          title="Delete this season?"
          sub={<p className="text-sm text-muted-foreground">{keepDates("Its cycles stay. You can restore it from Recently deleted for 90 days.")}</p>}
        >
          {errorLine}
          <button type="button" disabled={busy} onClick={deleteSeason} className={DESTRUCTIVE_BUTTON}>
            Delete season
          </button>
          <button type="button" onClick={() => toDelete(false)} className={SHEET_CANCEL}>
            Cancel
          </button>
        </PlanSheetPanel>
      </BottomSheet>

      <BottomSheet open={race != null && confirmRemoveRace} onClose={() => toRemoveRace(false)}>
        {race?.id && (
          <PlanSheetPanel
            label="Remove this race?"
            title="Remove this race?"
            sub={<p className="text-sm text-muted-foreground">{race.name} leaves the season. Restore it from Change history.</p>}
          >
            {errorLine}
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run(removeRaceAction({ seasonId: p.season.id, raceId: race.id! }), () => {
                  setConfirmRemoveRace(false);
                  setRace(null);
                })
              }
              className={DESTRUCTIVE_BUTTON}
            >
              Remove race
            </button>
            <button type="button" onClick={() => toRemoveRace(false)} className={SHEET_CANCEL}>
              Cancel
            </button>
          </PlanSheetPanel>
        )}
      </BottomSheet>

      <BottomSheet open={race != null && !confirmRemoveRace} onClose={() => toRace(null)}>
        {race && (
          <PlanSheetPanel label={race.id ? "Edit race" : "New race"} title={race.id ? "Edit race" : "New race"}>
            <label className="flex flex-col gap-1.5">
              <span className={LABEL}>Name</span>
              <input value={race.name} maxLength={100} onChange={(e) => setRace({ ...race, name: e.target.value })} className={INNER_FIELD} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={LABEL}>Date</span>
              <input type="date" value={race.raceDate} onChange={(e) => setRace({ ...race, raceDate: e.target.value })} className={INNER_FIELD} />
            </label>
            <RaceKindChips label="Kind" value={race.discipline} onChange={(d) => setRace({ ...race, discipline: d })} />
            {race.discipline === "triathlon" ? (
              <label className="flex flex-col gap-1.5">
                <span className={LABEL}>Distance</span>
                <select value={race.distance ?? ""} onChange={(e) => setRace({ ...race, distance: (e.target.value || null) as TriDistance | null })} className={INNER_FIELD}>
                  <TriDistanceOptions />
                  <option value="">Not set</option>
                </select>
              </label>
            ) : (
              <label className="flex flex-col gap-1.5">
                <span className={LABEL}>Distance, km (optional)</span>
                <input inputMode="decimal" value={race.km} onChange={(e) => setRace({ ...race, km: e.target.value })} className={INNER_FIELD} />
              </label>
            )}
            <RacePriorityRow value={race.priority} onChange={(v) => setRace({ ...race, priority: v })} />
            <div>
              <button type="button" disabled={busy || raceReason != null} aria-describedby={raceReason ? "race-reason" : undefined} onClick={saveRace} className={PRIMARY_BUTTON}>
                Save race
              </button>
              <ButtonReason id="race-reason" reason={raceReason} />
            </div>
            {errorLine}
            {race.id && (
              <button
                type="button"
                disabled={busy}
                onClick={() => toRemoveRace(true)}
                className={`min-h-11 text-sm font-medium ${DESTRUCTIVE_TEXT} active:opacity-70`}
              >
                Remove race
              </button>
            )}
          </PlanSheetPanel>
        )}
      </BottomSheet>

      <BottomSheet open={phase != null} onClose={() => toPhase(null)}>
        {phase && (
          <PlanSheetPanel
            label={phase.phase.name}
            title={phase.phase.name}
            sub={<span className="text-[13px] text-muted-foreground">{keepDates(rangeLabel(phase.phase.start, phase.phase.end))}</span>}
          >
            <div className="flex gap-4">
              <Link href={`/cycles/${phase.phase.id}`} className="flex min-h-11 items-center text-sm font-medium text-primary active:opacity-70">
                Open cycle
              </Link>
              <Link href={`/cycles/${phase.phase.id}/template`} className="flex min-h-11 items-center text-sm font-medium text-primary active:opacity-70">
                Edit the week
              </Link>
            </div>
            {p.enduranceEnabled && (
              <div className="flex flex-col gap-2">
                <span className={LABEL}>Phase type</span>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Phase type">
                  {PHASE_TYPES.map((t) => (
                    <Chip key={t} pressed={phase.phaseType === t} onClick={() => setPhase({ ...phase, phaseType: phase.phaseType === t ? null : t })}>
                      {PHASE_TYPE_LABELS[t]}
                    </Chip>
                  ))}
                </div>
              </div>
            )}
            <div className="flex flex-col gap-2">
              <span className={LABEL}>Length</span>
              <div className="flex gap-2">
                <input
                  aria-label="Length"
                  inputMode="numeric"
                  value={phase.length}
                  onChange={(e) => setPhase({ ...phase, length: e.target.value.replace(/\D/g, ""), unitNote: null })}
                  className={`${INNER_FIELD.replace("w-full", "w-[88px] shrink-0")} font-semibold`}
                />
                <Segmented
                  label="Length unit"
                  value={phase.unit}
                  onChange={(unit) => {
                    const next = switchLengthUnit(phase.length, phase.unit, unit);
                    setPhase({ ...phase, length: next.length, unit: next.unit, unitNote: next.note });
                  }}
                  track="bg-widget-2"
                  className="flex-1"
                  options={[
                    { value: "weeks", label: "Weeks" },
                    { value: "days", label: "Days" },
                  ]}
                />
              </div>
              {phase.unitNote && <span className="text-[13px] text-muted-foreground">{phase.unitNote}</span>}
            </div>
            <div>
              <button type="button" disabled={busy || phaseReason != null} aria-describedby={phaseReason ? "phase-reason" : undefined} onClick={savePhase} className={PRIMARY_BUTTON}>
                Save phase
              </button>
              <ButtonReason id="phase-reason" reason={phaseReason} />
            </div>
            {errorLine}
            <button type="button" disabled={busy} onClick={() => run(removePhaseAction({ seasonId: p.season.id, cycleId: phase.phase.id }), () => setPhase(null))} className={`min-h-11 text-sm font-medium ${DESTRUCTIVE_TEXT} active:opacity-70`}>
              Remove from season
            </button>
          </PlanSheetPanel>
        )}
      </BottomSheet>

      {p.next && (
        <TakeStartSheet
          open={confirmResume}
          title={paused ? "Resume this season?" : "Start this season?"}
          lines={[`${p.next.name} starts ${resumeDay === p.today ? "today" : shortDay(resumeDay)}.`, ...resumeLines]}
          action={paused ? "Resume season" : "Start season"}
          busy={busy}
          error={error}
          onConfirm={resume}
          onClose={() => toResume(false)}
        />
      )}
    </>
  );
}

const MENU_ROW = "flex min-h-[52px] w-full items-center border-b border-hairline px-3.5 text-left text-[15px] font-medium last:border-b-0 active:bg-foreground/5";
const DESTRUCTIVE_BUTTON = "min-h-[52px] w-full rounded-2xl bg-[#c23a2e] text-base font-semibold text-white active:opacity-80 disabled:opacity-50";

function Chevron() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="shrink-0 text-muted-foreground">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

/** One phase: a drag handle, then the row that opens the phase sheet. */
function PhaseRow({ phase, sub, warn, badge, onOpen }: { phase: SeasonPhaseView; sub: string; warn: string | null; badge: string; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: phase.id });
  return (
    <li
      ref={setNodeRef}
      data-testid="phase-row"
      data-phase-id={phase.id}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className="flex items-center border-b border-hairline bg-widget last:border-0"
    >
      <button
        type="button"
        aria-label={`Reorder ${phase.name}`}
        {...attributes}
        {...listeners}
        className="flex h-14 w-11 shrink-0 touch-none items-center justify-center text-muted-foreground cursor-grab active:cursor-grabbing"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="9" cy="6" r="1.6" />
          <circle cx="15" cy="6" r="1.6" />
          <circle cx="9" cy="12" r="1.6" />
          <circle cx="15" cy="12" r="1.6" />
          <circle cx="9" cy="18" r="1.6" />
          <circle cx="15" cy="18" r="1.6" />
        </svg>
      </button>
      <button type="button" onClick={onOpen} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 py-2.5 pr-3 text-left active:opacity-80">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span data-testid="phase-name" className={`text-[15px] font-medium ${phase.state === "done" ? "text-muted-foreground" : ""}`}>
            {phase.name}
          </span>
          <span className="text-[13px] text-muted-foreground">{keepDates(sub)}</span>
          {warn && <span className="mt-1 text-[13px]">{keepDates(warn)}</span>}
        </span>
        {badge && <span className={`shrink-0 text-xs font-semibold ${badgeAccent(badge) ? "text-primary" : "text-muted-foreground"}`}>{keepDates(badge)}</span>}
        <Chevron />
      </button>
    </li>
  );
}
