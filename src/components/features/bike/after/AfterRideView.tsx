"use client";

/** The after-ride view on the session page (docs/plans/bike-sessions.md, 5.5 and 7.3). */

import { STEP_WORD } from "@/components/features/guided/types";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { setRideRpe } from "@/lib/actions/after-ride";
import { addThresholdValue } from "@/lib/actions/athlete-profile";
import { saveFuelLogAction } from "@/lib/actions/nutrition";
import { updatePlannedSession } from "@/lib/actions/planned-sessions";
import { formatTime } from "@/lib/utils/format";
import { shortDay } from "@/lib/utils/seasons";
import { callAction } from "@/lib/utils/stale-bundle";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AfterRideData, AfterRideRow } from "./load";
import { RideChart } from "./RideChart";
import { carbsTarget } from "./view";

const BAND_TEXT: Record<string, string> = { green: "On plan", yellow: "Partly", orange: "Far off plan", red: "Missed", done: "Done" };
const MARK: Record<string, { text: string; tone: string }> = {
  in: { text: "in range", tone: "text-emerald-600" },
  under: { text: "under", tone: "text-amber-600" },
  over: { text: "over", tone: "text-rose-600" },
};

const round = (v: number | null) => (v == null ? null : Math.round(v));

function stepName(r: AfterRideRow, rows: AfterRideRow[]): string {
  const word = STEP_WORD[r.type];
  const same = rows.filter((x) => x.type === r.type);
  return same.length > 1 && r.type === "work" ? `${word} ${same.indexOf(r) + 1}` : word;
}

function useSave() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (call: Promise<{ success: boolean; error?: string }>) => {
    setBusy(true);
    setError(null);
    const r = await callAction(call);
    setBusy(false);
    if (!r.success) {
      setError("error" in r && r.error ? r.error : "Not saved");
      return false;
    }
    router.refresh();
    return true;
  };
  return { busy, error, run };
}

function NotThisActivity({ data }: { data: AfterRideData }) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<number | null>(data.choices.find((c) => c.paired)?.id ?? null);
  const { busy, error, run } = useSave();
  const days = [...new Set(data.choices.map((c) => c.date))];
  const save = async (garminActivityId: number | null) => {
    const ok = await run(
      updatePlannedSession(garminActivityId == null ? { op: "unpick", id: data.plannedSessionId } : { op: "pick", id: data.plannedSessionId, garminActivityId }),
    );
    if (ok) setOpen(false);
  };
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="min-h-11 rounded-xl border border-border px-3 text-sm font-medium active:opacity-70">
        Not this activity
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} blur>
        <div className="w-full bg-card rounded-t-3xl px-5 pt-6 pb-10" role="dialog" aria-label="Which ride was this session?">
          <p className="text-base font-semibold">Which ride was this session?</p>
          {days.length > 0 && (
            <p className="text-sm text-muted-foreground mb-2">
              Rides on {shortDay(days[0])}
              {days.length > 1 ? ` to ${shortDay(days[days.length - 1])}` : ""}
            </p>
          )}
          <div className="flex flex-col gap-1" role="radiogroup" aria-label="Rides">
            {data.choices.map((c) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={chosen === c.id}
                onClick={() => setChosen(c.id)}
                className={`min-h-11 flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm ${chosen === c.id ? "bg-primary/15" : "bg-muted"}`}
              >
                <span>
                  {shortDay(c.date)} · {c.name} {formatTime(Math.round(c.durationS))}
                  {c.paired && <span className="block text-xs text-muted-foreground">paired now</span>}
                </span>
                {chosen === c.id && <span aria-hidden>✓</span>}
              </button>
            ))}
          </div>
          {error && (
            <p className="mt-2 text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button type="button" disabled={busy} onClick={() => void save(null)} className="min-h-12 rounded-2xl border border-border text-base font-medium disabled:opacity-60 active:opacity-70">
              None of these
            </button>
            <button
              type="button"
              disabled={busy || chosen == null}
              onClick={() => chosen != null && void save(chosen)}
              className="min-h-12 rounded-2xl bg-primary text-base font-semibold text-primary-foreground disabled:opacity-60 active:opacity-80"
            >
              Save
            </button>
          </div>
        </div>
      </BottomSheet>
    </>
  );
}

