"use client";

import { BottomSheet } from "@/components/ui/BottomSheet";
import { changeOver, stageShares, type BodySignal } from "@/lib/garmin/analytics/overview";
import { isGap, rateSignal, type Rating, type RatingGap, type Tone } from "@/lib/garmin/analytics/norms";
import type { BodyKey, OverviewData } from "@/lib/garmin/queries";
import { formatDateShort } from "@/lib/utils/format";
import { Activity, Armchair, BatteryMedium, BedDouble, BedSingle, BicepsFlexed, Brain, ChevronRight, Droplet, Eye, Footprints, Gauge, Heart, HeartPulse, Hourglass, Moon, MoonStar, Scale, Sunrise, Wind, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { EChart } from "@/components/charts/EChart";
import { useVizTheme } from "@/components/charts/viz-theme";
import { Readout } from "@/components/features/garmin/GarminUi";
import { signalDays, signalOption } from "@/lib/garmin/charts/body";
import { useMemo, useState } from "react";

/**
 * The Overview's body signals, each in the view that suits it: arc gauges
 * (like Garmin's VO2 max) for ratings you build over weeks, with where you
 * were 4 weeks ago marked; trend tiles for signals that only mean something
 * against your own normal; one card for last night's sleep; a week of steps
 * against the goal; and rows with the 30-day change for slow body measures.
 * Every view opens a sheet with the scale, the 90-day trend and what it means.
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
  deepSleep: {
    label: "Deep sleep",
    unit: "%",
    format: (v) => String(Math.round(v)),
    href: tab("recovery"),
    hrefLabel: "Recovery",
    icon: MoonStar,
    color: "var(--viz-zone-3)",
    about: "Share of the night in deep sleep, when the body does most of its physical repair. Garmin sets an optimal range for each night.",
  },
  remSleep: {
    label: "REM sleep",
    unit: "%",
    format: (v) => String(Math.round(v)),
    href: tab("recovery"),
    hrefLabel: "Recovery",
    icon: Eye,
    color: "var(--viz-sleep-score)",
    about: "Share of the night in REM sleep, which matters most for memory and learning, skills included. Garmin sets an optimal range for each night.",
  },
  sleepStress: {
    label: "Sleep stress",
    unit: "",
    format: (v) => String(Math.round(v)),
    href: tab("recovery"),
    hrefLabel: "Recovery",
    icon: Activity,
    color: "var(--viz-serious)",
    about: "Garmin's stress level, from heart rate variability, averaged while you slept. Late hard sessions, alcohol, illness and a late meal often raise it.",
  },
  awakeCount: {
    label: "Awake periods",
    unit: "",
    format: (v) => String(Math.round(v)),
    href: tab("recovery"),
    hrefLabel: "Recovery",
    icon: Sunrise,
    color: "var(--viz-strength)",
    about: "How many times you woke in the night, as your watch saw it. Short wake-ups are normal; many of them break up deep and REM sleep.",
  },
  spo2: {
    label: "Blood oxygen",
    unit: "%",
    format: (v) => String(Math.round(v)),
    href: tab("day"),
    hrefLabel: "Day",
    icon: Droplet,
    color: "var(--viz-negative)",
    about: "Average blood oxygen while asleep, from your watch's pulse oximeter. It reads less exactly than a medical oximeter; a value that stays low is a reason to ask a doctor.",
  },
  sleepHr: {
    label: "Sleeping HR",
    unit: "bpm",
    format: (v) => String(Math.round(v)),
    href: tab("day"),
    hrefLabel: "Day",
    icon: BedSingle,
    color: "var(--viz-other)",
    about: "Average heart rate while asleep. It is compared only with your own normal: a night well above it often follows hard training, alcohol, heat or illness.",
  },
  steps: {
    label: "Steps",
    unit: "/day",
    format: (v) => Math.round(v).toLocaleString("en-GB"),
    href: tab("day"),
    hrefLabel: "Day",
    icon: Footprints,
    color: "var(--viz-run)",
    about: "Steps a day, averaged over the last 7 complete days. Daily movement outside training adds to recovery and health, not only to fitness.",
  },
  stress: {
    label: "Day stress",
    unit: "",
    format: (v) => String(Math.round(v)),
    href: tab("day"),
    hrefLabel: "Day",
    icon: Brain,
    color: "var(--viz-serious)",
    about: "Garmin's average stress level for your last complete day, from heart rate variability while you were not exercising.",
  },
  sedentary: {
    label: "Sitting time",
    unit: "h",
    format: (v) => v.toFixed(1),
    href: tab("day"),
    hrefLabel: "Day",
    icon: Armchair,
    color: "var(--viz-zone-2)",
    about: "Hours your watch counted as sedentary on your last complete day, sleep not included. Long unbroken sitting is a health risk of its own, even for people who train.",
  },
  muscleMass: {
    label: "Muscle mass",
    unit: "kg",
    format: (v) => v.toFixed(1),
    href: tab("trends"),
    hrefLabel: "Trends",
    icon: BicepsFlexed,
    color: "var(--viz-fitness-age)",
    about: "Skeletal muscle from your smart scale. A scale estimates it from electrical impedance, so watch the trend over weeks, not single readings.",
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


/** The small line under a signal's name. */
function tileSub(k: BodyKey, data: OverviewData): string | undefined {
  if (k === "vo2max") return `Garmin, ${data.vo2Sport === "run" ? "running" : "cycling"}`;
  if (k === "hrv") return data.rating.hrvBaseline ? `last night · 7 d ${data.rating.hrvBaseline.weeklyAvg}` : "last night";
  if (k === "weight" && data.rating.bodyFat !== null) return `${data.rating.bodyFat} % body fat`;
  if (k === "steps") return "7-day average";
  if (k === "stress" || k === "sedentary") return "last full day";
  return undefined;
}

function ratingOf(k: BodyKey, s: BodySignal, data: OverviewData): Rating | RatingGap | null {
  return s.value === null ? null : rateSignal(k, s.value, data.rating);
}

const rated = (r: Rating | RatingGap | null): Rating | null => (r && !isGap(r) ? r : null);
const bandOf = (r: Rating | null) => (r ? r.bands[r.index] : null);
/** Where a value sits along its scale, 0 to 1 (bands drawn equal width, like Garmin's). */
const position = (r: Rating) => (r.index + r.within) / r.bands.length;

function normalText(s: BodySignal): string {
  if (s.value === null) return "No recent value.";
  if (!s.normal) return "Still learning your normal: it needs 10 days in the 4 weeks before.";
  if (s.state === "within") return "Inside your normal.";
  return `${s.state === "below" ? "Below" : "Above"} your normal.`;
}

function shortNormal(s: BodySignal): string {
  if (s.value === null) return "No recent value";
  if (!s.normal) return "Learning your normal";
  return s.state === "within" ? "In your normal" : `${s.state === "below" ? "Below" : "Above"} your normal`;
}

const cut = (v: number) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10));

