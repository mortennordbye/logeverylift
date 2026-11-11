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

export function statTiles(d: ActivityDetail): StatTile[] {
  const s = d.summary;
  const tiles: StatTile[] = [{ label: "Duration", value: durationLabel(num(s.duration)) }];
  const dist = num(s.distance);
  if (dist) tiles.push({ label: "Distance", value: `${(dist / 1000).toFixed(dist >= 10_000 ? 1 : 2)} km` });
  const speed = num(s.averageSpeed);
  if (speed && d.sport === "run") tiles.push({ label: "Pace", value: `${paceLabel(speed)} /km` });
  if (speed && d.sport === "bike") tiles.push({ label: "Speed", value: `${(speed * 3.6).toFixed(1)} km/h` });
  if (speed && d.sport === "swim") tiles.push({ label: "Pace", value: `${durationLabel(100 / speed)} /100m` });
  if (num(s.averageHR)) tiles.push({ label: "Heart rate", value: `${Math.round(num(s.averageHR)!)} avg · ${Math.round(num(s.maxHR) ?? 0)} max` });
  if (num(s.normPower)) tiles.push({ label: "Power", value: `${Math.round(num(s.normPower)!)} W NP · ${Math.round(num(s.avgPower) ?? 0)} avg` });
  else if (num(s.avgPower)) tiles.push({ label: "Power", value: `${Math.round(num(s.avgPower)!)} W avg` });
  if (num(s.elevationGain)) tiles.push({ label: "Climb", value: `${Math.round(num(s.elevationGain)!)} m` });
  if (d.metrics?.load != null) tiles.push({ label: "Load", value: `${Math.round(d.metrics.load)} (${d.metrics.loadMethod === "power" ? "power" : d.metrics.loadMethod === "trimp" ? "HR" : d.metrics.loadMethod === "srpe" ? "RPE" : d.metrics.loadMethod})` });
  if (num(s.aerobicTrainingEffect)) tiles.push({ label: "Training effect", value: `${num(s.aerobicTrainingEffect)!.toFixed(1)} aerobic · ${(num(s.anaerobicTrainingEffect) ?? 0).toFixed(1)} anaerobic` });
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
