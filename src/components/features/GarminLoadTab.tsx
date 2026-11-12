"use client";

import { EChart } from "@/components/charts/EChart";
import { Card, Legend, Readout, SportBadge, Stat } from "@/components/features/garmin/GarminUi";
import { useVizTheme } from "@/components/charts/viz-theme";
import type { Track } from "@/lib/garmin/analytics/pmc";
import { rampBand } from "@/lib/garmin/analytics/pmc";
import { SPORTS } from "@/lib/garmin/analytics/sport";
import {
  DISTRIBUTION_TEXT,
  RANGE_LABEL,
  distributionOption,
  formBandLabel,
  latestWeekWithData,
  loadHeadline,
  pmcOption,
  rangeStart,
  sportFitnessOption,
  sportsWithFitness,
  weeksInRange,
  weeklyLoadOption,
  type LoadSeries,
  type RangeKey,
} from "@/lib/garmin/charts/load";
import { SPORT_LABEL } from "@/lib/garmin/charts/theme";
import { formatDateShort } from "@/lib/utils/format";
import { CalendarRange, ChartColumn, Flame, Gauge, HeartPulse, Mountain, Rocket, TrendingUp } from "lucide-react";
import { DemandsList, WeekAgainstPlan, demandsTitle } from "@/components/features/garmin/Volume";
import { ladderOption, ladderValue, weeklyHoursOption } from "@/lib/garmin/charts/volume";
import type { VolumeData } from "@/lib/garmin/queries";
import type { WearableSuggestion } from "@/lib/periodization-sync";
import { applyWearablePlanSuggestion } from "@/lib/actions/training-cycles";
import { callAction } from "@/lib/utils/stale-bundle";
import { useRouter } from "next/navigation";
import { projectionSentence, type Projection } from "@/lib/garmin/analytics/projection";
import type { RaceStatus } from "@/lib/garmin/analytics/overview";
import { Layers } from "lucide-react";
import { useMemo, useState } from "react";
import Link from "next/link";

const RANGES: RangeKey[] = ["6w", "3m", "1y", "all"];

function Chip({ active, onClick, children, label }: { active: boolean; onClick: () => void; children: React.ReactNode; label?: string }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      className={`h-9 min-w-11 px-3 rounded-full text-sm font-medium flex-none flex items-center justify-center gap-1.5 active:opacity-70 ${
        active ? "bg-foreground text-background" : "bg-muted text-muted-foreground"
      }`}
    >
      {children}
    </button>
  );
}






const signed = (n: number) => `${n >= 0 ? "+" : ""}${Math.round(n)}`;

/** This week's plan nudge from the wearable signals, with Apply (decision O-3: suggest first). */
function PlanSuggestion({ s }: { s: WearableSuggestion }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "done" | string>("idle");
  async function apply() {
    setState("busy");
    const r = await callAction(applyWearablePlanSuggestion());
    if (!r.success) return setState(r.error);
    setState("done");
    router.refresh();
  }
  return (
    <Card icon={Gauge} title="Plan suggestion" note="From your Garmin recovery and load signals. The weekly sync never applies it on its own: you decide. It scales this week's swim, bike and run targets; next week's sync starts fresh.">
      <p className="text-sm">
        {s.note} This week&apos;s volume: {s.current} % now, {s.pct} % suggested.
      </p>
      <button onClick={apply} disabled={state === "busy" || state === "done"} className="h-11 w-full rounded-xl bg-foreground text-background text-sm font-semibold disabled:opacity-40 active:opacity-70">
        {state === "busy" ? "Applying…" : state === "done" ? "Applied" : `Apply ${s.pct} % to this week`}
      </button>
      {state !== "idle" && state !== "busy" && state !== "done" && <p className="text-xs text-destructive">{state}</p>}
    </Card>
  );
}

