"use client";

/**
 * The race-day plan page (docs/plans/nutrition-and-race-day.md, 6): timeline,
 * pacing per leg, fuel schedule and race morning, each with its evidence
 * label, and a sheet to edit the inputs. Clock times come as "HH:MM" strings.
 */

import { saveRacePlanAction } from "@/lib/actions/nutrition";
import { BottomSheet } from "@/components/ui/BottomSheet";
import type { Band, CaffeinePlan } from "@/lib/utils/fueling";
import { hoursMinutes, type FuelRow, type LegTime, type TimelineRow } from "@/lib/utils/race-plan";
import type { RacePlanInput } from "@/lib/validators/nutrition";
import { callAction } from "@/lib/utils/stale-bundle";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Leg = { text: string; evidence: string; leg: LegTime };

export type RacePlanView =
  | { supported: false; raceId: number; message: string }
  | {
      supported: true;
      raceId: number;
      version: number | null;
      inputs: RacePlanInput;
      timeline: TimelineRow[];
      totalMinutes: number;
      swim: Leg & { pace: string | null };
      bike: Leg & { watts: [number, number] | null; ifRange: [number, number]; hrCeiling: number | null };
      run: Leg & { pace: string | null; hrCeiling: number | null };
      transitions: { t1: number; t2: number; evidence: string };
      fuel: {
        carbsPerHour: { bike: number; run: number };
        carbsText: string;
        carbsEvidence: string;
        fluid: Band;
        sodium: Band;
        sweatTestOn: string | null;
        schedule: FuelRow[];
        caffeine: CaffeinePlan | null;
      };
      raceMorning: { text: string; evidence: string }[];
      safety: string[];
    };

const SECTION = "px-4 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground";
const CARD = "mx-4 rounded-2xl bg-card px-4 py-3 space-y-1";
const LEG_NAME: Record<TimelineRow["leg"], string> = { swim: "Swim", t1: "T1", bike: "Bike", t2: "T2", run: "Run", finish: "Finish" };

const Evidence = ({ label }: { label: string }) => <p className="text-[11px] text-muted-foreground">Evidence: {label}</p>;

