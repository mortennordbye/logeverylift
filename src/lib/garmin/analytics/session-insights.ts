/**
 * Insights about sessions, thresholds and the race (plan 4.1, the eight rules
 * not in insights.ts): decoupling_good, decoupling_poor, new_best, ftp_stale,
 * lthr_gap, strength_before_key, long_gap and form_race. Pure; computed on
 * read. Same style as insights.ts: one fact and one action, numbers with
 * units, training framing only.
 */

import { addDays } from "../dates";
import type { DemandRow } from "./demands";
import type { Insight } from "./insights";
import { projectionSentence, type Projection } from "./projection";
import { curve, type TrendActivity } from "./trends";

// Thresholds, with their source.
/** Decoupling under this is a steady session (Friel; plan 2.7). */
const DECOUPLING_GOOD = 5;
/** Decoupling above this on a valid session is worth a look (plan 4.1). */
const DECOUPLING_POOR = 8;
/** How recent a session must be to raise a session insight, in days. */
const RECENT_DAYS = 3;
/** Window for "best in 90 days" and for a stale FTP (plan 2.8). */
const BEST_DAYS = 90;
/** A best within this share of the 90-day best counts as a fresh hard effort. */
const NEAR_BEST = 0.95;
/** Our LTHR against the watch's: a gap above this raises an insight (plan 2.8). */
const LTHR_GAP_BPM = 4;
/** Strength load the day before that counts as heavy. 40 is about an hour of hard lifting. */
const HEAVY_STRENGTH_LOAD = 40;
/** Weeks to the race inside which a missing long session is a warning. */
const LONG_GAP_WEEKS = 8;

const round = (n: number, d = 0) => Math.round(n * 10 ** d) / 10 ** d;
const hours = (min: number) => round(min / 60, 1);

export type SessionInsightInput = {
  today: string;
  acts: TrendActivity[];
  /** Run LTHR from hard 30 minute efforts (trends.ts) and the watch's. */
  lthrEstimate: number | null;
  watchLthr: number | null;
  /** Total strength load yesterday. */
  strengthYesterday: number | null;
  checklist: DemandRow[] | null;
  daysToRace: number | null;
  projection: Projection | null;
};