/** Nightly signals change too much night to night; their trend compares 7-day averages. */
const NIGHTLY = new Set<BodyKey>(["sleepScore", "bodyBattery"]);
const windowOf = (k: BodyKey) => (NIGHTLY.has(k) ? 7 : 1);

/** "↑ 0.4 in 4 wk" (or "7-day avg ↑ 3 in 4 wk"), or null without a value that far back. */
function changeText(k: BodyKey, s: BodySignal, days: number): string | null {
  const c = changeOver(s, days, windowOf(k));
  if (!c) return null;
  const f = BODY[k].format;
  const span = days === 28 ? "4 wk" : `${days} d`;
  const avg = windowOf(k) > 1 ? "7-day avg " : "";
  if (f(Math.abs(c.delta)) === f(0)) return `${avg}no change in ${span}`;
  return `${avg}${c.delta > 0 ? "↑" : "↓"} ${f(Math.abs(c.delta))}${BODY[k].unit && BODY[k].unit !== "/day" ? ` ${BODY[k].unit}` : ""} in ${span}`;
}

function Chip({ r, s }: { r: Rating | null; s: BodySignal }) {
  const b = bandOf(r);
  if (b) {
    return (
      <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none" style={{ background: `color-mix(in srgb, ${TONE_COLOR[b.tone]} 20%, transparent)`, color: TONE_COLOR[b.tone] }}>
        {b.label}
      </span>
    );
  }
  return <span className="text-[10px] text-muted-foreground">{shortNormal(s)}</span>;
}

function IconDot({ k, size = "sm" }: { k: BodyKey; size?: "sm" | "lg" }) {
  const c = BODY[k];
  const Icon = c.icon;
  return (
    <span aria-hidden className={`inline-flex flex-none items-center justify-center rounded-full ${size === "lg" ? "h-8 w-8" : "h-5 w-5"}`} style={{ background: `color-mix(in srgb, ${c.color} 20%, transparent)`, color: c.color }}>
      <Icon className={size === "lg" ? "h-4 w-4" : "h-3 w-3"} strokeWidth={2.5} />
    </span>
  );
}

