"use client";

import { BottomSheet } from "@/components/ui/BottomSheet";
import {
  addPhaseAction,
  addRaceAction,
  clearReplanAction,
  fitTaperAction,
  movePhaseAction,
  removePhaseAction,
  removeRaceAction,
  resumeSeasonAction,
  setPhaseAction,
  updateRaceAction,
} from "@/lib/actions/seasons";
import { callAction } from "@/lib/utils/stale-bundle";
import { PHASE_TYPE_LABELS, dayLabel, lengthLabel, raceKindLabel, type TaperFit } from "@/lib/utils/seasons";
import type { PhaseType } from "@/lib/utils/periodization";
import type { ActionResult } from "@/types/workout";
import { ChevronDown, ChevronUp, PlusIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Discipline = "triathlon" | "run" | "ride" | "swim" | "other";
type TriDistance = "full" | "half" | "olympic" | "sprint";
type Priority = "A" | "B" | "C";

export type SeasonRaceView = {
  id: number;
  name: string;
  raceDate: string;
  discipline: Discipline;
  distance: TriDistance | null;
  distanceMeters: number | null;
  priority: Priority;
};

export type SeasonPhaseView = {
  id: number;
  name: string;
  phaseType: PhaseType | null;
  durationWeeks: number;
  durationDays: number | null;
  start: string;
  end: string;
  state: "done" | "active" | "planned";
};

type Props = {
  seasonId: number;
  enduranceEnabled: boolean;
  replan: { reason: string | null } | null;
  races: SeasonRaceView[];
  phases: SeasonPhaseView[];
  taperFit: TaperFit;
  next: { cycleId: number; name: string; plannedStart: string; scheduled: boolean } | null;
  gapBefore: number;
  overrunAfter: number;
  candidates: { id: number; name: string; status: string }[];
};

const LABEL = "text-sm font-medium text-muted-foreground";
const INPUT = "rounded-xl bg-muted px-4 py-3 text-base outline-none focus:ring-2 ring-primary w-full";
const SECTION = "text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-2";
const PHASE_TYPES = Object.keys(PHASE_TYPE_LABELS) as PhaseType[];

type RaceDraft = { id?: number; name: string; raceDate: string; discipline: Discipline; distance: TriDistance | null; km: string; priority: Priority };
type PhaseDraft =
  | { mode: "add"; source: "new" | "existing"; cycleId: number | null; name: string; phaseType: PhaseType | null; unit: "weeks" | "days"; length: string }
  | { mode: "edit"; cycleId: number; name: string; phaseType: PhaseType | null; unit: "weeks" | "days"; length: string };

/** The interactive half of a season's page: the re-plan banner, races and phases. */
export function SeasonDetailClient(p: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [race, setRace] = useState<RaceDraft | null>(null);
  const [phase, setPhase] = useState<PhaseDraft | null>(null);
  const showRaces = p.enduranceEnabled || p.races.length > 0;

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
    const action = race.id ? updateRaceAction({ seasonId: p.seasonId, raceId: race.id, ...fields }) : addRaceAction({ seasonId: p.seasonId, ...fields });
    void run(action, () => setRace(null));
  }

  function savePhase() {
    if (!phase) return;
    const n = Number(phase.length);
    const length = phase.length && n > 0 ? (phase.unit === "days" ? { durationDays: n } : { durationWeeks: n }) : {};
    const phaseType = p.enduranceEnabled ? phase.phaseType : undefined;
    if (phase.mode === "edit") {
      void run(setPhaseAction({ seasonId: p.seasonId, cycleId: phase.cycleId, phaseType, ...length }), () => setPhase(null));
    } else if (phase.source === "existing") {
      if (phase.cycleId == null) return;
      void run(addPhaseAction({ seasonId: p.seasonId, cycleId: phase.cycleId, ...(phaseType ? { phaseType } : {}), ...length }), () => setPhase(null));
    } else {
      void run(addPhaseAction({ seasonId: p.seasonId, name: phase.name.trim(), ...(phaseType ? { phaseType } : {}), ...length }), () => setPhase(null));
    }
  }

  const fit = p.taperFit;
  const taperLine =
    fit.status === "fits"
      ? "The taper ends on race day."
      : fit.status === "early"
        ? `The taper ends ${fit.days} day${fit.days === 1 ? "" : "s"} before the A race.`
        : fit.status === "late"
          ? `The taper ends ${fit.days} day${fit.days === 1 ? "" : "s"} after the A race.`
          : null;

  // An open sheet covers the page, so its error shows in the sheet.
  const errorLine = error && (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  );

  return (
    <>
      {race == null && phase == null && errorLine}

      {p.replan && (
        <div data-testid="replan-banner" className="rounded-2xl bg-amber-500/10 p-4 flex flex-col gap-2">
          <p className="text-sm font-semibold">Race changed, plan not updated</p>
          {p.replan.reason && <p className="text-sm">{p.replan.reason}.</p>}
          <p className="text-sm text-muted-foreground">The plan was not changed. Ask your assistant to re-plan, or change the phases yourself.</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => run(clearReplanAction({ seasonId: p.seasonId }))}
            className="self-start rounded-xl bg-card px-4 min-h-[44px] text-sm font-medium text-primary active:opacity-70 disabled:opacity-50"
          >
            Mark as re-planned
          </button>
        </div>
      )}

      {showRaces && (
        <section>
          <p className={SECTION}>Races</p>
          <div className="flex flex-col divide-y divide-border rounded-2xl bg-card overflow-hidden">
            {p.races.map((r) => (
              <div key={r.id} className="flex items-center">
              <button
                type="button"
                disabled={!p.enduranceEnabled}
                onClick={() =>
                  setRace({ id: r.id, name: r.name, raceDate: r.raceDate, discipline: r.discipline, distance: r.distance, km: r.distanceMeters ? String(r.distanceMeters / 1000) : "", priority: r.priority })
                }
                className="flex flex-1 min-w-0 items-center justify-between gap-3 px-4 py-3 min-h-[44px] text-left active:bg-muted/50"
              >
                <div className="min-w-0">
                  <p className="font-medium truncate">{r.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {dayLabel(r.raceDate)} · {raceKindLabel(r)}
                  </p>
                </div>
                <span className="text-xs font-semibold rounded-full bg-muted px-2 py-0.5 shrink-0">{r.priority}</span>
              </button>
              {/* The race-day plan (docs/plans/nutrition-and-race-day.md, 6): half and full for now. */}
              {p.enduranceEnabled && r.discipline === "triathlon" && (r.distance === "half" || r.distance === "full") && (
                <Link href={`/races/${r.id}/plan`} className="flex items-center px-4 min-h-[44px] text-sm font-medium text-primary active:opacity-60 shrink-0">
                  Race plan
                </Link>
              )}
              </div>
            ))}
            {p.enduranceEnabled && (
              <button
                type="button"
                onClick={() => setRace({ name: "", raceDate: "", discipline: "triathlon", distance: "half", km: "", priority: "A" })}
                className="flex items-center gap-2 px-4 min-h-[44px] text-primary text-sm font-medium active:bg-muted/50"
              >
                <PlusIcon className="w-4 h-4" /> Add race
              </button>
            )}
          </div>
          {taperLine && (
            <div className="flex items-center justify-between gap-3 px-2 pt-2">
              <p className="text-sm text-muted-foreground" data-testid="taper-fit">
                {taperLine}
              </p>
              {(fit.status === "early" || fit.status === "late") && (
                <button type="button" disabled={busy} onClick={() => run(fitTaperAction({ seasonId: p.seasonId }))} className="text-primary text-sm font-medium min-h-[44px] shrink-0 active:opacity-70">
                  Fit taper
                </button>
              )}
            </div>
          )}
        </section>
      )}

      <section>
        <p className={SECTION}>Phases</p>
        <div className="flex flex-col divide-y divide-border rounded-2xl bg-card overflow-hidden" data-testid="season-phases">
          {p.phases.map((ph, i) => (
            <div key={ph.id} className="flex items-center gap-2 px-4 py-2 min-h-[44px]">
              <div className="flex-1 min-w-0">
                <Link href={`/cycles/${ph.id}`} className="font-medium truncate block active:opacity-70">
                  {ph.name}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {p.enduranceEnabled && ph.phaseType ? `${PHASE_TYPE_LABELS[ph.phaseType]} · ` : ""}
                  {dayLabel(ph.start)} to {dayLabel(ph.end)} · {lengthLabel(ph)}
                  {ph.state === "active" ? " · now" : ph.state === "done" ? " · done" : ""}
                </p>
              </div>
              <button type="button" aria-label={`Move ${ph.name} up`} disabled={busy || i === 0} onClick={() => run(movePhaseAction({ seasonId: p.seasonId, cycleId: ph.id, position: i }))} className="w-11 h-11 flex items-center justify-center text-muted-foreground disabled:opacity-30 active:opacity-60">
                <ChevronUp className="w-5 h-5" />
              </button>
              <button type="button" aria-label={`Move ${ph.name} down`} disabled={busy || i === p.phases.length - 1} onClick={() => run(movePhaseAction({ seasonId: p.seasonId, cycleId: ph.id, position: i + 2 }))} className="w-11 h-11 flex items-center justify-center text-muted-foreground disabled:opacity-30 active:opacity-60">
                <ChevronDown className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() =>
                  setPhase({ mode: "edit", cycleId: ph.id, name: ph.name, phaseType: ph.phaseType, unit: ph.durationDays != null ? "days" : "weeks", length: String(ph.durationDays ?? ph.durationWeeks) })
                }
                className="text-primary text-sm font-medium min-h-[44px] px-1 active:opacity-70"
              >
                Edit
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setPhase({ mode: "add", source: "new", cycleId: null, name: "", phaseType: null, unit: "weeks", length: "4" })}
            className="flex items-center gap-2 px-4 min-h-[44px] text-primary text-sm font-medium active:bg-muted/50"
          >
            <PlusIcon className="w-4 h-4" /> Add phase
          </button>
        </div>
        {p.next && !p.next.scheduled && (
          <div className="flex items-center justify-between gap-3 px-2 pt-2">
            <p className="text-sm text-muted-foreground">
              {p.phases.some((ph) => ph.state !== "planned") ? "Paused: the next phase is not scheduled." : `“${p.next.name}” is not started.`}
            </p>
            <button type="button" disabled={busy} onClick={() => run(resumeSeasonAction({ seasonId: p.seasonId }))} className="text-primary text-sm font-medium min-h-[44px] shrink-0 active:opacity-70">
              {p.phases.some((ph) => ph.state !== "planned") ? "Resume" : "Start"}
            </button>
          </div>
        )}
        {p.next?.scheduled && <p className="text-sm text-muted-foreground px-2 pt-2">“{p.next.name}” starts {dayLabel(p.next.plannedStart)}.</p>}
        {p.gapBefore > 0 && <p className="text-sm text-muted-foreground px-2 pt-1">The first phase starts {p.gapBefore} days after the season starts.</p>}
        {p.overrunAfter > 0 && <p className="text-sm text-muted-foreground px-2 pt-1">The last phase runs {p.overrunAfter} days past the season end.</p>}
      </section>

      <BottomSheet open={race != null} onClose={() => setRace(null)}>
        {race && (
          <div className="w-full px-4 pb-8 flex flex-col gap-4">
            <h2 className="text-lg font-semibold">{race.id ? "Edit race" : "New race"}</h2>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Name</span>
              <input value={race.name} maxLength={100} onChange={(e) => setRace({ ...race, name: e.target.value })} className={INPUT} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Date</span>
              <input type="date" value={race.raceDate} onChange={(e) => setRace({ ...race, raceDate: e.target.value })} className={INPUT} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Kind</span>
              <select value={race.discipline} onChange={(e) => setRace({ ...race, discipline: e.target.value as Discipline })} className={INPUT}>
                <option value="triathlon">Triathlon</option>
                <option value="run">Run</option>
                <option value="ride">Ride</option>
                <option value="swim">Swim</option>
                <option value="other">Other</option>
              </select>
            </label>
            {race.discipline === "triathlon" ? (
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Distance</span>
                <select value={race.distance ?? ""} onChange={(e) => setRace({ ...race, distance: (e.target.value || null) as TriDistance | null })} className={INPUT}>
                  <option value="full">Full</option>
                  <option value="half">Half</option>
                  <option value="olympic">Olympic</option>
                  <option value="sprint">Sprint</option>
                  <option value="">Not set</option>
                </select>
              </label>
            ) : (
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Distance, km (optional)</span>
                <input inputMode="decimal" value={race.km} onChange={(e) => setRace({ ...race, km: e.target.value })} className={INPUT} />
              </label>
            )}
            <div className="flex flex-col gap-1">
              <span className={LABEL}>Priority</span>
              <div className="flex gap-2" role="group" aria-label="Priority">
                {(["A", "B", "C"] as const).map((pr) => (
                  <button
                    key={pr}
                    type="button"
                    aria-pressed={race.priority === pr}
                    onClick={() => setRace({ ...race, priority: pr })}
                    className={`flex-1 min-h-[44px] rounded-xl border-2 text-sm font-semibold ${race.priority === pr ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}
                  >
                    {pr}
                  </button>
                ))}
              </div>
            </div>
            <button type="button" disabled={busy || !race.name.trim() || !race.raceDate} onClick={saveRace} className="rounded-xl bg-primary py-4 text-base font-semibold text-primary-foreground disabled:opacity-50 active:scale-95 transition-transform">
              Save race
            </button>
            {errorLine}
            {race.id && (
              <button type="button" disabled={busy} onClick={() => run(removeRaceAction({ seasonId: p.seasonId, raceId: race.id! }), () => setRace(null))} className="text-destructive text-sm font-medium min-h-[44px] active:opacity-70">
                Remove race
              </button>
            )}
          </div>
        )}
      </BottomSheet>

      <BottomSheet open={phase != null} onClose={() => setPhase(null)}>
        {phase && (
          <div className="w-full px-4 pb-8 flex flex-col gap-4">
            <h2 className="text-lg font-semibold">{phase.mode === "edit" ? `Edit ${phase.name}` : "Add phase"}</h2>
            {phase.mode === "add" && (
              <div className="flex gap-2" role="group" aria-label="Phase source">
                {(["new", "existing"] as const).map((src) => (
                  <button
                    key={src}
                    type="button"
                    aria-pressed={phase.source === src}
                    onClick={() => setPhase({ ...phase, source: src })}
                    className={`flex-1 min-h-[44px] rounded-xl border-2 text-sm font-medium ${phase.source === src ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}
                  >
                    {src === "new" ? "New cycle" : "Existing cycle"}
                  </button>
                ))}
              </div>
            )}
            {phase.mode === "add" && phase.source === "new" && (
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Name</span>
                <input value={phase.name} maxLength={100} onChange={(e) => setPhase({ ...phase, name: e.target.value })} placeholder="e.g. Base" className={INPUT} />
              </label>
            )}
            {phase.mode === "add" && phase.source === "existing" && (
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Cycle</span>
                <select value={phase.cycleId ?? ""} onChange={(e) => setPhase({ ...phase, cycleId: e.target.value ? Number(e.target.value) : null })} className={INPUT}>
                  <option value="">Pick a cycle</option>
                  {p.candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {p.enduranceEnabled && (
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Phase type</span>
                <select value={phase.phaseType ?? ""} onChange={(e) => setPhase({ ...phase, phaseType: (e.target.value || null) as PhaseType | null })} className={INPUT}>
                  <option value="">None (the cycle&apos;s own curve)</option>
                  {PHASE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {PHASE_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="flex flex-col gap-1">
              <span className={LABEL}>Length</span>
              <div className="flex gap-2">
                <input aria-label="Length" inputMode="numeric" value={phase.length} onChange={(e) => setPhase({ ...phase, length: e.target.value.replace(/\D/g, "") })} className={`${INPUT} flex-1`} />
                <select aria-label="Length unit" value={phase.unit} onChange={(e) => setPhase({ ...phase, unit: e.target.value as "weeks" | "days" })} className={`${INPUT} w-32`}>
                  <option value="weeks">weeks</option>
                  <option value="days">days</option>
                </select>
              </div>
              {phase.mode === "add" && phase.phaseType === "taper" && (
                <p className="text-xs text-muted-foreground">Leave it empty to use the A race&apos;s taper length.</p>
              )}
            </div>
            <button
              type="button"
              disabled={busy || (phase.mode === "add" && (phase.source === "new" ? !phase.name.trim() : phase.cycleId == null))}
              onClick={savePhase}
              className="rounded-xl bg-primary py-4 text-base font-semibold text-primary-foreground disabled:opacity-50 active:scale-95 transition-transform"
            >
              {phase.mode === "edit" ? "Save phase" : "Add phase"}
            </button>
            {errorLine}
            {phase.mode === "edit" && (
              <button type="button" disabled={busy} onClick={() => run(removePhaseAction({ seasonId: p.seasonId, cycleId: phase.cycleId }), () => setPhase(null))} className="text-destructive text-sm font-medium min-h-[44px] active:opacity-70">
                Remove from season
              </button>
            )}
          </div>
        )}
      </BottomSheet>
    </>
  );
}