function Effort({ data }: { data: AfterRideData }) {
  const { busy, error, run } = useSave();
  const watch = data.watchRpe != null && data.watchRpe > 0 ? Math.max(1, Math.min(10, Math.round(data.watchRpe / 10))) : null;
  const value = data.rpe ?? watch;
  return (
    <section className="px-4 pt-4">
      <h2 className="text-sm font-semibold mb-2">How did it feel? (RPE)</h2>
      <div className="grid grid-cols-5 gap-2" role="group" aria-label="Ride RPE">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
          <button
            key={n}
            type="button"
            disabled={busy}
            aria-pressed={value === n}
            onClick={() => void run(setRideRpe({ plannedSessionId: data.plannedSessionId, rpe: data.rpe === n ? null : n }))}
            className={`min-h-11 rounded-xl text-base font-semibold active:scale-95 ${value === n ? "bg-primary text-primary-foreground" : "bg-muted"}`}
          >
            {n}
          </button>
        ))}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{data.rpe == null && watch != null ? `From the watch: RPE ${watch}. Tap to change.` : "RPE 1-10. Taken from the watch when you set it there."}</p>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function Carbs({ data, carbs }: { data: AfterRideData; carbs: NonNullable<AfterRideData["carbs"]> }) {
  const { busy, error, run } = useSave();
  const [grams, setGrams] = useState(carbs.carbsG != null ? String(carbs.carbsG) : "");
  const t = carbsTarget(carbs.seconds);
  const save = () => {
    const n = Number(grams);
    void run(saveFuelLogAction(grams.trim() === "" ? { garminActivityId: data.activity.garminId, clear: true } : { garminActivityId: data.activity.garminId, carbsG: Number.isFinite(n) ? Math.round(n) : null }));
  };
  return (
    <section className="px-4 pt-4">
      <h2 className="text-sm font-semibold">Carbs taken?</h2>
      <p className="text-xs text-muted-foreground">
        Target 40-60 g per hour: {t.low}-{t.high} g for this ride.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <label className="flex flex-1 items-center justify-between gap-2 text-sm">
          Carbs (g)
          <input inputMode="numeric" value={grams} onChange={(e) => setGrams(e.target.value)} className="w-24 min-h-11 rounded-xl bg-muted px-3 text-right text-base" />
        </label>
        <button type="button" disabled={busy} onClick={save} className="min-h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60 active:opacity-80">
          Save
        </button>
      </div>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function FtpOffer({ test }: { test: NonNullable<AfterRideData["ftpTest"]> }) {
  const { busy, error, run } = useSave();
  const [done, setDone] = useState(false);
  const save = async () => {
    const ok = await run(addThresholdValue({ kind: "ftp", value: test.ftp, source: "test", measuredOn: test.date, notes: `FTP test: 20 min at ${Math.round(test.avgPower)} W` }));
    if (ok) setDone(true);
  };
  return (
    <section className="px-4 pt-4">
      {done ? (
        <p className="rounded-xl bg-emerald-500/10 px-3 py-2 text-sm" role="status">
          FTP set to {test.ftp} W.
        </p>
      ) : (
        <button type="button" disabled={busy} onClick={() => void save()} className="min-h-12 w-full rounded-2xl bg-primary px-4 text-base font-semibold text-primary-foreground disabled:opacity-60 active:opacity-80">
          Set FTP to 95 % of 20 min power ({test.ftp} W)
        </button>
      )}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

export function AfterRideView({ data }: { data: AfterRideData }) {
  const a = data.activity;
  const line1 = [a.name, a.durationS ? formatTime(Math.round(a.durationS)) : null, a.distanceM ? `${(a.distanceM / 1000).toFixed(1)} km` : null].filter(Boolean).join(" · ");
  const line2 = [a.np ? `NP ${Math.round(a.np)} W` : null, a.avgHr ? `avg HR ${Math.round(a.avgHr)}` : null, a.cadence ? `cadence ${Math.round(a.cadence)}` : null].filter(Boolean).join(" · ");
  return (
    <div data-testid="after-ride" className="pb-2">
      {(data.band || data.minutes) && (
        <p className="px-4 text-sm font-semibold" data-testid="after-band">
          {[data.band ? BAND_TEXT[data.band] : null, data.minutes].filter(Boolean).join(" · ")}
        </p>
      )}
      <section className="mx-4 mt-2 rounded-xl bg-muted px-3 py-3">
        <p className="text-sm">
          <b>Recorded on Garmin</b> · {line1}
        </p>
        {line2 && <p className="text-sm text-muted-foreground">{line2}</p>}
        <div className="mt-2 flex gap-2">
          <Link href={`/more/garmin/activity/${a.garminId}`} className="min-h-11 flex items-center rounded-xl border border-border px-3 text-sm font-medium active:opacity-70">
            Open activity
          </Link>
          <NotThisActivity data={data} />
        </div>
      </section>

      {data.plan.length > 0 && (
        <section className="mx-4 mt-3 rounded-xl bg-muted px-3 py-3">
          <RideChart plan={data.plan} power={data.power} />
        </section>
      )}

      {data.rows.length > 0 && (
        <section className="px-4 pt-4">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold">Step by step</h2>
            {data.matchNote && <p className="text-xs text-muted-foreground" data-testid="match-note">{data.matchNote}</p>}
          </div>
          <table className="mt-2 w-full text-sm" data-testid="after-steps">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-1 font-medium">Step</th>
                <th className="py-1 font-medium">Plan</th>
                <th className="py-1 font-medium">Done</th>
                <th className="py-1 font-medium">HR</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.key} className="border-t border-border align-top">
                  <td className="py-1.5 pr-2">{stepName(r, data.rows)}</td>
                  <td className="py-1.5 pr-2">
                    {r.powerText ?? "open"}
                    {r.hrText && <span className="block text-xs text-muted-foreground">HR {r.hrText}</span>}
                  </td>
                  <td className="py-1.5 pr-2">
                    {r.avgPower != null ? (
                      <>
                        <span className={r.mark ? MARK[r.mark].tone : ""}>{round(r.avgPower)} W</span>
                        <span className="block text-xs text-muted-foreground">
                          {[r.mark ? MARK[r.mark].text : null, r.normalizedPower != null ? `NP ${round(r.normalizedPower)}` : null, r.avgCadence != null ? `${round(r.avgCadence)} rpm` : null].filter(Boolean).join(" · ")}
                        </span>
                      </>
                    ) : r.seconds != null ? (
                      formatTime(r.seconds)
                    ) : (
                      "not done"
                    )}
                  </td>
                  <td className="py-1.5">
                    {r.avgHeartRate != null ? `${round(r.avgHeartRate)} / ${round(r.maxHeartRate) ?? "-"}` : "-"}
                    {r.hrOverCap && <span className="block text-xs text-rose-600">over the cap</span>}
                    {r.hrZoneSeconds != null && r.seconds ? (
                      <span className="block text-xs text-muted-foreground">
                        {formatTime(r.hrZoneSeconds)} in the target zone
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.rows.every((r) => r.seconds == null) && <p className="mt-1 text-xs text-muted-foreground">The step results come when the watch file is in.</p>}
        </section>
      )}

      {data.ftpTest && <FtpOffer test={data.ftpTest} />}
      <Effort data={data} />
      {data.carbs && <Carbs data={data} carbs={data.carbs} />}
    </div>
  );
}