// ── Arc gauge ───────────────────────────────────────────────────────────────

const ARC_START = 135;
const ARC_SWEEP = 270;
const polar = (r: number, deg: number) => {
  const a = (deg * Math.PI) / 180;
  return [100 + r * Math.cos(a), 100 + r * Math.sin(a)] as const;
};
function arc(r: number, a0: number, a1: number) {
  const [x0, y0] = polar(r, a0);
  const [x1, y1] = polar(r, a1);
  return `M ${x0} ${y0} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`;
}

/**
 * Garmin-style arc: each band a coloured segment, a dot at the value and the
 * value and band in the middle. The hollow ring is where you were 4 weeks ago.
 */
function ArcGauge({ r, value, prev, large = false }: { r: Rating; value: string; prev: Rating | null; large?: boolean }) {
  const n = r.bands.length;
  const gap = 3;
  const seg = ARC_SWEEP / n;
  const at = (f: number) => ARC_START + ARC_SWEEP * Math.min(1, Math.max(0, f));
  const [mx, my] = polar(78, at(position(r)));
  const b = r.bands[r.index];
  const p = prev ? polar(78, at(position(prev))) : null;
  return (
    <svg viewBox="0 0 200 172" className={large ? "mx-auto w-56" : "w-full"} role="img" aria-label={`${value}, ${b.label}`}>
      {r.bands.map((band, i) => (
        <path key={i} d={arc(78, ARC_START + i * seg + (i ? gap / 2 : 0), ARC_START + (i + 1) * seg - (i < n - 1 ? gap / 2 : 0))} fill="none" stroke={TONE_COLOR[band.tone]} strokeWidth={large ? 10 : 12} strokeLinecap="round" opacity={i === r.index ? 1 : 0.55} />
      ))}
      {p && <circle cx={p[0]} cy={p[1]} r={7} fill="none" stroke="var(--foreground)" strokeWidth={2.5} opacity={0.7} />}
      <circle cx={mx} cy={my} r={11} fill={TONE_COLOR[b.tone]} stroke="var(--background)" strokeWidth={4} />
      <text x={100} y={large ? 104 : 106} textAnchor="middle" className="fill-foreground tabular-nums" style={{ fontSize: large ? 46 : 50, fontWeight: 600 }}>
        {value}
      </text>
      <text x={100} y={large ? 132 : 138} textAnchor="middle" style={{ fontSize: (large ? 17 : 20) * (b.label.length > 9 ? 0.75 : 1), fontWeight: 600, fill: TONE_COLOR[b.tone] }}>
        {b.label}
      </text>
    </svg>
  );
}

/** Where you were 4 weeks ago (a 7-day average for nightly signals), rated on the same scale, for the gauge's hollow ring. */
function prevRating(k: BodyKey, data: OverviewData): Rating | null {
  const c = changeOver(data.body[k], 28, windowOf(k));
  return c ? rated(rateSignal(k, c.then, data.rating)) : null;
}

function GaugeTile({ k, data, onOpen }: { k: BodyKey; data: OverviewData; onOpen: (k: BodyKey) => void }) {
  const c = BODY[k];
  const s = data.body[k];
  const raw = ratingOf(k, s, data);
  const r = rated(raw);
  const sub = tileSub(k, data);
  const change = changeText(k, s, 28);
  return (
    <button onClick={() => onOpen(k)} aria-haspopup="dialog" aria-label={`${c.label}${s.value !== null ? ` ${c.format(s.value)}` : ""}`} className="rounded-2xl bg-muted p-3 text-left active:opacity-70 flex flex-col">
      <span className="flex items-start gap-1.5">
        <IconDot k={k} />
        <span className="text-xs text-muted-foreground leading-tight pt-0.5">
          {c.label}
          {sub && <span className="block text-[10px]">{sub}</span>}
        </span>
      </span>
      {r && s.value !== null ? (
        <span className="mt-1 block px-2">
          <ArcGauge r={r} value={c.format(s.value)} prev={prevRating(k, data)} />
        </span>
      ) : (
        <span className="flex flex-1 flex-col items-center justify-center py-6 text-center">
          <span className="text-3xl font-semibold tabular-nums">{s.value !== null ? c.format(s.value) : "–"}</span>
          <span className="mt-1 text-[11px] text-muted-foreground">{isGap(raw) ? "Tap to compare" : shortNormal(s)}</span>
        </span>
      )}
      <span className="-mt-1 block text-center text-[11px] text-muted-foreground tabular-nums">{change ?? " "}</span>
    </button>
  );
}

