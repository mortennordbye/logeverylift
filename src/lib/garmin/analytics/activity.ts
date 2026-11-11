/**
 * Metrics for one Garmin activity, stored in garmin_activity_metrics.
 * Pure: the worker passes the stored rows in.
 */

import { bandsFromStream, bandsFromZones, type Bands } from "./zones";
import { defaultZoneFloors, powerLoad, trimpLoad, zoneLoad, type LoadMethod } from "./load";
import { sportOf, type Sport } from "./sport";
import { sessionZoneMessage, snapshotZones, thresholdsFor, type Thresholds } from "./thresholds";

/** Bump when a formula here or in the models it uses changes; the worker recomputes every row. */
export const ACTIVITY_MODEL_VERSION = 1;

type Json = Record<string, unknown>;
type Streams = Partial<Record<string, (number | null)[]>>;

export type ActivityMetrics = {
  sport: Sport;
  load: number | null;
  loadMethod: LoadMethod;
  thresholds: Thresholds;
  bands: Bands;
  durationS: number | null;
  distanceM: number | null;
  avgHr: number | null;
  np: number | null;
  intensityFactor: number | null;
  /** UTC start and end in ms, for matching LogEveryLift sessions. */
  startMs: number | null;
  endMs: number | null;
};

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function hrZoneSeconds(summary: Json): (number | null)[] {
  return [1, 2, 3, 4, 5].map((z) => num(summary[`hrTimeInZone_${z}`]));
}

/** Zone floors in bpm: from the FIT message's zone high boundaries, else the snapshot, else % of max HR. */
function zoneFloors(timeInZone: unknown, snapshot: unknown, isBike: boolean, maxHr: number): number[] {
  const fit = sessionZoneMessage(timeInZone);
  const highs = Array.isArray(fit?.hrZoneHighBoundary) ? (fit.hrZoneHighBoundary as unknown[]).map(num) : [];
  // FIT boundaries: [zone0 top, zone1 top, ..., zone5 top]; zone N's floor is zone N-1's top.
  if (highs.length >= 6 && highs.every((h) => h !== null)) return (highs as number[]).slice(0, 5);
  const snap = snapshotZones(snapshot, isBike ? "CYCLING" : "DEFAULT");
  const floors = [1, 2, 3, 4, 5].map((z) => num(snap?.[`zone${z}Floor`]));
  if (floors.every((f) => f !== null)) return floors as number[];
  return defaultZoneFloors(maxHr);
}

export function computeActivityMetrics(input: {
  typeKey: string;
  summary: Json;
  streams: Streams | null;
  timeInZone: unknown;
  hrZonesSnapshot: unknown;
  female: boolean;
}): ActivityMetrics {
  const sport = sportOf(input.typeKey);
  const isBike = sport === "bike";
  const thresholds = thresholdsFor({ timeInZone: input.timeInZone, snapshot: input.hrZonesSnapshot, isBike });
  const s = input.summary;
  const startGmt = typeof s.startTimeGMT === "string" ? Date.parse(`${s.startTimeGMT.replace(" ", "T")}Z`) : NaN;
  const durationS = num(s.duration) ?? num(s.elapsedDuration);
  const t = input.streams?.t ?? null;
  const hr = input.streams?.hr ?? null;
  const power = input.streams?.power ?? null;

  let load: number | null = null;
  let loadMethod: LoadMethod = "none";
  let np: number | null = null;
  let intensityFactor: number | null = null;

  // Garmin's running FTP is running power, not a bike FTP, so power load is bikes only.
  if (isBike && t && power && thresholds.ftp) {
    const p = powerLoad(t, power, thresholds.ftp);
    if (p) {
      load = p.load;
      loadMethod = "power";
      np = p.np;
      intensityFactor = p.intensityFactor;
    }
  }

  const hrTh =
    thresholds.maxHr && thresholds.restHr && thresholds.lthr
      ? { maxHr: thresholds.maxHr, restHr: thresholds.restHr, lthr: thresholds.lthr, female: input.female }
      : null;
  if (load === null && hrTh && t && hr) {
    load = trimpLoad(t, hr, hrTh);
    if (load !== null) loadMethod = "trimp";
  }
  if (load === null && hrTh) {
    load = zoneLoad(hrZoneSeconds(s), zoneFloors(input.timeInZone, input.hrZonesSnapshot, isBike, hrTh.maxHr), hrTh);
    if (load !== null) loadMethod = "zones";
  }
  if (load === null && num(s.trainingStressScore)) {
    load = num(s.trainingStressScore);
    loadMethod = "garmin_tss";
  }
  const bands = t && hr && thresholds.lthr ? bandsFromStream(t, hr, thresholds.lthr) : bandsFromZones(hrZoneSeconds(s));

  return {
    sport,
    load: load !== null ? Math.round(load * 10) / 10 : null,
    loadMethod,
    thresholds,
    bands,
    durationS,
    distanceM: num(s.distance),
    avgHr: num(s.averageHR),
    np,
    intensityFactor,
    startMs: Number.isFinite(startGmt) ? startGmt : null,
    endMs: Number.isFinite(startGmt) && durationS ? startGmt + durationS * 1000 : null,
  };
}
