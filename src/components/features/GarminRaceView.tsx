"use client";

import { EChart } from "@/components/charts/EChart";
import { useVizTheme } from "@/components/charts/viz-theme";
import { Card, Legend, Stat } from "@/components/features/garmin/GarminUi";
import { DemandsList, demandsTitle } from "@/components/features/garmin/Volume";
import { useSwipe } from "@/components/features/garmin/use-swipe";
import { RACE_LABEL } from "@/lib/garmin/analytics/overview";
import { RACE_MAX_DROP_PCT, RACE_TSB, projectionSentence } from "@/lib/garmin/analytics/projection";
import { FUEL_MIN_SESSIONS, sweatModel } from "@/lib/garmin/analytics/race";
import { durationLabel } from "@/lib/garmin/charts/activity";
import { pmcOption } from "@/lib/garmin/charts/load";
import { heatOption, paceMin, paceTick } from "@/lib/garmin/charts/trends";
import type { RaceData } from "@/lib/garmin/queries";
import { phaseLabel } from "@/lib/utils/periodization";
import { formatDateShort } from "@/lib/utils/format";
import { Bike, ChevronLeft, CloudSun, Droplets, Flag, Footprints, Gauge, Layers, Mountain, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";

/**
 * The race page: countdown and taper, fitness and form to race day, the
 * demands checklist, a pacing guide, bricks, fuel and fluid, and heat.
 */

const signed = (n: number) => `${n >= 0 ? "+" : ""}${Math.round(n)}`;
const perHour = (v: number | null, durationS: number) => (v === null || durationS <= 0 ? null : Math.round(v / (durationS / 3600)));

function Header({ title }: { title: string }) {
  return (
    <>
      <div className="flex items-center px-4 pt-6 pb-2 shrink-0">
        <Link href="/more/garmin?tab=overview" className="flex items-center gap-0.5 text-primary active:opacity-70 -ml-1">
          <ChevronLeft className="w-5 h-5" />
          <span className="text-sm font-medium">Garmin</span>
        </Link>
      </div>
      <div className="px-4 pt-1 pb-3 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
      </div>
    </>
  );
}

export function GarminRaceView({ data }: { data: RaceData | null }) {
  const theme = useVizTheme();
  const router = useRouter();
  const swipe = useSwipe({ onRight: () => (window.history.length > 1 ? router.back() : router.replace("/more/garmin")) });
  const opts = useMemo(
    () =>
      theme && data
        ? {
            pmc: pmcOption(data.series, "total", "6w", theme, data.projection),
            heat: data.heat.length >= 3 ? heatOption(data.heat, theme) : null,
          }
        : null,
    [theme, data],
  );
  const model = useMemo(() => (data ? sweatModel(data.fuel) : null), [data]);

  if (!data) {
    return (
      <div className="h-[100dvh] flex flex-col overflow-hidden">
        <Header title="Race" />
        <main className="flex-1 overflow-y-auto px-4 pb-nav-safe-lg space-y-4">
          <p className="text-sm text-muted-foreground">No active training cycle with a start date. Start a cycle and set its race date to see the race page.</p>
          <Link href="/cycles" className="flex h-11 items-center justify-center rounded-xl bg-muted text-sm font-semibold active:opacity-70">
            Training cycles
          </Link>
        </main>
      </div>
    );
  }

  const r = data.race;
  const p = data.projection;
  const taperIn = data.taperStart ? Math.round((Date.parse(data.taperStart) - Date.parse(data.today)) / 86_400_000) : null;
  const g = data.pacing;
  const pace = (s: number) => paceTick(paceMin(s));

  return (
    <div className="h-[100dvh] flex flex-col overflow-hidden">
      <Header title={r.raceSet && r.distance ? RACE_LABEL[r.distance] : "Race"} />
      <main {...swipe.handlers} style={swipe.style} className="flex-1 overflow-y-auto px-4 pb-nav-safe-lg space-y-4">
        <p className="text-lg font-semibold leading-snug">
          {r.raceSet ? `${formatDateShort(r.raceDay)}: ${Math.max(0, r.daysToRace)} days to go.` : `No race date on "${r.cycleName}": counting to the cycle's last day, ${formatDateShort(r.raceDay)}.`}{" "}
          {p ? projectionSentence(p) : ""}
        </p>
        <Link
          href={`/cycles/${data.cycleId}/edit#race`}
          className={r.raceSet ? "flex h-11 items-center text-sm text-primary active:opacity-60" : "flex h-11 items-center justify-center rounded-xl bg-muted text-sm font-semibold text-primary active:opacity-70"}
        >
          {r.raceSet ? "Change the race date or distance" : "Set the race date and distance"}
        </Link>

        <div className="grid grid-cols-2 gap-2">
          <Stat icon={Flag} label="Days to race" value={String(Math.max(0, r.daysToRace))} sub={formatDateShort(r.raceDay)} />
          <Stat icon={Layers} label="Phase" value={r.phase ? phaseLabel(r.phase) : "Not started"} sub={r.week ? `week ${r.week}${r.isDeload ? ", recovery" : ""}` : null} />
          <Stat
            icon={Mountain}
            label="Taper"
            value={data.taperStart ? (taperIn !== null && taperIn > 0 ? `in ${taperIn} days` : "started") : "–"}
            sub={data.taperStart ? `from ${formatDateShort(data.taperStart)}` : null}
          />
          <Stat
            icon={Gauge}
            label="Race-morning form"
            value={p ? signed(p.race.tsb) : "–"}
            sub={p ? `target +${RACE_TSB[0]} to +${RACE_TSB[1]} · fitness ${Math.round(p.race.ctl)} (${p.race.dropPct >= 0 ? "−" : "+"}${Math.abs(Math.round(p.race.dropPct))} % from peak)` : "no projection"}
          />
        </div>

        {opts && (
          <Card
            icon={TrendingUp}
            title="Fitness and form to race day"
            note={`Six weeks back, then the plan: this week's load scaled by the cycle's periodization. The band is form at 85 to 115 % of that load. Target on race morning: form +${RACE_TSB[0]} to +${RACE_TSB[1]}, fitness no more than ${RACE_MAX_DROP_PCT} % under its peak.`}
          >
            <Legend
              items={[
                { name: "Fitness", color: "var(--viz-positive)", kind: "line" },
                { name: "Fatigue", color: "var(--viz-bike)", kind: "line" },
                { name: "Form", color: "var(--viz-negative)", kind: "bar" },
                { name: "Plan (dashed)", color: "var(--foreground)", kind: "line" },
                { name: "Race-morning target", color: "var(--viz-good)", kind: "bar" },
              ]}
            />
            <EChart option={opts.pmc} height={300} ariaLabel={p ? projectionSentence(p) : "Fitness, fatigue and form for six weeks."} />
          </Card>
        )}

        <Card icon={Mountain} title={demandsTitle(data.volume)} note="Long sessions over 8 weeks, a brick over 4, the ramp rate over 6. Tap a row for the session.">
          <DemandsList rows={data.volume.checklist} />
        </Card>

        <Card
          icon={Bike}
          title="Pacing guide"
          note={`A guide from your thresholds, not a prediction. The same rule as your race plan: bike watts keep the bike under the TSS cap at your expected bike time (the race plan's, else 28 km/h), run at ${data.volume.distance === "full" ? "80 to 85" : "85 to 90"} % of critical speed, and keep heart rate under ${data.volume.distance === "full" ? "85 % of LTHR" : "93 % (bike) and 94 % (run) of LTHR"}${data.lthrSource === "watch" ? ", from the watch's LTHR" : data.lthrSource === "estimate" ? ", from your recent hard efforts" : ""}. Without a power meter outdoors, the bike runs on the heart-rate ceiling.`}
        >
          <table className="w-full text-sm tabular-nums">
            <tbody>
              <tr className="border-b border-border/50">
                <td className="py-2 flex items-center gap-2">
                  <Bike className="h-4 w-4 text-muted-foreground" aria-hidden /> Bike
                </td>
                <td className="text-right">{g.bikeWatts ? `${g.bikeWatts[0]}–${g.bikeWatts[1]} W` : "no FTP"}</td>
                <td className="text-right text-muted-foreground">{g.bikeHrCeiling ? `≤ ${g.bikeHrCeiling} bpm` : "–"}</td>
              </tr>
              <tr>
                <td className="py-2 flex items-center gap-2">
                  <Footprints className="h-4 w-4 text-muted-foreground" aria-hidden /> Run
                </td>
                <td className="text-right">{g.runSpeed ? `${pace(g.runSpeed[0])}–${pace(g.runSpeed[1])}/km` : "no critical speed"}</td>
                <td className="text-right text-muted-foreground">{g.runHrCeiling ? `≤ ${g.runHrCeiling} bpm` : "–"}</td>
              </tr>
            </tbody>
          </table>
        </Card>

        <Card
          icon={Layers}
          title={`Bricks · ${data.bricks.length}`}
          note="A run that starts within 15 minutes of a ride. Each is compared with your fresh runs at the same mean heart rate (± 5 bpm, 90 days either side): how much pace the bike costs you."
        >
          {data.bricks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No ride-then-run session yet. Add one short run straight after a ride each week from the build phase.</p>
          ) : (
            <ul className="divide-y divide-border/50">
              {data.bricks.slice(0, 8).map((b) => (
                <li key={b.id}>
                  <Link href={`/more/garmin/activity/${b.id}`} className="flex items-center justify-between gap-2 py-2 text-sm tabular-nums active:opacity-70">
                    <span>
                      {formatDateShort(b.day)} · {durationLabel(b.durationS)}
                    </span>
                    <span className="text-muted-foreground">
                      {pace(b.speed)}/km at {Math.round(b.hr)} bpm
                      {b.diffPct !== null ? (
                        <b className="ml-2 text-foreground">
                          {signed(b.diffPct)} % vs fresh ({b.freshCount})
                        </b>
                      ) : (
                        <span className="ml-2">no fresh run to compare</span>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          icon={Droplets}
          title="Fuel and fluid"
          note={`Sweat loss is Garmin's estimate; temperature is the watch's sensor (on the wrist it reads warmer than the air). Log what you ate and drank on the session's page. With ${FUEL_MIN_SESSIONS} sessions over a spread of temperatures, the table above gives your fluid need per hour.`}
        >
          {model ? (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Sweat loss per hour by temperature, from {model.n} sessions</p>
              <div className="grid grid-cols-5 gap-1 text-center tabular-nums">
                {model.at.map((a) => (
                  <div key={a.temperature} className="rounded-lg bg-background py-2">
                    <p className="text-[11px] text-muted-foreground">{a.temperature} °C</p>
                    <p className="text-sm font-semibold">{(a.mlPerHour / 1000).toFixed(2)} l</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {data.fuel.length && data.fuel.every((f) => f.temperature === null)
                ? "Your ride and run files have no temperature, so the fluid plan by temperature and the heat chart cannot be made. A temperature sensor paired to the watch adds it."
                : "Not enough long sessions with a temperature spread yet for a fluid plan."}
            </p>
          )}
          <table className="w-full text-xs tabular-nums">
            <thead className="text-muted-foreground">
              <tr className="text-left">
                <th className="py-1 font-normal">Session</th>
                <th className="font-normal text-right">°C</th>
                <th className="font-normal text-right">Sweat/h</th>
                <th className="font-normal text-right">Carbs/h</th>
                <th className="font-normal text-right">Drink/h</th>
              </tr>
            </thead>
            <tbody>
              {data.fuel.slice(0, 12).map((f) => (
                <tr key={f.id} className="border-t border-border/50">
                  <td className="py-2">
                    <Link href={`/more/garmin/activity/${f.id}#fuel`} className="text-primary active:opacity-60">
                      {formatDateShort(f.day)} · {durationLabel(f.durationS)}
                    </Link>
                  </td>
                  <td className="text-right">{f.temperature !== null ? Math.round(f.temperature) : "–"}</td>
                  <td className="text-right">{perHour(f.sweatMl, f.durationS) ?? "–"} ml</td>
                  <td className="text-right">{f.carbsG !== null ? `${perHour(f.carbsG, f.durationS)} g` : "–"}</td>
                  <td className="text-right">{f.fluidMl !== null ? `${perHour(f.fluidMl, f.durationS)} ml` : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        {opts?.heat && (
          <Card icon={CloudSun} title="Heat" note="Decoupling against the session's mean temperature, steady sessions only. A rising cloud of dots means heat costs you; plan pacing and fluid for race-day weather.">
            <Legend
              items={[
                { name: "Bike", color: "var(--viz-bike)", kind: "dot" },
                { name: "Run", color: "var(--viz-run)", kind: "dot" },
              ]}
            />
            <EChart option={opts.heat} height={170} ariaLabel={`Decoupling against temperature for ${data.heat.length} steady sessions.`} />
          </Card>
        )}
      </main>
    </div>
  );
}
