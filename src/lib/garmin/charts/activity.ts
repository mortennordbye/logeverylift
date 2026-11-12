/**
 * What the activity deep view shows (docs/plans/garmin-insights-design.md, 3.6),
 * derived from an ActivityDetail. Pure, so the verdict and the tables are tested.
 */

import type { Decoupling } from "../analytics/decoupling";
import { defaultZoneFloors } from "../analytics/load";
import { SPORT_LABEL } from "./theme";
import type { ActivityDetail } from "../queries";

type Json = Record<string, unknown>;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function durationLabel(seconds: number | null) {
  if (!seconds) return "–";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

/** m/s to "4:52" per km. */
export function paceLabel(mps: number | null) {
  if (!mps || mps <= 0) return "–";
  const secPerKm = 1000 / mps;
  return `${Math.floor(secPerKm / 60)}:${String(Math.round(secPerKm % 60)).padStart(2, "0")}`;
}

export type StatTile = { label: string; value: string };

/** A treadmill has no grade, so grade-adjusted pace equals pace there. */
const isIndoorRun = (typeKey: string) => typeKey === "treadmill_running" || typeKey === "indoor_running";

const BENEFIT_WORDS: Record<string, string> = { VO2MAX: "VO2 max", NO_BENEFIT: "" };

/** Garmin's primary training benefit ("AEROBIC_BASE") as words ("Aerobic base"); null when there is none. */
export function benefitLabel(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  const known = BENEFIT_WORDS[v];
  if (known !== undefined) return known || null;
  const words = v.toLowerCase().replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Garmin's "how did you feel" answer on the watch, stored as 0, 25, 50, 75 or 100. */
const FEEL = ["Very weak", "Weak", "Normal", "Strong", "Very strong"];

export function feelLabel(v: unknown): string | null {
  const n = num(v);
  return n === null ? null : (FEEL[Math.round(Math.min(100, Math.max(0, n)) / 25)] ?? null);
}

/** Garmin's split keys in the activity summary: the fastest time over each distance, in seconds. */
const SPLITS: { key: string; label: string; m: number }[] = [
  { key: "fastestSplit_100", label: "100 m", m: 100 },
  { key: "fastestSplit_400", label: "400 m", m: 400 },
  { key: "fastestSplit_750", label: "750 m", m: 750 },
  { key: "fastestSplit_1000", label: "1 km", m: 1000 },
  { key: "fastestSplit_1609", label: "1 mile", m: 1609 },
  { key: "fastestSplit_5000", label: "5 km", m: 5000 },
  { key: "fastestSplit_10000", label: "10 km", m: 10000 },
  { key: "fastestSplit_21098", label: "Half marathon", m: 21098 },
  { key: "fastestSplit_40000", label: "40 km", m: 40000 },
];

/** Garmin's fastest splits in this activity, shortest first, with the pace (s per km) each one means. */
export function fastestSplits(summary: Json): { label: string; seconds: number; secPerKm: number }[] {
  return SPLITS.flatMap((sp) => {
    const t = num(summary[sp.key]);
    return t && t > 0 ? [{ label: sp.label, seconds: t, secPerKm: (t / sp.m) * 1000 }] : [];
  });
}

export function statTiles(d: ActivityDetail): StatTile[] {
  const s = d.summary;
  const dto = d.dto ?? {};
  const pick = (key: string) => num(dto[key]) ?? num(s[key]);
  const tiles: StatTile[] = [{ label: "Duration", value: durationLabel(num(s.duration)) }];
  if (s.isPR === true) tiles.push({ label: "Garmin PR", value: "Personal record" });
  const moving = num(s.movingDuration);
  const total = num(s.duration);
  if (moving && total && total - moving >= 30) tiles.push({ label: "Moving time", value: `${durationLabel(moving)} of ${durationLabel(total)}` });
  const dist = num(s.distance);
  if (dist) tiles.push({ label: "Distance", value: `${(dist / 1000).toFixed(dist >= 10_000 ? 1 : 2)} km` });
  const speed = num(s.averageSpeed);
  if (speed && d.sport === "run") tiles.push({ label: "Pace", value: `${paceLabel(speed)} /km` });
  const gap = num(s.avgGradeAdjustedSpeed);
  if (gap && d.sport === "run" && !isIndoorRun(d.typeKey)) tiles.push({ label: "Grade-adjusted pace", value: `${paceLabel(gap)} /km` });
  if (speed && d.sport === "bike") tiles.push({ label: "Speed", value: `${(speed * 3.6).toFixed(1)} km/h` });
  if (speed && d.sport === "swim") tiles.push({ label: "Pace", value: `${durationLabel(100 / speed)} /100m` });
  if (num(s.averageHR)) tiles.push({ label: "Heart rate", value: `${Math.round(num(s.averageHR)!)} avg · ${Math.round(num(s.maxHR) ?? 0)} max` });
  if (num(s.normPower)) tiles.push({ label: "Power", value: `${Math.round(num(s.normPower)!)} W NP · ${Math.round(num(s.avgPower) ?? 0)} avg` });
  else if (num(s.avgPower)) tiles.push({ label: "Power", value: `${Math.round(num(s.avgPower)!)} W avg` });
  if (num(s.elevationGain)) {
    const loss = num(s.elevationLoss);
    const [lo, hi] = [num(s.minElevation), num(s.maxElevation)];
    tiles.push({ label: "Climb", value: `↑ ${Math.round(num(s.elevationGain)!)} m${loss ? ` · ↓ ${Math.round(loss)} m` : ""}${lo !== null && hi !== null ? ` · ${Math.round(lo)}–${Math.round(hi)} m high` : ""}` });
  }
  if (d.metrics?.load != null) tiles.push({ label: "Load", value: `${Math.round(d.metrics.load)} (${d.metrics.loadMethod === "power" ? "power" : d.metrics.loadMethod === "trimp" ? "HR" : d.metrics.loadMethod === "srpe" ? "RPE" : d.metrics.loadMethod})` });
  const garminLoad = num(s.activityTrainingLoad);
  if (garminLoad !== null) tiles.push({ label: "Garmin load", value: String(Math.round(garminLoad)) });
  if (num(s.aerobicTrainingEffect)) tiles.push({ label: "Training effect", value: `${num(s.aerobicTrainingEffect)!.toFixed(1)} aerobic · ${(num(s.anaerobicTrainingEffect) ?? 0).toFixed(1)} anaerobic` });
  const benefit = benefitLabel(s.trainingEffectLabel);
  if (benefit) tiles.push({ label: "Primary benefit", value: benefit });
  if (d.stamina) tiles.push({ label: "Stamina", value: `${d.stamina.start} → ${d.stamina.end} %${d.stamina.min !== null && d.stamina.min < d.stamina.end ? ` · ${d.stamina.min} % low` : ""}` });
  const bb = num(s.differenceBodyBattery);
  if (bb !== null) tiles.push({ label: "Body battery", value: `${bb > 0 ? "+" : ""}${Math.round(bb)}` });
  const recovery = num(dto.recoveryHeartRate);
  if (recovery !== null && recovery > 0) tiles.push({ label: "Recovery HR", value: `−${Math.round(recovery)} bpm in 2 min` });
  const breath = pick("avgRespirationRate");
  if (breath) tiles.push({ label: "Breathing", value: `${Math.round(breath)} avg · ${Math.round(pick("maxRespirationRate") ?? breath)} max /min` });
  const [tMin, tMax] = [pick("minTemperature"), pick("maxTemperature")];
  if (tMin !== null && tMax !== null) tiles.push({ label: "Temperature", value: `${Math.round(tMin)}–${Math.round(tMax)} °C at the watch` });
  const feel = feelLabel(dto.directWorkoutFeel);
  const rpe = num(dto.directWorkoutRpe);
  if (feel || rpe) tiles.push({ label: "How it felt", value: [feel, rpe ? `RPE ${Math.round(rpe / 10)}` : null].filter(Boolean).join(" · ") });
  const compliance = num(dto.directWorkoutComplianceScore);
  if (compliance !== null) tiles.push({ label: "Workout compliance", value: `${Math.round(compliance)} %` });
  if (num(s.calories)) tiles.push({ label: "Calories", value: `${Math.round(num(s.calories)!)} kcal` });
  return tiles;
}

/** One sentence that judges the session, from decoupling and intensity (3.6, item 1). */
export function verdict(d: ActivityDetail): string {
  const sport = SPORT_LABEL[d.sport].toLowerCase();
  const dec: Decoupling | null = d.metrics?.decoupling ?? null;
  const b = d.metrics?.bands;
  const total = b ? b.low + b.mid + b.high : 0;
  const lowShare = total > 0 ? b!.low / total : null;
  const highShare = total > 0 ? b!.high / total : null;
  const hours = ((num(d.summary.duration) ?? 0) / 3600).toFixed(1);
  if (dec?.valid) {
    const p = Math.round(dec.pct * 10) / 10;
    const heat = dec.temperature !== null && dec.temperature > 25 ? ` at ${Math.round(dec.temperature)} °C` : "";
    if (p < 5) return `Steady aerobic ${sport}. Decoupling ${p} %${heat}: your base holds for ${hours} h.`;
    if (p <= 8) return `Decoupling ${p} %${heat}: HR rose a little against output in the second half.`;
    return `HR drifted ${p} % against output in the second half${heat}. Check fuel, heat or pace.`;
  }
  if (highShare !== null && highShare > 0.15) return `Hard ${sport}: ${Math.round(highShare * 100)} % of the time above threshold.`;
  if (lowShare !== null && lowShare > 0.8) return `Easy ${sport}: ${Math.round(lowShare * 100)} % of the time in the low band.`;
  if (lowShare !== null) return `Mixed ${sport}: ${Math.round(lowShare * 100)} % low, ${Math.round(((b!.mid / total) * 100))} % mid, ${Math.round(highShare! * 100)} % high.`;
  return `${SPORT_LABEL[d.sport]} session.`;
}

/** Seconds in Garmin's five HR zones and seven power zones, from the summary. */
export function zoneSeconds(d: ActivityDetail) {
  const s = d.summary;
  return {
    hr: [1, 2, 3, 4, 5].map((z) => num(s[`hrTimeInZone_${z}`]) ?? 0),
    power: [1, 2, 3, 4, 5, 6, 7].map((z) => num(s[`powerTimeInZone_${z}`]) ?? 0),
  };
}

/** The HR zone (0 to 4) of each stream point, for colouring the route. Null without HR. */
export function pointZones(d: ActivityDetail): (number | null)[] {
  const hr = d.streams.hr ?? [];
  const maxHr = d.metrics?.thresholds.maxHr ?? 190;
  const floors = d.hrZoneFloors ?? defaultZoneFloors(maxHr);
  return hr.map((h) => {
    if (h === null) return null;
    let z = 0;
    for (let i = 1; i < 5; i++) if (h >= floors[i]) z = i;
    return z;
  });
}

export type StreamPanel = { key: string; label: string; unit: string; values: (number | null)[]; invert?: boolean; range: [number, number] | null };

/**
 * The y range from the 2nd to the 98th percentile of the non-zero values,
 * padded 8 %: a standing start, a stop or a GPS spike can't flatten the line.
 */
export function robustRange(values: (number | null)[]): [number, number] | null {
  const v = values.filter((x): x is number => x !== null && x > 0).sort((a, b) => a - b);
  if (v.length < 10) return null;
  const lo = v[Math.floor(v.length * 0.02)];
  const hi = v[Math.min(v.length - 1, Math.ceil(v.length * 0.98))];
  const pad = Math.max((hi - lo) * 0.08, 0.5);
  return [Math.max(0, lo - pad), hi + pad];
}

/** The stream charts to stack, in order, only those the file has. Runs show pace (min/km, faster up). */
export function streamPanels(d: ActivityDetail): StreamPanel[] {
  const s = d.streams;
  const out: StreamPanel[] = [];
  const has = (v: (number | null)[] | undefined) => !!v && v.some((x) => x !== null && x !== 0);
  const panel = (p: Omit<StreamPanel, "range">, robust = true): StreamPanel => ({ ...p, range: robust ? robustRange(p.values) : null });
  if (has(s.hr)) out.push(panel({ key: "hr", label: "Heart rate", unit: "bpm", values: s.hr! }));
  if (has(s.speed)) {
    if (d.sport === "run") out.push(panel({ key: "pace", label: "Pace", unit: "min/km", values: s.speed!.map((v) => (v && v > 0.5 ? Math.round((1000 / v / 60) * 100) / 100 : null)), invert: true }));
    else out.push(panel({ key: "speed", label: "Speed", unit: "km/h", values: s.speed!.map((v) => (v === null ? null : Math.round(v * 36) / 10)) }));
  }
  if (has(s.power)) out.push(panel({ key: "power", label: "Power", unit: "W", values: s.power! }));
  if (has(s.cadence)) out.push(panel({ key: "cadence", label: "Cadence", unit: d.sport === "run" ? "spm" : "rpm", values: d.sport === "run" ? s.cadence!.map((v) => (v === null ? null : v * 2)) : s.cadence! }));
  // Altitude keeps its full range: its extremes are the hills.
  if (has(s.altitude)) out.push(panel({ key: "altitude", label: "Altitude", unit: "m", values: s.altitude! }, false));
  return out;
}

export type LapRow = { n: number; durationS: number | null; distanceM: number | null; avgHr: number | null; avgPower: number | null; avgSpeed: number | null };

export function lapRows(d: ActivityDetail): LapRow[] {
  return d.laps.map((l: Json, i) => ({
    n: i + 1,
    durationS: num(l.totalTimerTime) ?? num(l.totalElapsedTime),
    distanceM: num(l.totalDistance),
    avgHr: num(l.avgHeartRate),
    avgPower: num(l.avgPower),
    avgSpeed: num(l.enhancedAvgSpeed) ?? num(l.avgSpeed),
  }));
}

export type SetRow = { n: number; reps: number | null; weightKg: number | null; durationS: number | null; restAfterS: number | null; startS: number | null };

/** Working sets with the rest that follows each, from the FIT set messages. startS is seconds from the activity start. */
export function setRows(d: ActivityDetail, activityStartMs: number | null): SetRow[] {
  const rows: SetRow[] = [];
  for (const s of d.sets) {
    const start = typeof s.startTime === "string" ? Date.parse(s.startTime) : null;
    if (s.setType === "active") {
      rows.push({
        n: rows.length + 1,
        reps: num(s.repetitions),
        weightKg: num(s.weight),
        durationS: num(s.duration),
        restAfterS: null,
        startS: start !== null && activityStartMs !== null ? (start - activityStartMs) / 1000 : null,
      });
    } else if (s.setType === "rest" && rows.length) {
      rows[rows.length - 1].restAfterS = num(s.duration);
    }
  }
  return rows;
}

export type SelectionStats = {
  durationS: number;
  distanceM: number | null;
  avgHr: number | null;
  avgPower: number | null;
  /** Mean moving speed, m/s: distance over time when the distance stream exists. */
  avgSpeed: number | null;
  climbM: number | null;
};

const mean = (xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x) && x > 0);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

/** Stats for the samples whose time (seconds from start) is inside [fromS, toS]. Null when fewer than 2 samples. */
export function selectionStats(d: ActivityDetail, fromS: number, toS: number): SelectionStats | null {
  const t = d.streams.t ?? [];
  const idx: number[] = [];
  for (let i = 0; i < t.length; i++) if (t[i] !== null && t[i]! >= fromS && t[i]! <= toS) idx.push(i);
  if (idx.length < 2) return null;
  const at = (k: string) => idx.map((i) => d.streams[k]?.[i] ?? null);
  const first = idx[0];
  const last = idx[idx.length - 1];
  const durationS = (t[last] ?? 0) - (t[first] ?? 0);
  const dist = d.streams.distance;
  const distanceM = dist && dist[first] !== null && dist[last] !== null ? dist[last]! - dist[first]! : null;
  let climbM: number | null = null;
  const alt = at("altitude").filter((v): v is number => v !== null);
  if (alt.length > 1) {
    // A 3 m deadband, as in decoupling.ts, so sensor noise does not count as climbing.
    climbM = 0;
    let ref = alt[0];
    for (const a of alt) {
      if (a - ref >= 3) {
        climbM += a - ref;
        ref = a;
      } else if (ref - a >= 3) ref = a;
    }
  }
  return {
    durationS,
    distanceM,
    avgHr: mean(at("hr")),
    avgPower: mean(at("power")),
    avgSpeed: distanceM !== null && durationS > 0 ? distanceM / durationS : mean(at("speed")),
    climbM,
  };
}

/** Each lap's span in stream seconds, from the lap start times and the activity start (UTC ms). */
export function lapSpans(d: ActivityDetail, activityStartMs: number | null): ([number, number] | null)[] {
  return d.laps.map((l: Json) => {
    const start = typeof l.startTime === "string" ? Date.parse(l.startTime) : NaN;
    const len = num(l.totalElapsedTime) ?? num(l.totalTimerTime);
    if (activityStartMs === null || !Number.isFinite(start) || len === null) return null;
    const from = (start - activityStartMs) / 1000;
    return [from, from + len];
  });
}