const hm = (hours: number) => {
  const m = Math.round(hours * 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
};

export function GarminLoadTab({
  series,
  computedAt,
  volume,
  race,
  suggestion,
}: {
  series: LoadSeries;
  computedAt: string | null;
  volume: VolumeData;
  race: { race: RaceStatus; projection: Projection | null } | null;
  suggestion: WearableSuggestion | null;
}) {
  const theme = useVizTheme();
  const [range, setRange] = useState<RangeKey>("3m");
  const [track, setTrack] = useState<Track>("total");
  const [pmcIdx, setPmcIdx] = useState<number | null>(null);
  const [weekIdx, setWeekIdx] = useState<number | null>(null);
  const [distIdx, setDistIdx] = useState<number | null>(null);
  const [unit, setUnit] = useState<"load" | "hours">("load");
  const [hourIdx, setHourIdx] = useState<number | null>(null);
  const [ladderIdx, setLadderIdx] = useState<number | null>(null);

  const from = rangeStart(series, range);
  const weeks = useMemo(() => weeksInRange(series, range), [series, range]);
  const sportsWithLoad = SPORTS.filter((s) => series.loads[s].some((v) => v > 0));
  const projection = race?.projection ?? null;
  const pmc = useMemo(() => (theme ? pmcOption(series, track, range, theme, projection) : null), [series, track, range, theme, projection]);
  const [sportIdx, setSportIdx] = useState<number | null>(null);
  const perSport = useMemo(() => (theme ? sportFitnessOption(series, range, theme) : null), [series, range, theme]);
  const weekly = useMemo(() => (theme ? weeklyLoadOption(weeks, theme) : null), [weeks, theme]);
  const dist = useMemo(() => (theme ? distributionOption(weeks, theme) : null), [weeks, theme]);
  const volWeeks = useMemo(() => {
    const first = weeks[0]?.weekStart ?? volume.weeks[0]?.weekStart;
    return volume.weeks.filter((w) => !first || w.weekStart >= first);
  }, [weeks, volume.weeks]);
  const hours = useMemo(() => (theme ? weeklyHoursOption(volWeeks, theme) : null), [volWeeks, theme]);
  const ladderWeeks = useMemo(() => volume.weeks.slice(-16), [volume.weeks]);
  const ladder = useMemo(() => (theme ? ladderOption(ladderWeeks, volume.distance, theme) : null), [ladderWeeks, volume.distance, theme]);

  const n = series.dates.length;
  if (n === 0) {
    return <p className="text-sm text-muted-foreground text-center py-12">No load yet. It is computed in the background as Garmin data imports.</p>;
  }

  const t = series.tracks[track];
  const last = n - 1;
  const weekAgo = Math.max(0, last - 7);
  const ramp = t.ctl[last] - t.ctl[weekAgo];
  const rawPi = pmcIdx !== null ? from + pmcIdx : last;
  // An index past the last day is a day of the plan projection.
  const planIdx = projection && track === "total" && rawPi > last ? rawPi - last - 1 : null;
  const pi = Math.min(rawPi, last);
  const wk = weeks[weekIdx ?? latestWeekWithData(weeks)];
  const dk = weeks[distIdx ?? latestWeekWithData(weeks, true)];
  const dayLoad = track === "total" ? SPORTS.reduce((s, sp) => s + series.loads[sp][pi], 0) : series.loads[track][pi];
  const pct = (w: (typeof weeks)[number], k: "low" | "mid" | "high") => {
    const total = w.bands.low + w.bands.mid + w.bands.high;
    return total > 0 ? `${Math.round((w.bands[k] / total) * 100)}%` : "–";
  };

  return (
    <div className="space-y-4">
      <div data-no-swipe className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1 no-scrollbar" role="toolbar" aria-label="Range and sport">
        {RANGES.map((r) => (
          <Chip key={r} active={range === r} onClick={() => setRange(r)}>
            {RANGE_LABEL[r]}
          </Chip>
        ))}
        <span className="w-px bg-border flex-none my-1" />
        <Chip active={track === "total"} onClick={() => setTrack("total")}>
          All
        </Chip>
        {sportsWithLoad.map((s) => (
          <Chip key={s} active={track === s} onClick={() => setTrack(s)} label={SPORT_LABEL[s]}>
            <SportBadge sport={s} />
            {SPORT_LABEL[s]}
          </Chip>
        ))}
      </div>

      <p className="text-lg font-semibold leading-snug">{loadHeadline(series, track)}</p>

      {suggestion && <PlanSuggestion s={suggestion} />}

      <div className="grid grid-cols-2 gap-2">
        <Stat icon={TrendingUp} label="Fitness (CTL)" value={String(Math.round(t.ctl[last]))} sub={`${signed(ramp)} in 7 days`} />
        <Stat icon={HeartPulse} label="Fatigue (ATL)" value={String(Math.round(t.atl[last]))} sub={`${signed(t.atl[last] - t.atl[weekAgo])} in 7 days`} />
        <Stat icon={Gauge} label="Form (TSB)" value={signed(t.tsb[last])} sub={formBandLabel(t.tsb[last])} />
        <Stat icon={Rocket} label="Ramp rate" value={`${signed(ramp)}/wk`} sub={{ normal: "Normal (≤5)", fast: "Fast (5–8)", warning: "Too fast (>8)" }[rampBand(ramp)]} />
      </div>

      <Card icon={TrendingUp} title="Fitness, fatigue and form" note="Fitness is a 42-day average of daily load, fatigue a 7-day one. Form is yesterday's fitness minus fatigue. 100 load = one hour at threshold.">
        <Legend
          items={[
            { name: "Fitness", color: "var(--viz-positive)", kind: "line" },
            { name: "Fatigue", color: "var(--viz-bike)", kind: "line" },
            { name: "Daily load", color: "var(--muted-foreground)", kind: "bar" },
            { name: "Form", color: "var(--viz-negative)", kind: "bar" },
            ...(projection && track === "total" ? [{ name: "Plan to race day (dashed), band ± 15 % load", color: "var(--foreground)", kind: "line" as const }, { name: "Race-morning target form", color: "var(--viz-good)", kind: "bar" as const }] : []),
          ]}
        />
        {projection && track === "total" && (
          <p className="text-sm">
            {projectionSentence(projection)}{" "}
            <Link href="/more/garmin/race" className="text-primary active:opacity-60">
              Race page
            </Link>
          </p>
        )}
        {race && !projection && track === "total" && (
          <p className="text-[11px] text-muted-foreground">No projection: race day is today, past, or more than a year away.</p>
        )}
        {planIdx !== null && projection ? (
          <Readout
            title={`${formatDateShort(projection.dates[planIdx])} · plan${projection.dates[planIdx] === projection.raceDay ? " · race day" : ""}`}
            values={[
              { label: "fitness", value: String(Math.round(projection.ctl[planIdx])) },
              { label: "fatigue", value: String(Math.round(projection.atl[planIdx])) },
              { label: `form · ${formBandLabel(projection.tsb[planIdx]).toLowerCase()}`, value: signed(projection.tsb[planIdx]) },
            ]}
          />
        ) : (
          <Readout
            title={formatDateShort(series.dates[pi])}
            values={[
              { label: "fitness", value: String(Math.round(t.ctl[pi])) },
              { label: "fatigue", value: String(Math.round(t.atl[pi])) },
              { label: `form · ${formBandLabel(t.tsb[pi]).toLowerCase()}`, value: signed(t.tsb[pi]) },
              { label: "load", value: String(Math.round(dayLoad)) },
            ]}
          />
        )}
        {pmc && (
          <EChart
            option={pmc}
            height={300}
            onIndex={setPmcIdx}
            ariaLabel={`Fitness ${Math.round(t.ctl[last])}, fatigue ${Math.round(t.atl[last])}, form ${signed(t.tsb[last])} on ${series.dates[last]}.`}
          />
        )}
      </Card>

      {perSport && sportsWithFitness(series, range).length > 0 && (
        <Card icon={Layers} title="Fitness per sport" note="Each sport's own 42-day fitness. A balanced Ironman build lifts swim, bike and run together; one line carrying the rest means the others lag.">
          <Legend items={sportsWithFitness(series, range).map((s) => ({ name: SPORT_LABEL[s], color: `var(--viz-${s})`, kind: "line" as const, sport: s }))} />
          {(() => {
            const i = sportIdx !== null ? from + sportIdx : last;
            return (
              <Readout
                title={formatDateShort(series.dates[i])}
                values={sportsWithFitness(series, range).map((s) => ({ label: SPORT_LABEL[s].toLowerCase(), value: String(Math.round(series.tracks[s].ctl[i])) }))}
              />
            );
          })()}
          <EChart option={perSport} height={180} onIndex={setSportIdx} ariaLabel="Fitness per sport over the selected range." />
        </Card>
      )}

      <Card
        icon={ChartColumn}
        title={unit === "load" ? "Weekly load by sport" : "Weekly hours by sport"}
        aside={
          <span data-no-swipe className="inline-flex rounded-full bg-background p-0.5" role="group" aria-label="Unit">
            {(["load", "hours"] as const).map((u) => (
              <button key={u} onClick={() => setUnit(u)} aria-pressed={unit === u} className={`h-8 px-3 rounded-full text-xs font-medium active:opacity-70 ${unit === u ? "bg-foreground text-background" : "text-muted-foreground"}`}>
                {u === "load" ? "Load" : "Hours"}
              </button>
            ))}
          </span>
        }
        note={unit === "load" ? "ACWR: this week against the three before. Above 1.3 the jump in load raises injury risk." : "Time in Garmin activities. Ironman plans are written in hours, so a week with no swim shows as a gap."}
      >
        {unit === "load" ? (
          <>
            <Legend
              items={[
                ...SPORTS.filter((s) => weeks.some((w) => w.loads[s] > 0)).map((s) => ({ name: SPORT_LABEL[s], color: `var(--viz-${s})`, kind: "bar" as const, sport: s })),
                { name: "ACWR", color: "var(--muted-foreground)", kind: "dot" },
              ]}
            />
            {wk && (
              <Readout
                title={`Week of ${formatDateShort(wk.weekStart)}`}
                values={[
                  { label: "total", value: String(Math.round(wk.total)) },
                  ...SPORTS.filter((s) => wk.loads[s] > 0).map((s) => ({ label: SPORT_LABEL[s].toLowerCase(), value: String(Math.round(wk.loads[s])) })),
                  { label: "ACWR", value: wk.acwr.toFixed(2) },
                ]}
              />
            )}
            {weekly && <EChart option={weekly} height={226} onIndex={setWeekIdx} ariaLabel={`Weekly load for ${weeks.length} weeks.`} />}
          </>
        ) : (
          <>
            <Legend items={SPORTS.filter((s) => volWeeks.some((w) => w.hours[s] > 0)).map((s) => ({ name: SPORT_LABEL[s], color: `var(--viz-${s})`, kind: "bar" as const, sport: s }))} />
            {(() => {
              const w = volWeeks[hourIdx ?? volWeeks.length - 1];
              return w ? (
                <Readout
                  title={`Week of ${formatDateShort(w.weekStart)}`}
                  values={[{ label: "total", value: hm(w.totalHours) }, ...SPORTS.filter((s) => w.hours[s] > 0).map((s) => ({ label: SPORT_LABEL[s].toLowerCase(), value: hm(w.hours[s]) }))]}
                />
              ) : null;
            })()}
            {hours && <EChart option={hours} height={200} onIndex={setHourIdx} ariaLabel={`Weekly hours by sport for ${volWeeks.length} weeks.`} />}
          </>
        )}
      </Card>

      <Card icon={CalendarRange} title="This week" aside={volume.planned ? "done / plan" : undefined} note={volume.planned ? "The tick is the plan: the active cycle's swim, bike and run sets for this week. Sets planned by distance are turned into time with your own mean speed." : "No day-of-week cycle with swim, bike or run sets is active, so there is no plan to compare."}>
        {volume.weeks.at(-1) && <WeekAgainstPlan week={volume.weeks.at(-1)!} planned={volume.planned} />}
      </Card>

      <Card icon={Mountain} title="Long-session ladder" note="The longest swim, ride and run of each week, 16 weeks. The dashed line is the race target. Close the gap one step a week: ride +30 min, run +15 min, swim +400 m.">
        <Legend items={(["swim", "bike", "run"] as const).map((s) => ({ name: SPORT_LABEL[s], color: `var(--viz-${s})`, kind: "bar" as const, sport: s }))} />
        {(() => {
          const w = ladderWeeks[ladderIdx ?? ladderWeeks.length - 1];
          if (!w) return null;
          const v = (s: "swim" | "bike" | "run") => ladderValue(s, w);
          return (
            <Readout
              title={`Week of ${formatDateShort(w.weekStart)}`}
              values={[
                { label: "km swim", value: v("swim") !== null ? String(v("swim")) : "–" },
                { label: "ride", value: v("bike") !== null ? hm(v("bike")!) : "–" },
                { label: "run", value: v("run") !== null ? hm(v("run")!) : "–" },
              ]}
            />
          );
        })()}
        {ladder && <EChart option={ladder} height={276} onIndex={setLadderIdx} ariaLabel={`Longest swim, ride and run per week for ${ladderWeeks.length} weeks.`} />}
      </Card>

      <Card icon={Mountain} title={demandsTitle(volume)} note="Each row looks back 8 weeks for long sessions, 4 weeks for a brick and 6 weeks for the ramp rate. Tap a row for the session that set it.">
        <DemandsList rows={volume.checklist} />
      </Card>

      <Card icon={Flame} title="Intensity distribution" note="Time by heart rate: low under 85 % of LTHR, mid 85 to 100 %, high above. The outlined band is the Ironman build target: 75 to 85 % low.">
        <Legend
          items={[
            { name: "Low", color: "var(--viz-band-low)", kind: "bar" },
            { name: "Mid", color: "var(--viz-band-mid)", kind: "bar" },
            { name: "High", color: "var(--viz-band-high)", kind: "bar" },
          ]}
        />
        {dk && (
          <Readout
            title={`Week of ${formatDateShort(dk.weekStart)} · ${DISTRIBUTION_TEXT[dk.label]}`}
            values={[
              { label: "low", value: pct(dk, "low") },
              { label: "mid", value: pct(dk, "mid") },
              { label: "high", value: pct(dk, "high") },
            ]}
          />
        )}
        {dist && <EChart option={dist} height={150} onIndex={setDistIdx} ariaLabel={`Intensity distribution for ${weeks.length} weeks.`} />}
      </Card>

      <p className="text-[11px] text-muted-foreground px-1">
        {computedAt ? `Computed ${formatDateShort(computedAt.slice(0, 10))}, ${computedAt.slice(11, 16)} UTC.` : "Computing…"} Strength sessions logged here count with their RPE; a lift Garmin also recorded counts once.
      </p>
    </div>
  );
}
