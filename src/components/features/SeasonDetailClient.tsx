"use client";

import { BackLink, useLeaveDeleted } from "@/components/ui/BackLink";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Chip, DESTRUCTIVE_TEXT, INNER_FIELD, LABEL, PRIMARY_BUTTON, SectionLabel, Segmented } from "@/components/features/season-ui";
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
import { callAction } from "@/lib/utils/stale-bundle";
import {
  PHASE_TYPE_LABELS,
  dayLabel,
  daysBetweenStr,
  lengthShort,
  rangeLabel,
  shortDay,
  type RaceDiscipline,
  type RacePriority,
  type TaperFit,
  type TriDistance,
} from "@/lib/utils/seasons";
import type { PhaseType } from "@/lib/utils/periodization";
import type { ActionResult } from "@/types/workout";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
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
};

const PHASE_TYPES = Object.keys(PHASE_TYPE_LABELS) as PhaseType[];
const DISCIPLINES: { value: RaceDiscipline; label: string }[] = [
  { value: "triathlon", label: "Triathlon" },
  { value: "run", label: "Run" },
  { value: "ride", label: "Ride" },
  { value: "swim", label: "Swim" },
  { value: "other", label: "Other" },
];
const TRI_WORD: Record<TriDistance, string> = { full: "Full", half: "Half", olympic: "Olympic", sprint: "Sprint" };
const KIND_WORD: Record<RaceDiscipline, string> = { triathlon: "Triathlon", run: "Run", ride: "Ride", swim: "Swim", other: "Other" };

type RaceDraft = { id?: number; name: string; raceDate: string; discipline: RaceDiscipline; distance: TriDistance | null; km: string; priority: RacePriority };
type PhaseDraft = { phase: SeasonPhaseView; phaseType: PhaseType | null; unit: "weeks" | "days"; length: string };

/** "Triathlon · Half · 29 Aug 2027" or "Run · 10 km · 3 May 2027". */
function raceSub(r: SeasonRaceView): string {
  const kind = r.discipline === "triathlon" ? (r.distance ? `Triathlon · ${TRI_WORD[r.distance]}` : "Triathlon") : r.distanceMeters ? `${KIND_WORD[r.discipline]} · ${Math.round(r.distanceMeters / 100) / 10} km` : KIND_WORD[r.discipline];
  return `${kind} · ${dayLabel(r.raceDate)}`;
}