// ── Trend tile ──────────────────────────────────────────────────────────────

function Spark({ s, color }: { s: BodySignal; color: string }) {
  const w = 100;
  const h = 30;
  const pts = s.points.slice(-28);
  if (pts.length < 2) return <div style={{ height: h }} />;
  const values = pts.map((p) => p.value);
  const lo = Math.min(...values, ...(s.normal ? [s.normal[0]] : []));
  const hi = Math.max(...values, ...(s.normal ? [s.normal[1]] : []));
  const span = hi - lo || 1;
  const t0 = Date.parse(pts[0].date);
  const t1 = Date.parse(pts.at(-1)!.date);
  const x = (d: string) => (t1 === t0 ? w : ((Date.parse(d) - t0) / (t1 - t0)) * w);
  const y = (v: number) => h - 3 - ((v - lo) / span) * (h - 6);
  const last = pts.at(-1)!;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full" style={{ height: h }} aria-hidden>
      {s.normal && <rect x={0} width={w} y={y(s.normal[1])} height={Math.max(1, y(s.normal[0]) - y(s.normal[1]))} fill={color} opacity={0.18} />}
      <polyline points={pts.map((p) => `${x(p.date)},${y(p.value)}`).join(" ")} fill="none" stroke={color} strokeWidth={1.75} vectorEffect="non-scaling-stroke" />
      <circle cx={x(last.date)} cy={y(last.value)} r={2.5} fill={color} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function TrendTile({ k, data, onOpen }: { k: BodyKey; data: OverviewData; onOpen: (k: BodyKey) => void }) {
  const c = BODY[k];
  const s = data.body[k];
  const r = rated(ratingOf(k, s, data));
  const sub = tileSub(k, data);
  return (
    <button onClick={() => onOpen(k)} aria-haspopup="dialog" aria-label={`${c.label}${s.value !== null ? ` ${c.format(s.value)}` : ""}`} className="rounded-2xl bg-muted p-3 text-left active:opacity-70 flex flex-col gap-1.5">
      <span className="flex items-start gap-1.5">
        <IconDot k={k} />
        <span className="text-xs text-muted-foreground leading-tight pt-0.5">
          {c.label}
          {sub && <span className="block text-[10px]">{sub}</span>}
        </span>
      </span>
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-2xl font-semibold leading-none tabular-nums">
          {s.value !== null ? c.format(s.value) : "–"}
          {s.value !== null && c.unit && <span className="text-xs font-normal text-muted-foreground"> {c.unit}</span>}
        </span>
        <Chip r={r} s={s} />
      </span>
      <Spark s={s} color={c.color} />
      <span className="text-[10px] text-muted-foreground">{r && s.state && s.state !== "within" ? `${shortNormal(s)} · 4 wk` : "Last 4 weeks, band is your normal"}</span>
    </button>
  );
}

// ── Last night ──────────────────────────────────────────────────────────────

const STAGES = [
  { key: "deep", label: "Deep", color: "var(--viz-zone-4)", signal: "deepSleep" },
  { key: "light", label: "Light", color: "var(--viz-zone-2)", signal: null },
  { key: "rem", label: "REM", color: "var(--viz-sleep-score)", signal: "remSleep" },
] as const;

const hm = (s: number) => {
  const m = Math.round(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}` : `${m} min`;
};

function NightCard({ data, onOpen }: { data: OverviewData; onOpen: (k: BodyKey) => void }) {
  const n = data.night;
  const sleep = data.body.sleep;
  const sleepR = rated(ratingOf("sleep", sleep, data));
  const shares = n ? stageShares(n) : null;
  const total = n ? n.deepS + n.lightS + n.remS + n.awakeS : 0;
  return (
    <section className="rounded-2xl bg-muted p-4 space-y-3" aria-label="Last night">
      <button onClick={() => onOpen("sleep")} aria-haspopup="dialog" aria-label={`Sleep ${sleep.value !== null ? BODY.sleep.format(sleep.value) : ""} h`} className="flex w-full items-center justify-between gap-2 text-left active:opacity-70">
        <span className="flex items-center gap-2">
          <IconDot k="sleep" size="lg" />
          <span>
            <span className="block text-xs text-muted-foreground">{n ? `Night to ${formatDateShort(n.date)}` : "Last night"}</span>
            <span className="text-2xl font-semibold tabular-nums">{sleep.value !== null ? `${BODY.sleep.format(sleep.value)} h` : "–"}</span>
          </span>
        </span>
        <Chip r={sleepR} s={sleep} />
      </button>

      {n && shares && total > 0 && (
        <>
          <div className="flex h-3 overflow-hidden rounded-full" role="img" aria-label={`Deep ${shares.deep} %, light ${shares.light} %, REM ${shares.rem} %, awake ${hm(n.awakeS)}.`}>
            {STAGES.map((st) => (
              <span key={st.key} style={{ width: `${(n[`${st.key}S`] / total) * 100}%`, background: st.color }} />
            ))}
            <span style={{ width: `${(n.awakeS / total) * 100}%`, background: "var(--viz-warning)" }} />
          </div>
          <ul className="space-y-2">
            {STAGES.map((st) => {
              const share = shares[st.key];
              const opt = n.optimal[st.key];
              const inside = opt ? share >= opt[0] && share <= opt[1] : null;
              const row = (
                <>
                  <span className="flex items-center gap-1.5 text-sm">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: st.color }} aria-hidden />
                    {st.label}
                  </span>
                  <span className="relative h-2 rounded-full bg-background" aria-hidden>
                    {opt && <span className="absolute inset-y-0 rounded-full" style={{ left: `${opt[0]}%`, width: `${opt[1] - opt[0]}%`, background: "color-mix(in srgb, var(--viz-good) 35%, transparent)" }} />}
                    <span className="absolute top-1/2 h-3 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: `${share}%`, background: inside === false ? "var(--viz-serious)" : "var(--foreground)" }} />
                  </span>
                  <span className="text-right text-xs tabular-nums">
                    {share} % <span className="text-muted-foreground">· {hm(n[`${st.key}S`])}</span>
                  </span>
                </>
              );
              const cls = "grid w-full grid-cols-[4.5rem_1fr_6.5rem] items-center gap-2 text-left";
              return (
                <li key={st.key}>
                  {st.signal ? (
                    <button onClick={() => onOpen(st.signal)} aria-haspopup="dialog" aria-label={`${st.label} sleep ${share} %`} className={`${cls} active:opacity-70`}>
                      {row}
                    </button>
                  ) : (
                    <div className={cls}>{row}</div>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="text-[10px] text-muted-foreground">Green is Garmin&apos;s optimal share for the night. Awake {hm(n.awakeS)}.</p>
        </>
      )}

      <div className="grid grid-cols-3 gap-2">
        <AwakeStat data={data} onOpen={onOpen} />
        <MiniStat k="sleepStress" data={data} onOpen={onOpen} />
        <MiniStat k="spo2" data={data} onOpen={onOpen} />
      </div>
    </section>
  );
}

function MiniStat({ k, data, onOpen }: { k: BodyKey; data: OverviewData; onOpen: (k: BodyKey) => void }) {
  const c = BODY[k];
  const s = data.body[k];
  const r = rated(ratingOf(k, s, data));
  return (
    <button onClick={() => onOpen(k)} aria-haspopup="dialog" aria-label={`${c.label}${s.value !== null ? ` ${c.format(s.value)}` : ""}`} className="rounded-xl bg-background p-2.5 text-left active:opacity-70 space-y-1">
      <span className="block text-[11px] text-muted-foreground leading-tight">{c.label}</span>
      <span className="block text-lg font-semibold leading-none tabular-nums">
        {s.value !== null ? c.format(s.value) : "–"}
        {s.value !== null && c.unit && <span className="text-[11px] font-normal text-muted-foreground"> {c.unit}</span>}
      </span>
      <Chip r={r} s={s} />
    </button>
  );
}

/** Wake-ups as dots, filled up to Garmin's optimal count in green. */
function AwakeStat({ data, onOpen }: { data: OverviewData; onOpen: (k: BodyKey) => void }) {
  const s = data.body.awakeCount;
  const max = data.rating.sleepRanges?.awakeMax ?? null;
  const r = rated(ratingOf("awakeCount", s, data));
  const count = s.value ?? 0;
  return (
    <button onClick={() => onOpen("awakeCount")} aria-haspopup="dialog" aria-label={`Awake periods ${s.value ?? "none"}`} className="rounded-xl bg-background p-2.5 text-left active:opacity-70 space-y-1">
      <span className="block text-[11px] text-muted-foreground leading-tight">Awake periods</span>
      <span className="flex items-center gap-1 h-[18px]" aria-hidden>
        {s.value === null
          ? "–"
          : Array.from({ length: Math.max(count, (max ?? 0) + 1, 1) }, (_, i) => (
              <span key={i} className="h-2.5 w-2.5 rounded-full" style={i < count ? { background: max !== null && i >= max ? "var(--viz-serious)" : "var(--viz-good)" } : { border: "1.5px solid var(--muted-foreground)", opacity: 0.5 }} />
            ))}
      </span>
      <Chip r={r} s={s} />
    </button>
  );
}

// ── Day to day ──────────────────────────────────────────────────────────────

function StepsCard({ data, onOpen }: { data: OverviewData; onOpen: (k: BodyKey) => void }) {
  const s = data.body.steps;
  const r = rated(ratingOf("steps", s, data));
  const goal = data.stepGoal;
  const max = Math.max(goal ?? 0, ...data.stepsWeek.map((d) => d.steps ?? 0), 1);
  const h = 72;
  return (
    <button onClick={() => onOpen("steps")} aria-haspopup="dialog" aria-label={`Steps ${s.value !== null ? BODY.steps.format(s.value) : ""} a day`} className="w-full rounded-2xl bg-muted p-4 text-left active:opacity-70 space-y-3">
      <span className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <IconDot k="steps" size="lg" />
          <span>
            <span className="block text-xs text-muted-foreground">Steps · 7-day average</span>
            <span className="text-2xl font-semibold tabular-nums">{s.value !== null ? BODY.steps.format(s.value) : "–"}</span>
          </span>
        </span>
        <Chip r={r} s={s} />
      </span>
      <span className="relative block" style={{ height: h }}>
        {goal && (
          <span className="absolute inset-x-0 border-t border-dashed border-muted-foreground/60" style={{ bottom: (goal / max) * h }} aria-hidden>
            <span className="absolute right-0 -top-4 text-[10px] text-muted-foreground tabular-nums">goal {BODY.steps.format(goal)}</span>
          </span>
        )}
        <span className="absolute inset-0 grid grid-cols-7 items-end gap-1.5" aria-hidden>
          {data.stepsWeek.map((d) => (
            <span key={d.date} className="rounded-t-md" style={{ height: d.steps ? Math.max(3, (d.steps / max) * h) : 3, background: d.steps && goal && d.steps >= goal ? "var(--viz-good)" : d.steps ? BODY.steps.color : "var(--border)", opacity: d.steps ? 1 : 0.6 }} />
          ))}
        </span>
      </span>
      <span className="grid grid-cols-7 gap-1.5 text-center text-[10px] text-muted-foreground" aria-hidden>
        {data.stepsWeek.map((d) => (
          <span key={d.date}>{new Date(`${d.date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "narrow", timeZone: "UTC" })}</span>
        ))}
      </span>
    </button>
  );
}