export function RacePlanClient({ plan }: { plan: RacePlanView }) {
  const [editing, setEditing] = useState(false);
  if (!plan.supported) return <p className="px-4 text-sm text-muted-foreground">{plan.message}</p>;
  const p = plan;
  return (
    <div className="space-y-6 pb-8">
      <div className="mx-4 rounded-2xl border border-border px-4 py-3 space-y-1" data-testid="race-plan-safety">
        {p.safety.map((s) => (
          <p key={s} className="text-xs text-muted-foreground">
            {s}
          </p>
        ))}
      </div>

      <section>
        <div className="flex items-center justify-between pr-4">
          <p className={SECTION}>Timeline</p>
          <button type="button" onClick={() => setEditing(true)} className="min-h-[44px] px-2 text-sm font-medium text-primary active:opacity-60">
            Edit
          </button>
        </div>
        <table className="mx-4 w-[calc(100%-2rem)] text-sm" data-testid="race-timeline">
          <tbody className="divide-y divide-border">
            {p.timeline.map((r) => (
              <tr key={r.leg}>
                <td className="py-2 tabular-nums w-16">{r.start}</td>
                <td className="py-2 font-medium">{LEG_NAME[r.leg]}</td>
                <td className="py-2 text-right tabular-nums text-muted-foreground">
                  {r.leg === "finish" ? hoursMinutes(p.totalMinutes) : `${hoursMinutes(r.minutes)}${r.source ? ` · ${r.source}` : ""}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-4 pt-1">
          <Evidence label={`transitions ${p.transitions.evidence}; assumed leg times are inference`} />
        </div>
      </section>

      <section>
        <p className={SECTION}>Pacing</p>
        <div className="space-y-2">
          <div className={CARD}>
            <p className="font-medium">Swim{p.swim.pace ? ` · ${p.swim.pace}` : ""}</p>
            <p className="text-sm text-muted-foreground">{p.swim.text}</p>
            <Evidence label={p.swim.evidence} />
          </div>
          <div className={CARD}>
            <p className="font-medium" data-testid="bike-pacing">
              Bike · IF {p.bike.ifRange[0].toFixed(2)}-{p.bike.ifRange[1].toFixed(2)}
              {p.bike.watts ? ` · ${p.bike.watts[0]}-${p.bike.watts[1]} W` : ""}
            </p>
            <p className="text-sm text-muted-foreground">{p.bike.text}</p>
            {p.bike.hrCeiling && <p className="text-sm text-muted-foreground">Heart rate under {p.bike.hrCeiling} bpm.</p>}
            <Evidence label={p.bike.evidence} />
          </div>
          <div className={CARD}>
            <p className="font-medium">
              Run{p.run.hrCeiling ? ` · under ${p.run.hrCeiling} bpm` : ""}
              {p.run.pace ? ` · ${p.run.pace}` : ""}
            </p>
            <p className="text-sm text-muted-foreground">{p.run.text}</p>
            <Evidence label={p.run.evidence} />
          </div>
        </div>
      </section>

      <section>
        <p className={SECTION}>Fuel</p>
        <div className={CARD}>
          <p className="text-sm">
            Bike {p.fuel.carbsPerHour.bike} g/h, run {p.fuel.carbsPerHour.run} g/h carbohydrate.
          </p>
          <p className="text-sm text-muted-foreground">{p.fuel.carbsText}</p>
          <Evidence label={p.fuel.carbsEvidence} />
          <p className="text-sm pt-2">
            Fluid {p.fuel.fluid.low}-{p.fuel.fluid.high} ml/h, sodium {p.fuel.sodium.low}-{p.fuel.sodium.high} mg/h
            {p.fuel.sweatTestOn ? ` (sweat test ${p.fuel.sweatTestOn})` : ""}.
          </p>
          <p className="text-sm text-muted-foreground">{p.fuel.fluid.text}</p>
          <Evidence label={p.fuel.fluid.evidence} />
          {p.fuel.caffeine && (
            <>
              <p className="text-sm pt-2">{p.fuel.caffeine.text}</p>
              <Evidence label={p.fuel.caffeine.evidence} />
            </>
          )}
        </div>
        <table className="mx-4 mt-2 w-[calc(100%-2rem)] text-sm" data-testid="fuel-schedule">
          <thead>
            <tr className="text-[11px] text-muted-foreground">
              <th className="text-left font-normal">Time</th>
              <th className="text-left font-normal">Leg</th>
              <th className="text-right font-normal">Carbs</th>
              <th className="text-right font-normal">Fluid</th>
              <th className="text-right font-normal">Sodium</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {p.fuel.schedule.map((r) => (
              <tr key={`${r.leg}-${r.clock}`}>
                <td className="py-1.5 tabular-nums">{r.clock}</td>
                <td className="py-1.5">{LEG_NAME[r.leg]}</td>
                <td className="py-1.5 text-right tabular-nums">{r.carbsG} g</td>
                <td className="py-1.5 text-right tabular-nums">{r.fluidMl} ml</td>
                <td className="py-1.5 text-right tabular-nums">{r.sodiumMg} mg</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <p className={SECTION}>Race morning</p>
        <div className={CARD}>
          {p.raceMorning.map((r) => (
            <div key={r.text}>
              <p className="text-sm">{r.text}</p>
              <Evidence label={r.evidence} />
            </div>
          ))}
        </div>
      </section>

      <BottomSheet open={editing} onClose={() => setEditing(false)}>
        {editing && <EditPlan plan={p} onDone={() => setEditing(false)} />}
      </BottomSheet>
    </div>
  );
}

const FIELDS = [
  ["swimMinutes", "Swim", "min"],
  ["bikeMinutes", "Bike", "min"],
  ["runMinutes", "Run", "min"],
  ["t1Minutes", "T1", "min"],
  ["t2Minutes", "T2", "min"],
  ["swimOffsetSecondsPer100m", "Swim offset on CSS", "s/100"],
  ["raceTemperatureC", "Race temperature", "°C"],
] as const;
type NumKey = (typeof FIELDS)[number][0];

function EditPlan({ plan, onDone }: { plan: Extract<RacePlanView, { supported: true }>; onDone: () => void }) {
  const router = useRouter();
  const i = plan.inputs;
  const [start, setStart] = useState(i.startTime ?? "07:00");
  const [nums, setNums] = useState<Record<NumKey, string>>(() => Object.fromEntries(FIELDS.map(([k]) => [k, i[k] != null ? String(i[k]) : ""])) as Record<NumKey, string>);
  const [interval, setFuelEvery] = useState<15 | 20>(i.fuelIntervalMinutes ?? 20);
  const [caffeine, setCaffeine] = useState(i.caffeine ?? false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    const change: Record<string, unknown> = { startTime: start, fuelIntervalMinutes: interval, caffeine };
    for (const [k] of FIELDS) change[k] = nums[k].trim() === "" ? null : Number(nums[k].replace(",", "."));
    const r = await callAction(saveRacePlanAction({ raceId: plan.raceId, expectedVersion: plan.version ?? undefined, change }));
    setSaving(false);
    if (r.success) {
      onDone();
      router.refresh();
    } else setError(r.error);
  }

  return (
    <div className="space-y-3 p-4">
      <h2 className="text-lg font-semibold">Edit race plan</h2>
      <label htmlFor="plan-start" className="block space-y-1">
        <span className="text-[11px] text-muted-foreground">Start time</span>
        <input id="plan-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} className="h-11 w-full rounded-xl bg-background px-3 text-base outline-none" />
      </label>
      <p className="text-[11px] text-muted-foreground">Leave a time empty to use your thresholds or the default.</p>
      <div className="grid grid-cols-2 gap-2">
        {FIELDS.map(([key, label, unit]) => (
          <label key={key} htmlFor={`plan-${key}`} className="space-y-1">
            <span className="text-[11px] text-muted-foreground">{label}</span>
            <span className="flex items-center gap-1 rounded-xl bg-background px-3">
              <input id={`plan-${key}`} aria-label={label} inputMode="decimal" value={nums[key]} onChange={(e) => setNums({ ...nums, [key]: e.target.value })} className="h-11 w-full bg-transparent text-base outline-none tabular-nums" />
              <span className="text-xs text-muted-foreground">{unit}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="flex gap-2" role="group" aria-label="Fuel every">
        {([15, 20] as const).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={interval === m}
            onClick={() => setFuelEvery(m)}
            className={`h-11 flex-1 rounded-xl text-sm active:opacity-70 ${interval === m ? "bg-foreground text-background" : "bg-background"}`}
          >
            Fuel every {m} min
          </button>
        ))}
      </div>
      <label className="flex items-center gap-3 min-h-[44px]">
        <input type="checkbox" checked={caffeine} onChange={(e) => setCaffeine(e.target.checked)} className="h-5 w-5" />
        <span className="text-sm">Show caffeine timing</span>
      </label>
      <button type="button" onClick={save} disabled={saving} className="h-11 w-full rounded-xl bg-foreground text-background text-sm font-semibold disabled:opacity-40 active:opacity-70">
        {saving ? "Saving…" : "Save plan"}
      </button>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