/** The new order and the 1-based position for a drop, or null when nothing moved. */
export function phaseDrop(ids: number[], activeId: number, overId: number): { order: number[]; position: number } | null {
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from < 0 || to < 0 || from === to) return null;
  return { order: arrayMove(ids, from, to), position: to + 1 };
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
    const result = await callAction(deleteSeasonAction({ seasonId: p.season.id }));
    setBusy(false);
    if (!result.success) return setError(result.error);
    leaveDeleted("/cycles", [`/seasons/${p.season.id}`]);
  }

  const fit = p.taperFit;
  const misfit = fit.status === "early" || fit.status === "late";
  const fitLine = misfit ? `Taper ends ${fit.days} day${fit.days === 1 ? "" : "s"} ${fit.status === "early" ? "before" : "after"} the race` : null;
  const showBanner = p.replan != null || (misfit && showRaces);
  const bannerTitle = p.replan
    ? misfit
      ? "Race date changed. The taper no longer ends on race day."
      : "A race changed. The phases stay as they are."
    : "The taper does not end on race day.";

  const countdownTo = aRace?.raceDate ?? p.season.endDate;
  const daysLeft = daysBetweenStr(p.today, countdownTo);

  function badge(ph: SeasonPhaseView): string {
    if (ph.state === "active") return "Now";
    if (p.next?.cycleId !== ph.id) return "";
    const n = daysBetweenStr(p.today, ph.start);
    if (n < 0) return "Next";
    return n < 7 ? `Starts ${shortDay(ph.start).slice(0, 3)}` : `Starts ${shortDay(ph.start).slice(4)}`;
  }

  // An open sheet covers the page, so its error shows in the sheet.
  const errorLine = error && (
    <p role="alert" className="text-sm text-[#ff6b5a]">
      {error}
    </p>
  );

  return (
    <>
      <header className="flex items-center justify-between px-4 pt-4">
        <BackLink fallback={{ href: "/cycles", label: "Plan" }} />
        <button type="button" aria-label="More actions" onClick={() => setMenu(true)} className="flex h-11 w-11 items-center justify-center rounded-full bg-widget active:opacity-70">
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
            {dayLabel(p.season.startDate)} to {dayLabel(p.season.endDate)}
          </span>
          {p.season.goal && <span className="text-sm text-foreground/75">{p.season.goal}</span>}
          {p.season.nextGoal && <span className="text-[13px] text-muted-foreground">Next: {p.season.nextGoal}</span>}
        </div>

        {race == null && phase == null && !confirmDelete && errorLine}

        {showBanner && (
          <section data-testid="replan-banner" className="flex flex-col gap-2.5 rounded-2xl border border-[color-mix(in_oklab,var(--home-fg)_16%,transparent)] bg-widget-2 px-4 py-3.5">
            <span className="text-[15px] font-semibold">{bannerTitle}</span>
            {p.replan?.reason && <span className="text-[13px] text-muted-foreground">{p.replan.reason}.</span>}
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
              <span className={LABEL}>{aRace ? `${aRace.priority} race · ${dayLabel(aRace.raceDate)}` : `Goal by ${dayLabel(p.season.endDate)}`}</span>
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
              {phases.map((ph) => (
                <div
                  key={ph.id}
                  style={{ flex: `${ph.lengthDays} 1 0` }}
                  className={`min-w-2 rounded ${ph.state === "planned" && p.next?.cycleId !== ph.id ? "bg-[#707076]" : "bg-primary"} ${ph.state === "active" ? "outline-2 outline-offset-1 outline-primary" : ""}`}
                />
              ))}
            </div>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <SectionLabel>Phases</SectionLabel>
          {phases.length > 0 && (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={order} strategy={verticalListSortingStrategy}>
                <ul data-testid="season-phases" className="flex flex-col overflow-hidden rounded-[20px] bg-widget">
                  {phases.map((ph) => (
                    <PhaseRow
                      key={ph.id}
                      phase={ph}
                      sub={`${p.enduranceEnabled && ph.phaseType ? `${PHASE_TYPE_LABELS[ph.phaseType]} · ` : ""}${lengthShort(ph)} · ${rangeLabel(ph.start, ph.end)}`}
                      warn={misfit && "taperId" in fit && fit.taperId === ph.id && showRaces ? fitLine : null}
                      badge={badge(ph)}
                      onOpen={() =>
                        setPhase({ phase: ph, phaseType: ph.phaseType, unit: ph.durationDays != null ? "days" : "weeks", length: String(ph.durationDays ?? ph.durationWeeks) })
                      }
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
                {phases.some((ph) => ph.state !== "planned") ? "Paused: the next phase is not scheduled." : `“${p.next.name}” is not started.`}
              </p>
              <button type="button" disabled={busy} onClick={() => run(resumeSeasonAction({ seasonId: p.season.id }))} className="min-h-11 shrink-0 text-sm font-medium text-primary active:opacity-70">
                {phases.some((ph) => ph.state !== "planned") ? "Resume" : "Start"}
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
                        setRace({ id: r.id, name: r.name, raceDate: r.raceDate, discipline: r.discipline, distance: r.distance, km: r.distanceMeters ? String(r.distanceMeters / 1000) : "", priority: r.priority })
                      }
                      className="flex min-h-11 w-full items-center gap-3 px-4 py-3 text-left active:opacity-80"
                    >
                      <span aria-label={`${r.priority} race`} className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold ${r.priority === "A" ? "bg-primary text-primary-foreground" : "bg-widget-2"}`}>
                        {r.priority}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-[15px] font-medium">{r.name}</span>
                        <span className="text-[13px] text-muted-foreground">{raceSub(r)}</span>
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
                onClick={() => setRace({ name: "", raceDate: "", discipline: "triathlon", distance: "half", km: "", priority: "A" })}
                className="flex min-h-11 items-center self-start px-1 text-[15px] font-medium text-primary active:opacity-70"
              >
                + Add race
              </button>
            )}
          </section>
        )}
      </div>

      <BottomSheet open={menu} onClose={() => setMenu(false)}>
        <nav aria-label="Season actions" className="flex w-full flex-col px-4 pb-8">
          <Link href={`/seasons/${p.season.id}/edit`} className="flex min-h-12 items-center text-base active:opacity-70">
            Edit details
          </Link>
          <Link href={`/seasons/${p.season.id}/history`} className="flex min-h-12 items-center text-base active:opacity-70">
            Change history
          </Link>
          <button
            type="button"
            onClick={() => {
              setMenu(false);
              setConfirmDelete(true);
            }}
            className={`flex min-h-12 items-center text-base ${DESTRUCTIVE_TEXT} active:opacity-70`}
          >
            Delete season
          </button>
        </nav>
      </BottomSheet>

      <BottomSheet open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <div className="flex w-full flex-col gap-3 px-4 pb-8">
          <h2 className="text-lg font-semibold">Delete this season?</h2>
          <p className="text-sm text-muted-foreground">Its cycles stay. You can restore it from Recently deleted for 90 days.</p>
          {errorLine}
          <button type="button" disabled={busy} onClick={deleteSeason} className="min-h-[52px] rounded-2xl bg-[#c23a2e] text-base font-semibold text-white active:opacity-80">
            Delete season
          </button>
          <button type="button" onClick={() => setConfirmDelete(false)} className="min-h-11 text-sm font-medium active:opacity-70">
            Cancel
          </button>
        </div>
      </BottomSheet>

      <BottomSheet open={race != null} onClose={() => setRace(null)}>
        {race && (
          <div className="flex w-full flex-col gap-4 px-4 pb-8">
            <h2 className="text-lg font-semibold">{race.id ? "Edit race" : "New race"}</h2>
            <label className="flex flex-col gap-1.5">
              <span className={LABEL}>Name</span>
              <input value={race.name} maxLength={100} onChange={(e) => setRace({ ...race, name: e.target.value })} className={INNER_FIELD} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={LABEL}>Date</span>
              <input type="date" value={race.raceDate} onChange={(e) => setRace({ ...race, raceDate: e.target.value })} className={INNER_FIELD} />
            </label>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Kind">
              {DISCIPLINES.map((d) => (
                <Chip key={d.value} pressed={race.discipline === d.value} onClick={() => setRace({ ...race, discipline: d.value })}>
                  {d.label}
                </Chip>
              ))}
            </div>
            {race.discipline === "triathlon" ? (
              <label className="flex flex-col gap-1.5">
                <span className={LABEL}>Distance</span>
                <select value={race.distance ?? ""} onChange={(e) => setRace({ ...race, distance: (e.target.value || null) as TriDistance | null })} className={INNER_FIELD}>
                  <option value="sprint">Sprint</option>
                  <option value="olympic">Olympic</option>
                  <option value="half">Half</option>
                  <option value="full">Full</option>
                  <option value="">Not set</option>
                </select>
              </label>
            ) : (
              <label className="flex flex-col gap-1.5">
                <span className={LABEL}>Distance, km (optional)</span>
                <input inputMode="decimal" value={race.km} onChange={(e) => setRace({ ...race, km: e.target.value })} className={INNER_FIELD} />
              </label>
            )}
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-foreground/75">Priority</span>
              <Segmented
                label="Priority"
                value={race.priority}
                onChange={(v) => setRace({ ...race, priority: v })}
                track="bg-widget-2"
                className="w-[168px]"
                options={[
                  { value: "A", label: "A" },
                  { value: "B", label: "B" },
                  { value: "C", label: "C" },
                ]}
              />
            </div>
            <button type="button" disabled={busy || !race.name.trim() || !race.raceDate} onClick={saveRace} className={PRIMARY_BUTTON}>
              Save race
            </button>
            {errorLine}
            {race.id && (
              <button type="button" disabled={busy} onClick={() => run(removeRaceAction({ seasonId: p.season.id, raceId: race.id! }), () => setRace(null))} className={`min-h-11 text-sm font-medium ${DESTRUCTIVE_TEXT} active:opacity-70`}>
                Remove race
              </button>
            )}
          </div>
        )}
      </BottomSheet>

      <BottomSheet open={phase != null} onClose={() => setPhase(null)}>
        {phase && (
          <div className="flex w-full flex-col gap-4 px-4 pb-8">
            <div className="flex flex-col gap-0.5">
              <h2 className="text-lg font-semibold">{phase.phase.name}</h2>
              <span className="text-[13px] text-muted-foreground">{rangeLabel(phase.phase.start, phase.phase.end)}</span>
            </div>
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
                  onChange={(e) => setPhase({ ...phase, length: e.target.value.replace(/\D/g, "") })}
                  className={`${INNER_FIELD} w-[88px] font-semibold`}
                />
                <Segmented
                  label="Length unit"
                  value={phase.unit}
                  onChange={(unit) => setPhase({ ...phase, unit })}
                  track="bg-widget-2"
                  className="flex-1"
                  options={[
                    { value: "weeks", label: "Weeks" },
                    { value: "days", label: "Days" },
                  ]}
                />
              </div>
            </div>
            <button type="button" disabled={busy || !Number(phase.length)} onClick={savePhase} className={PRIMARY_BUTTON}>
              Save phase
            </button>
            {errorLine}
            <button type="button" disabled={busy} onClick={() => run(removePhaseAction({ seasonId: p.season.id, cycleId: phase.phase.id }), () => setPhase(null))} className={`min-h-11 text-sm font-medium ${DESTRUCTIVE_TEXT} active:opacity-70`}>
              Remove from season
            </button>
          </div>
        )}
      </BottomSheet>
    </>
  );
}

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
          <span className="text-[13px] text-muted-foreground">{sub}</span>
          {warn && <span className="mt-1 text-[13px]">{warn}</span>}
        </span>
        {badge && <span className="shrink-0 text-xs font-semibold text-primary">{badge}</span>}
        <Chevron />
      </button>
    </li>
  );
}