export function sessionInsights(input: SessionInsightInput): Insight[] {
  const { today, acts } = input;
  const out: Insight[] = [];
  const recentFrom = addDays(today, -(RECENT_DAYS - 1));

  // Decoupling: the newest valid steady session in the last few days.
  const steady = acts.filter((a) => (a.sport === "bike" || a.sport === "run") && a.decoupling?.valid);
  const latest = [...steady].reverse().find((a) => a.day >= recentFrom && a.day <= today);
  if (latest && latest.decoupling?.valid) {
    const d = latest.decoupling;
    const earlierLongest = Math.max(0, ...steady.filter((a) => a.sport === latest.sport && a.day < latest.day && a.decoupling?.valid).map((a) => (a.decoupling as { minutes: number }).minutes));
    const sport = latest.sport === "bike" ? "ride" : "run";
    if (d.pct < DECOUPLING_GOOD && d.minutes > earlierLongest) {
      out.push({
        id: "decoupling_good",
        severity: "good",
        text: `Longest ${sport} yet with steady heart rate against output: ${hours(d.minutes)} h at ${round(d.pct, 1)} % decoupling.`,
        numbers: { hours: hours(d.minutes), pct: round(d.pct, 1) },
        target: "trends",
        href: `/more/garmin/activity/${latest.id}`,
      });
    } else if (d.pct > DECOUPLING_POOR) {
      out.push({
        id: "decoupling_poor",
        severity: "caution",
        text: `Heart rate drifted ${round(d.pct, 1)} % in the second half of your ${sport}${d.temperature !== null ? ` at ${round(d.temperature)} °C` : ""}. Check fuel, heat or pace.`,
        numbers: { pct: round(d.pct, 1), ...(d.temperature !== null ? { temperature: round(d.temperature) } : {}) },
        target: "trends",
        href: `/more/garmin/activity/${latest.id}`,
      });
    }
  }

  // New 90-day bests at 5 and 20 minutes and an hour, set in the last few days.
  const bestFrom = addDays(today, -(BEST_DAYS - 1));
  for (const [kind, label, sport] of [
    ["power", "power", "bike"],
    ["speed", "run pace", "run"],
  ] as const) {
    const pool = acts.filter((a) => a.sport === sport);
    const now = curve(pool, kind, bestFrom, today);
    const before = curve(pool, kind, bestFrom, addDays(recentFrom, -1));
    for (const x of [1200, 300, 3600]) {
      const n = now.find((p) => p.x === x);
      const b = before.find((p) => p.x === x);
      if (!n || n.day < recentFrom || (b && n.value <= b.value)) continue;
      const value = kind === "power" ? `${Math.round(n.value)} W` : `${Math.floor(1000 / n.value / 60)}:${String(Math.round((1000 / n.value) % 60)).padStart(2, "0")}/km`;
      out.push({
        id: "new_best",
        severity: "good",
        text: `Best ${x === 3600 ? "1 h" : `${x / 60} min`} ${label} in 90 days: ${value}.`,
        numbers: { seconds: x, value: round(n.value, 2) },
        target: "trends",
        href: `/more/garmin/activity/${n.id}`,
      });
      break;
    }
  }

  // A stale FTP: power is recorded, but no 20 minute effort near the all-time best for 90 days.
  const powered = acts.filter((a) => a.sport === "bike" && a.efforts.power[1200]);
  if (powered.length) {
    const top = Math.max(...powered.map((a) => a.efforts.power[1200]));
    const lastHard = [...powered].reverse().find((a) => a.efforts.power[1200] >= NEAR_BEST * top);
    if (lastHard && lastHard.day < bestFrom) {
      out.push({
        id: "ftp_stale",
        severity: "info",
        text: `No hard 20 min ride since ${lastHard.day}. The FTP estimate may be off: test again.`,
        numbers: { best20: Math.round(top) },
        target: "trends",
      });
    }
  }

  // Our LTHR against the watch's.
  if (input.lthrEstimate !== null && input.watchLthr !== null && Math.abs(input.lthrEstimate - input.watchLthr) > LTHR_GAP_BPM) {
    out.push({
      id: "lthr_gap",
      severity: "info",
      text: `Your zones on the watch use LTHR ${Math.round(input.watchLthr)}. Recent hard runs point at ${Math.round(input.lthrEstimate)}.`,
      numbers: { watch: Math.round(input.watchLthr), estimate: Math.round(input.lthrEstimate) },
      target: "trends",
    });
  }

  // Heavy strength yesterday: today's quality session will feel it.
  if (input.strengthYesterday !== null && input.strengthYesterday >= HEAVY_STRENGTH_LOAD) {
    out.push({
      id: "strength_before_key",
      severity: "info",
      text: `Heavy strength session yesterday (load ${Math.round(input.strengthYesterday)}). Expect lower power and pace today; keep hard intervals for tomorrow.`,
      numbers: { load: Math.round(input.strengthYesterday) },
      target: "training",
    });
  }

  // Close to the race: long sessions still missing.
  if (input.checklist && input.daysToRace !== null && input.daysToRace >= 0 && input.daysToRace < LONG_GAP_WEEKS * 7) {
    const missing = input.checklist.filter((r) => (r.key === "bike" || r.key === "run" || r.key === "swim") && !r.met);
    if (missing.length) {
      const r = missing.sort((a, b) => a.progress - b.progress)[0];
      out.push({
        id: "long_gap",
        severity: "warning",
        text: `${Math.ceil(input.daysToRace / 7)} weeks to the race and your ${r.label.toLowerCase().replace(", 8 weeks", "")} is ${r.best} of ${r.target}.${r.next ? ` Next step: ${r.next}.` : ""}`,
        numbers: { weeks: Math.ceil(input.daysToRace / 7), progress: round(r.progress * 100) },
        target: "race",
      });
    }
  }

  // Race-day form off target.
  if (input.projection && input.projection.race.verdict !== "on_target") {
    out.push({
      id: "form_race",
      severity: "caution",
      text: projectionSentence(input.projection),
      numbers: { tsb: round(input.projection.race.tsb), dropPct: round(input.projection.race.dropPct) },
      target: "race",
    });
  }

  return out;
}
