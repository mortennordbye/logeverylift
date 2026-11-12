"use client";

import { BottomSheet } from "@/components/ui/BottomSheet";
import type { BodySignal } from "@/lib/garmin/analytics/overview";
import { isGap, rateSignal, type Rating, type RatingGap, type Tone } from "@/lib/garmin/analytics/norms";
import type { BodyKey, OverviewData } from "@/lib/garmin/queries";
import { formatDateShort } from "@/lib/utils/format";
import { BatteryMedium, BedDouble, ChevronRight, Gauge, Heart, HeartPulse, Hourglass, Moon, Scale, Wind, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

/**
 * The Overview's body grid: each signal rated on a published scale, the way
 * Garmin rates VO2 max, and a sheet with the scale, the trend against your own
 * normal, and what the signal means.
 */

const tab = (t: string) => `/more/garmin?tab=${t}`;

type BodyConfig = { label: string; unit: string; format: (v: number) => string; href: string; hrefLabel: string; icon: LucideIcon; color: string; about: string };

const BODY: Record<BodyKey, BodyConfig> = {
  sleep: {
    label: "Sleep",
    unit: "h",
    format: (v) => v.toFixed(1),
    href: tab("recovery"),
    hrefLabel: "Recovery",
    icon: Moon,
    color: "var(--viz-swim)",
    about: "Time asleep last night. Garmin also sets a need for each night from your training and recovery; the Recovery tab shows sleep against that need.",
  },
  sleepScore: {
    label: "Sleep score",
    unit: "",
    format: (v) => String(Math.round(v)),
    href: tab("recovery"),
    hrefLabel: "Recovery",
    icon: BedDouble,
    color: "var(--viz-sleep-score)",
    about: "Garmin's 0 to 100 score for the night, from duration, sleep stages, stress during sleep and how often you woke.",
  },
  hrv: {
    label: "HRV",
    unit: "ms",
    format: (v) => String(Math.round(v)),
    href: tab("recovery"),
    hrefLabel: "Recovery",
    icon: HeartPulse,
    color: "var(--viz-run)",
    about:
      "Heart rate variability overnight. It differs too much between people to compare with others, so Garmin compares your 7-day average with your own baseline. A drop often follows hard training, illness, alcohol or poor sleep.",
  },
  restingHr: {
    label: "Resting HR",
    unit: "bpm",
    format: (v) => String(Math.round(v)),
    href: tab("recovery"),
    hrefLabel: "Recovery",
    icon: Heart,
    color: "var(--viz-negative)",
    about: "Your lowest heart rate of the day. It falls as aerobic fitness grows. A rise of about 5 above your normal can mean fatigue or illness.",
  },
  respiration: {
    label: "Breathing",
    unit: "/min",
    format: (v) => v.toFixed(1),
    href: tab("recovery"),
    hrefLabel: "Recovery",
    icon: Wind,
    color: "var(--viz-respiration)",
    about: "Breaths a minute, averaged while you slept. It stays steady for most people, so a rise above your own normal is often an early sign of illness.",
  },
  bodyBattery: {
    label: "Body battery",
    unit: "",
    format: (v) => String(Math.round(v)),
    href: tab("day"),
    hrefLabel: "Day",
    icon: BatteryMedium,
    color: "var(--viz-strength)",
    about: "Garmin's estimate of your energy reserve when you woke, from HRV, stress, sleep and activity.",
  },
  vo2max: {
    label: "VO2 max",
    unit: "",
    format: (v) => v.toFixed(1),
    href: tab("trends"),
    hrefLabel: "Trends",
    icon: Gauge,
    color: "var(--viz-bike)",
    about: "The most oxygen your body can use at full effort, in ml per kg per minute: the best single measure of aerobic fitness. Garmin's value from your watch files.",
  },
  fitnessAge: {
    label: "Fitness age",
    unit: "y",
    format: (v) => String(Math.round(v)),
    href: tab("trends"),
    hrefLabel: "Trends",
    icon: Hourglass,
    color: "var(--viz-fitness-age)",
    about: "The age your fitness matches, from Garmin's VO2 max, resting HR, body fat or BMI, and vigorous activity. Trends shows what would lower it.",
  },
  weight: {
    label: "Weight",
    unit: "kg",
    format: (v) => v.toFixed(1),
    href: tab("trends"),
    hrefLabel: "Trends",
    icon: Scale,
    color: "var(--viz-other)",
    about: "Your newest weigh-in. The rating uses body fat when your scale measures it, as weight alone says little about health; else BMI.",
  },
};

const TONE_COLOR: Record<Tone, string> = {
  poor: "var(--viz-critical)",
  fair: "var(--viz-serious)",
  ok: "var(--viz-warning)",
  good: "var(--viz-good)",
  excellent: "var(--viz-positive)",
  superior: "var(--viz-sleep-score)",
};

const NEEDS_TEXT: Record<RatingGap["needs"], string> = {
  sex: "Add your gender in Account to compare with people like you.",
  age: "Add your year of birth in Account to compare with people your age.",
};

/** The small line under a tile's name. */
function tileSub(k: BodyKey, data: OverviewData): string | undefined {
  if (k === "vo2max") return `Garmin, ${data.vo2Sport === "run" ? "running" : "cycling"}`;
  if (k === "hrv") return data.rating.hrvBaseline ? `last night · 7 d ${data.rating.hrvBaseline.weeklyAvg}` : "last night";
  if (k === "weight" && data.rating.bodyFat !== null) return `${data.rating.bodyFat} % body fat`;
  return undefined;
}

function ratingOf(k: BodyKey, s: BodySignal, data: OverviewData): Rating | RatingGap | null {
  return s.value === null ? null : rateSignal(k, s.value, data.rating);
}

function normalText(s: BodySignal): string {
  if (s.value === null) return "No recent value.";
  if (!s.normal) return "Still learning your normal: it needs 10 days in the 4 weeks before.";
  if (s.state === "within") return "Inside your normal.";
  return `${s.state === "below" ? "Below" : "Above"} your normal.`;
}

/** Garmin-style scale: equal-width bands in their tone, a marker at the value. */
function RatingBar({ r, large = false }: { r: Rating; large?: boolean }) {
  const n = r.bands.length;
  const pos = ((r.index + r.within) / n) * 100;
  return (
    <div>
      <div className="relative">
        <div className={`flex gap-0.5 ${large ? "h-2.5" : "h-1.5"}`}>
          {r.bands.map((b, i) => (
            <span key={i} className="flex-1 first:rounded-l-full last:rounded-r-full" style={{ background: TONE_COLOR[b.tone], opacity: i === r.index ? 1 : 0.4 }} />
          ))}
        </div>
        <span
          className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-foreground ${large ? "h-4 w-4" : "h-2.5 w-2.5"}`}
          style={{ left: `clamp(${large ? 8 : 5}px, ${pos}%, calc(100% - ${large ? 8 : 5}px))` }}
        />
      </div>
      {large && (
        <>
          <div className="mt-1.5 flex text-[10px] leading-tight text-muted-foreground">
            {r.bands.map((b, i) => (
              <span key={i} className={`flex-1 text-center ${i === r.index ? "font-semibold text-foreground" : ""}`}>
                {b.label}
              </span>
            ))}
          </div>
          <div className="relative mt-0.5 h-3 text-[10px] tabular-nums text-muted-foreground">
            {r.bands.slice(1).map((b, i) => (
              <span key={i} className="absolute -translate-x-1/2" style={{ left: `${((i + 1) / n) * 100}%` }}>
                {cut(b.edge ?? b.from!)}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const cut = (v: number) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10));

function BodyTile({ k, s, data, onOpen }: { k: BodyKey; s: BodySignal; data: OverviewData; onOpen: () => void }) {
  const c = BODY[k];
  const Icon = c.icon;
  const sub = tileSub(k, data);
  const r = ratingOf(k, s, data);
  const rated = r && !isGap(r) ? r : null;
  const band = rated?.bands[rated.index];
  return (
    <button onClick={onOpen} aria-haspopup="dialog" className="rounded-xl bg-background p-2.5 active:opacity-70 flex flex-col gap-1.5 min-h-[112px] text-left">
      <span className="flex items-start gap-1.5">
        <span aria-hidden className="inline-flex h-5 w-5 flex-none items-center justify-center rounded-full" style={{ background: `color-mix(in srgb, ${c.color} 20%, transparent)`, color: c.color }}>
          <Icon className="h-3 w-3" strokeWidth={2.5} />
        </span>
        <span className="text-[11px] text-muted-foreground leading-tight pt-0.5">
          {c.label}
          {sub && <span className="block text-[9px]">{sub}</span>}
        </span>
      </span>
      <span className="text-lg font-semibold leading-tight tabular-nums">
        {s.value !== null ? c.format(s.value) : "–"}
        {s.value !== null && c.unit && <span className="text-[11px] font-normal text-muted-foreground"> {c.unit}</span>}
      </span>
      <span className="mt-auto space-y-1">
        {rated && <RatingBar r={rated} />}
        <span className="block text-[10px] leading-tight">
          {band ? (
            <span className="font-semibold" style={{ color: TONE_COLOR[band.tone] }}>
              {band.label}
            </span>
          ) : (
            <span className="text-muted-foreground">{s.value === null ? "No recent value" : isGap(r) ? "Tap to compare" : normalText(s).replace(".", "")}</span>
          )}
          {band && s.state && s.state !== "within" && <span className="text-muted-foreground"> · {s.state} your normal</span>}
        </span>
      </span>
    </button>
  );
}

/** The tile's 90 days, with your normal as a band and the newest value marked. */
function TrendChart({ s, color }: { s: BodySignal; color: string }) {
  const w = 300;
  const h = 96;
  if (s.points.length < 2) return <p className="text-xs text-muted-foreground">Not enough days for a trend yet.</p>;
  const values = s.points.map((p) => p.value);
  const lo = Math.min(...values, ...(s.normal ? [s.normal[0]] : []));
  const hi = Math.max(...values, ...(s.normal ? [s.normal[1]] : []));
  const span = hi - lo || 1;
  const t0 = Date.parse(s.points[0].date);
  const t1 = Date.parse(s.points.at(-1)!.date);
  const x = (d: string) => (t1 === t0 ? w : ((Date.parse(d) - t0) / (t1 - t0)) * w);
  const y = (v: number) => h - 6 - ((v - lo) / span) * (h - 12);
  const last = s.points.at(-1)!;
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full" style={{ height: h }} role="img" aria-label={`From ${cut(lo)} to ${cut(hi)} over ${s.points.length} days.`}>
        {s.normal && <rect x={0} width={w} y={y(s.normal[1])} height={Math.max(1, y(s.normal[0]) - y(s.normal[1]))} fill={color} opacity={0.18} />}
        <polyline points={s.points.map((p) => `${x(p.date)},${y(p.value)}`).join(" ")} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
        <circle cx={x(last.date)} cy={y(last.value)} r={3.5} fill={color} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between text-[10px] text-muted-foreground tabular-nums">
        <span>{formatDateShort(s.points[0].date)}</span>
        <span>
          low {cut(Math.min(...values))} · high {cut(Math.max(...values))}
        </span>
        <span>{formatDateShort(last.date)}</span>
      </div>
    </div>
  );
}

function BodySheet({ k, data, onClose }: { k: BodyKey; data: OverviewData; onClose: () => void }) {
  const c = BODY[k];
  const s = data.body[k];
  const Icon = c.icon;
  const r = ratingOf(k, s, data);
  const rated = r && !isGap(r) ? r : null;
  const band = rated?.bands[rated.index];
  const nextUnit = k === "weight" ? (data.rating.bodyFat !== null && data.rating.sex ? " % body fat" : " BMI") : c.unit ? ` ${c.unit}` : "";
  return (
    <div className="mx-auto w-full max-w-lg rounded-t-3xl bg-card px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] max-h-[85vh] overflow-y-auto">
      <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-muted" aria-hidden />
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <span aria-hidden className="inline-flex h-8 w-8 items-center justify-center rounded-full" style={{ background: `color-mix(in srgb, ${c.color} 20%, transparent)`, color: c.color }}>
            <Icon className="h-4 w-4" strokeWidth={2.5} />
          </span>
          {c.label}
        </h2>
        <button onClick={onClose} aria-label="Close" className="flex h-11 w-11 items-center justify-center rounded-full active:bg-muted">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-4xl font-semibold tabular-nums">{s.value !== null ? c.format(s.value) : "–"}</span>
        {s.value !== null && c.unit && <span className="text-sm text-muted-foreground">{c.unit}</span>}
        {band && (
          <span className="ml-1 text-base font-semibold" style={{ color: TONE_COLOR[band.tone] }}>
            {band.label}
          </span>
        )}
      </div>
      {s.date && <p className="text-[11px] text-muted-foreground">{formatDateShort(s.date)}{tileSub(k, data) ? ` · ${tileSub(k, data)}` : ""}</p>}

      {rated && (
        <section className="mt-4 rounded-2xl bg-muted p-4 space-y-3" aria-label="How you compare">
          <RatingBar r={rated} large />
          <p className="text-sm leading-snug">{rated.compare}</p>
          {rated.next && (
            <p className="text-sm text-muted-foreground">
              <span style={{ color: TONE_COLOR[rated.bands[rated.bands.findIndex((b) => b.label === rated.next!.label)].tone] }} className="font-semibold">
                {rated.next.label}
              </span>{" "}
              is {cut(rated.next.gap)}
              {nextUnit} {rated.next.dir === "up" ? "higher" : "lower"}.
            </p>
          )}
          <p className="text-[11px] text-muted-foreground">Scale: {rated.source}.</p>
        </section>
      )}
      {isGap(r) && (
        <Link href="/more/account" className="mt-4 flex items-center justify-between gap-2 rounded-2xl bg-muted p-4 text-sm active:opacity-70">
          {NEEDS_TEXT[r.needs]}
          <ChevronRight className="h-4 w-4 flex-none text-muted-foreground" aria-hidden />
        </Link>
      )}

      <section className="mt-3 rounded-2xl bg-muted p-4 space-y-2" aria-label="Against your normal">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Against your normal · 90 days</h3>
        <p className="text-sm">{normalText(s)}</p>
        <TrendChart s={s} color={c.color} />
        {s.normal && (
          <p className="text-[11px] text-muted-foreground">
            The band is your normal: {cut(s.normal[0])} to {cut(s.normal[1])}
            {c.unit ? ` ${c.unit}` : ""}
            {k === "hrv" ? " (Garmin's baseline)" : ", the mean ± 1 SD of the 4 weeks before"}.
          </p>
        )}
      </section>

      <p className="mt-3 px-1 text-sm leading-snug text-muted-foreground">{c.about}</p>

      <Link href={c.href} replace scroll={false} onClick={onClose} className="mt-3 flex h-11 items-center justify-center gap-1 rounded-xl bg-muted text-sm font-medium active:opacity-70">
        Open {c.hrefLabel}
        <ChevronRight className="h-4 w-4" aria-hidden />
      </Link>
    </div>
  );
}

export function BodySignals({ data }: { data: OverviewData }) {
  // The key stays set while the sheet slides out, so it does not empty first.
  const [sheet, setSheet] = useState<{ key: BodyKey; open: boolean } | null>(null);
  const close = () => setSheet((v) => (v ? { ...v, open: false } : v));
  return (
    <section aria-label="Body signals" className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">Body · how you compare</p>
      <div className="grid grid-cols-3 gap-2">
        {(Object.keys(BODY) as BodyKey[]).map((k) => (
          <BodyTile key={k} k={k} s={data.body[k]} data={data} onOpen={() => setSheet({ key: k, open: true })} />
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground px-1">Each bar rates you on a published scale, like Garmin&apos;s VO2 max rating. Tap a tile for the scale, your trend and what it means.</p>
      <BottomSheet open={sheet?.open ?? false} onClose={close}>
        {sheet && <BodySheet k={sheet.key} data={data} onClose={close} />}
      </BottomSheet>
    </section>
  );
}
