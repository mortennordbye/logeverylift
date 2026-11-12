import { disciplineConfig, type Discipline } from "@/lib/utils/discipline";
import { DEFAULT_UNITS, METERS_PER_MILE, METERS_PER_YARD, type Units } from "@/lib/utils/units";
import type { ProgramSet } from "@/types/workout";

/** Normalize a locale decimal separator (comma) to a period. */
export function normalizeDecimal(raw: string): string {
  return raw.replace(/,/g, ".");
}

/**
 * Sanitize free-text decimal input: accept commas (comma-locale keyboards),
 * keep digits and a single decimal point, drop everything else.
 */
export function sanitizeDecimalInput(raw: string): string {
  const s = normalizeDecimal(raw).replace(/[^\d.]/g, "");
  const first = s.indexOf(".");
  if (first === -1) return s;
  return s.slice(0, first + 1) + s.slice(first + 1).replace(/\./g, "");
}

export function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const s = (totalSeconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export function formatTimeOfDay(d: Date): string {
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function formatDateLong(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

/** "5 Mar" for a YYYY-MM-DD date. */
export function formatDateShort(date: string): string {
  const d = new Date(date + "T00:00:00");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** Training volume: "850 kg", or tonnes from 1000 kg ("1.2t"). */
export function formatVolume(kg: number): string {
  if (kg >= 1000) return `${(kg / 1000).toFixed(1)}t`;
  return `${Math.round(kg)} kg`;
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

export function toDateString(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

export function setToken(s: ProgramSet, isTimed = false): string {
  if (isTimed || s.durationSeconds != null) {
    // A weighted hold (Pallof Hold, loaded carry) names its load too.
    const kg = Number(s.weightKg ?? 0);
    const time = formatTime(Number(s.durationSeconds ?? 60));
    return kg > 0 ? `${time} · ${kg}kg` : time;
  }
  const weight = Number(s.weightKg ?? 0);
  const reps = s.targetReps ?? "?";
  const base = weight > 0 ? `${reps}x${weight}kg` : `${reps} reps`;
  // Append the prescribed RIR cap (e.g. "8 reps @2 RIR") when set.
  return s.targetRir != null ? `${base} @${s.targetRir} RIR` : base;
}

export function restToken(s: ProgramSet): string {
  return formatTime(Number(s.restTimeSeconds));
}

function minSec(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.round(totalSeconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

/**
 * Format pace as "M:SS /km", or "M:SS /mi" in miles. distanceMeters must be > 0.
 */
export function formatPace(durationSeconds: number, distanceMeters: number, units: Units = DEFAULT_UNITS): string {
  const perUnit = units.distance === "mi" ? METERS_PER_MILE : 1000;
  return `${minSec(durationSeconds / (distanceMeters / perUnit))} /${units.distance}`;
}

/**
 * Format swim pace as "M:SS /100m", or "M:SS /100yd" in yards. distanceMeters must be > 0.
 */
export function formatSwimPace(durationSeconds: number, distanceMeters: number, units: Units = DEFAULT_UNITS): string {
  const per100 = units.swim === "yd" ? 100 * METERS_PER_YARD : 100;
  return `${minSec((durationSeconds / distanceMeters) * per100)} /100${units.swim}`;
}

/**
 * Format average speed as "XX.X km/h", or "XX.X mph" in miles.
 * distanceMeters and durationSeconds must be > 0.
 */
export function formatSpeedKmh(durationSeconds: number, distanceMeters: number, units: Units = DEFAULT_UNITS): string {
  const perUnit = units.distance === "mi" ? METERS_PER_MILE : 1000;
  const speed = (distanceMeters / perUnit) / (durationSeconds / 3600);
  return `${speed.toFixed(1)} ${units.distance === "mi" ? "mph" : "km/h"}`;
}

/**
 * Format pace/speed for a triathlon discipline. Returns "" when distance or
 * duration is missing. Run (and any null discipline) keeps the /km format.
 */
export function formatEndurancePace(
  formatter: "per100m" | "kmh" | "perKm",
  durationSeconds: number,
  distanceMeters: number,
  units: Units = DEFAULT_UNITS,
): string {
  if (distanceMeters <= 0 || durationSeconds <= 0) return "";
  switch (formatter) {
    case "per100m":
      return formatSwimPace(durationSeconds, distanceMeters, units);
    case "kmh":
      return formatSpeedKmh(durationSeconds, distanceMeters, units);
    case "perKm":
      return formatPace(durationSeconds, distanceMeters, units);
  }
}

/**
 * Format a distance in meters as a human-readable km (or mi) string.
 * < 1 → "0.8 km", whole → "5 km", fractional → "5.3 km"
 */
export function formatDistanceKm(meters: number, units: Units = DEFAULT_UNITS): string {
  const unit = units.distance;
  const v = meters / (unit === "mi" ? METERS_PER_MILE : 1000);
  if (v < 1) return `${v.toFixed(1)} ${unit}`;
  if (v % 1 === 0) return `${v} ${unit}`;
  return `${v.toFixed(1)} ${unit}`;
}

/**
 * The main text for a logged set in a session's detail: distance, time and
 * pace for a run, otherwise time, "reps × weight" or bare reps. "—" when
 * nothing was recorded.
 */
export function loggedSetLabel(
  set: { distanceMeters: number | null; durationSeconds: number | null; weightKg: unknown; actualReps: number },
  isRun: boolean,
  units: Units = DEFAULT_UNITS,
): string {
  if (isRun) {
    return (
      [
        set.distanceMeters ? formatDistanceKm(set.distanceMeters, units) : null,
        set.durationSeconds != null ? formatTime(Number(set.durationSeconds)) : null,
        set.distanceMeters && set.durationSeconds
          ? formatPace(Number(set.durationSeconds), set.distanceMeters, units)
          : null,
      ]
        .filter(Boolean)
        .join(" · ") || "—"
    );
  }
  if (set.durationSeconds != null) return formatTime(Number(set.durationSeconds));
  if (Number(set.weightKg) > 0) return `${set.actualReps} × ${Number(set.weightKg)}kg`;
  if (set.actualReps > 0) return `${set.actualReps} reps`;
  return "—";
}

/**
 * Format a distance for an endurance discipline. Swim (meter input) shows
 * meters under 1 km ("750 m"), or yards at every distance ("2187 yd", as
 * pools and swim plans count them); everything else uses km or mi.
 */
export function formatEnduranceDistance(inputUnit: "m" | "km", meters: number, units: Units = DEFAULT_UNITS): string {
  if (inputUnit === "m" && units.swim === "yd") return `${Math.round(meters / METERS_PER_YARD)} yd`;
  if (inputUnit === "m" && meters < 1000) return `${meters} m`;
  return formatDistanceKm(meters, inputUnit === "m" ? { ...units, distance: "km" } : units);
}

/**
 * The label on a distance preset button. Metric keeps the discipline's own
 * labels ("1.5km"); imperial shows the same preset distance converted
 * ("1640yd", "3.1mi"). The presets themselves stay metric distances.
 */
export function distancePresetLabel(
  cfg: { inputUnit: "m" | "km"; distancePresetsM: number[]; distanceLabels: string[] },
  index: number,
  units: Units = DEFAULT_UNITS,
): string {
  const imperial = cfg.inputUnit === "m" ? units.swim === "yd" : units.distance === "mi";
  if (!imperial) return cfg.distanceLabels[index];
  return formatEnduranceDistance(cfg.inputUnit, cfg.distancePresetsM[index], units).replace(" ", "");
}

/**
 * Build a run set summary for the exercise list row.
 * e.g. "5 km · 25:00 · 5:00 /km" or "1 km; 1 km; 1 km; ..." for intervals
 */
export function buildRunSetSummary(
  sets: ProgramSet[],
  discipline: Discipline | null = null,
  units: Units = DEFAULT_UNITS,
): string {
  if (sets.length === 0) return "";
  const cfg = disciplineConfig(discipline);
  const tokens = sets.map((s) => {
    const parts: string[] = [];
    if (s.distanceMeters) parts.push(formatEnduranceDistance(cfg.inputUnit, s.distanceMeters, units));
    if (s.durationSeconds) parts.push(formatTime(s.durationSeconds));
    if (s.distanceMeters && s.durationSeconds) {
      parts.push(formatEndurancePace(cfg.paceFormatter, s.durationSeconds, s.distanceMeters, units));
    }
    return parts.join(" · ") || cfg.label;
  });
  return tokens.length > 3
    ? tokens.slice(0, 3).join("; ") + "; ..."
    : tokens.join("; ");
}

export function buildSetSummary(sets: ProgramSet[], isTimed = false): string {
  if (sets.length === 0) return "";
  const tokens = sets.map((s) => {
    const rest = Number(s.restTimeSeconds ?? 0);
    return rest > 0
      ? `${setToken(s, isTimed)}; ${restToken(s)}`
      : setToken(s, isTimed);
  });
  return tokens.length > 3
    ? tokens.slice(0, 3).join("; ") + "; ..."
    : tokens.join("; ");
}