function StatRow({ k, data, onOpen }: { k: BodyKey; data: OverviewData; onOpen: (k: BodyKey) => void }) {
  const c = BODY[k];
  const s = data.body[k];
  const r = rated(ratingOf(k, s, data));
  const sub = tileSub(k, data);
  const change = changeText(k, s, 30);
  return (
    <button onClick={() => onOpen(k)} aria-haspopup="dialog" aria-label={`${c.label}${s.value !== null ? ` ${c.format(s.value)}` : ""}`} className="flex min-h-[56px] w-full items-center gap-3 px-3 py-2 text-left active:bg-background/50">
      <IconDot k={k} size="lg" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm">{c.label}</span>
        <span className="block text-[11px] text-muted-foreground">{sub ?? (change ? "last 30 days" : shortNormal(s))}</span>
      </span>
      <span className="text-right">
        <span className="block text-base font-semibold tabular-nums">
          {s.value !== null ? c.format(s.value) : "–"}
          {s.value !== null && c.unit && <span className="text-[11px] font-normal text-muted-foreground"> {c.unit}</span>}
        </span>
        <span className="block text-[11px] text-muted-foreground tabular-nums">{r ? <Chip r={r} s={s} /> : change ?? shortNormal(s)}</span>
      </span>
      <ChevronRight className="h-4 w-4 flex-none text-muted-foreground" aria-hidden />
    </button>
  );
}

// ── Sheet ───────────────────────────────────────────────────────────────────

/** Resolve a CSS colour variable for the canvas chart, which cannot read var(). */
function cssColor(v: string): string {
  const name = v.match(/^var\((--[\w-]+)\)$/)?.[1];
  return name ? getComputedStyle(document.documentElement).getPropertyValue(name).trim() || v : v;
}

/** The 90 days with axes; drag across it to read any day in the row above. */
function SignalChart({ s, k }: { s: BodySignal; k: BodyKey }) {
  const c = BODY[k];
  const theme = useVizTheme();
  const days = useMemo(() => signalDays(s), [s]);
  const option = useMemo(() => (theme ? signalOption(days, s.normal, cssColor(c.color), theme) : null), [theme, days, s.normal, c.color]);
  const [idx, setIdx] = useState<number | null>(null);
  if (days.dates.length < 2) return <p className="text-xs text-muted-foreground">Not enough days for a trend yet.</p>;
  // With no finger on the chart, the readout shows the newest day.
  const i = idx ?? days.dates.length - 1;
  const unit = c.unit && c.unit !== "/day" ? ` ${c.unit}` : "";
  const v = days.values[i];
  const m = days.mean7?.[i] ?? null;
  return (
    <div>
      <Readout
        title={`${formatDateShort(days.dates[i])}${idx === null ? " · drag the chart to read a day" : ""}`}
        values={[
          { label: unit.trim() || c.label.toLowerCase(), value: v !== null ? c.format(v) : "–" },
          ...(days.mean7 ? [{ label: "7-day mean", value: m !== null ? c.format(m) : "–" }] : []),
        ]}
      />
      {option && <EChart option={option} height={170} onIndex={setIdx} ariaLabel={`${c.label} over ${days.dates.length} days. Drag to read a day.`} />}
    </div>
  );
}

/** The bands as a legend: name and range, the user's band marked. */
function BandLegend({ r, unit }: { r: Rating; unit: string }) {
  const range = (i: number) => {
    const b = r.bands[i];
    const from = b.from === null ? null : cut(b.edge ?? b.from);
    const next = r.bands[i + 1];
    const to = next ? cut(next.edge ?? next.from!) : null;
    return from === null ? `under ${to}` : to === null ? `${from}+` : `${from}–${to}`;
  };
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
      {r.bands.map((b, i) => (
        <li key={i} className={`flex items-center gap-1.5 ${i === r.index ? "font-semibold" : "text-muted-foreground"}`}>
          <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: TONE_COLOR[b.tone] }} aria-hidden />
          <span className="truncate">{b.label}</span>
          <span className="ml-auto tabular-nums">
            {range(i)}
            {unit}
          </span>
        </li>
      ))}
    </ul>
  );
}

function BodySheet({ k, data, onClose }: { k: BodyKey; data: OverviewData; onClose: () => void }) {
  const c = BODY[k];
  const s = data.body[k];
  const raw = ratingOf(k, s, data);
  const r = rated(raw);
  const band = bandOf(r);
  const ratedOn = k === "weight" ? (data.rating.bodyFat !== null && data.rating.sex ? " %" : "") : k === "hrv" ? " ms" : c.unit === "%" ? " %" : "";
  const nextUnit = k === "weight" ? (data.rating.bodyFat !== null && data.rating.sex ? " % body fat" : " BMI") : k === "steps" ? " steps a day" : c.unit ? ` ${c.unit}` : "";
  const change = changeText(k, s, 28);
  return (
    <div className="mx-auto w-full max-w-lg rounded-t-3xl bg-card px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] max-h-[85vh] overflow-y-auto">
      <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-muted" aria-hidden />
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <IconDot k={k} size="lg" />
          {c.label}
        </h2>
        <button onClick={onClose} aria-label="Close" className="flex h-11 w-11 items-center justify-center rounded-full active:bg-muted">
          <X className="h-5 w-5" />
        </button>
      </div>
      {s.date && (
        <p className="px-1 text-[11px] text-muted-foreground">
          {formatDateShort(s.date)}
          {tileSub(k, data) ? ` · ${tileSub(k, data)}` : ""}
        </p>
      )}

      {r && s.value !== null ? (
        <section className="mt-3 rounded-2xl bg-muted p-4 space-y-3" aria-label="How you compare">
          <ArcGauge r={r} value={c.format(s.value)} prev={prevRating(k, data)} large />
          {change && <p className="text-center text-xs text-muted-foreground tabular-nums">{change}{prevRating(k, data) ? " · the ring is 4 weeks ago" : ""}</p>}
          <p className="text-sm leading-snug text-center">{r.compare}</p>
          {r.next && (
            <p className="text-sm text-muted-foreground text-center">
              <span style={{ color: TONE_COLOR[r.bands.find((b) => b.label === r.next!.label)!.tone] }} className="font-semibold">
                {r.next.label}
              </span>{" "}
              is {cut(r.next.gap)}
              {nextUnit} {r.next.dir === "up" ? "higher" : "lower"}.
            </p>
          )}
          <BandLegend r={r} unit={ratedOn} />
          <p className="text-[11px] text-muted-foreground">Scale: {r.source}.</p>
        </section>
      ) : (
        <div className="mt-2 flex items-baseline gap-2 px-1">
          <span className="text-4xl font-semibold tabular-nums">{s.value !== null ? c.format(s.value) : "–"}</span>
          {s.value !== null && c.unit && <span className="text-sm text-muted-foreground">{c.unit}</span>}
          {band && <span className="ml-1 text-base font-semibold">{band.label}</span>}
        </div>
      )}
      {isGap(raw) && (
        <Link href="/more/account" className="mt-3 flex items-center justify-between gap-2 rounded-2xl bg-muted p-4 text-sm active:opacity-70">
          {NEEDS_TEXT[raw.needs]}
          <ChevronRight className="h-4 w-4 flex-none text-muted-foreground" aria-hidden />
        </Link>
      )}

      <section className="mt-3 rounded-2xl bg-muted p-4 space-y-2" aria-label="Against your normal">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Against your normal · 90 days</h3>
        <p className="text-sm">{normalText(s)}</p>
        <SignalChart s={s} k={k} />
        {s.normal && (
          <p className="text-[11px] text-muted-foreground">
            The band is your normal: {c.format(s.normal[0])} to {c.format(s.normal[1])}
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

// ── The whole block ─────────────────────────────────────────────────────────

function Title({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">{children}</h2>;
}

export function BodyOverview({ data }: { data: OverviewData }) {
  // The key stays set while the sheet slides out, so it does not empty first.
  const [sheet, setSheet] = useState<{ key: BodyKey; open: boolean } | null>(null);
  const open = (key: BodyKey) => setSheet({ key, open: true });
  const close = () => setSheet((v) => (v ? { ...v, open: false } : v));
  return (
    <div className="space-y-4">
      <section aria-label="Fitness" className="space-y-2">
        <Title>Fitness · how you compare</Title>
        <div className="grid grid-cols-2 gap-2">
          <GaugeTile k="vo2max" data={data} onOpen={open} />
          <GaugeTile k="fitnessAge" data={data} onOpen={open} />
        </div>
      </section>

      <section aria-label="Recovery" className="space-y-2">
        <Title>Recovery</Title>
        <div className="grid grid-cols-2 gap-2">
          <GaugeTile k="sleepScore" data={data} onOpen={open} />
          <GaugeTile k="bodyBattery" data={data} onOpen={open} />
          <TrendTile k="hrv" data={data} onOpen={open} />
          <TrendTile k="restingHr" data={data} onOpen={open} />
          <TrendTile k="respiration" data={data} onOpen={open} />
          <TrendTile k="sleepHr" data={data} onOpen={open} />
        </div>
      </section>

      <section className="space-y-2">
        <Title>Last night</Title>
        <NightCard data={data} onOpen={open} />
      </section>

      <section aria-label="Day to day" className="space-y-2">
        <Title>Day to day</Title>
        <StepsCard data={data} onOpen={open} />
        <div className="rounded-2xl bg-muted divide-y divide-border overflow-hidden">
          <StatRow k="stress" data={data} onOpen={open} />
          <StatRow k="sedentary" data={data} onOpen={open} />
          <StatRow k="weight" data={data} onOpen={open} />
          <StatRow k="muscleMass" data={data} onOpen={open} />
        </div>
      </section>

      <p className="text-[11px] text-muted-foreground px-1">
        Gauges and coloured labels rate you on a published scale; the hollow ring is where you were 4 weeks ago. Signals without a fair population scale are shown against your own normal. Tap anything for the scale, your trend and what it means.
      </p>

      <BottomSheet open={sheet?.open ?? false} onClose={close}>
        {sheet && <BodySheet k={sheet.key} data={data} onClose={close} />}
      </BottomSheet>
    </div>
  );
}
