import { disciplineConfig, type Discipline } from "@/lib/utils/discipline";
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
    return formatTime(Number(s.durationSeconds ?? 60));
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

/**
 * Format pace as "M:SS /km". distanceMeters must be > 0.
 */
export function formatPace(durationSeconds: number, distanceMeters: number): string {
  const km = distanceMeters / 1000;
  const secsPerKm = durationSeconds / km;
  const m = Math.floor(secsPerKm / 60);
  const s = Math.round(secsPerKm % 60).toString().padStart(2, "0");
  return `${m}:${s} /km`;
}

/**
 * Format swim pace as "M:SS /100m". distanceMeters must be > 0.
 */
export function formatSwimPace(durationSeconds: number, distanceMeters: number): string {
  const per100 = (durationSeconds / distanceMeters) * 100;
  const m = Math.floor(per100 / 60);
  const s = Math.round(per100 % 60).toString().padStart(2, "0");
  return `${m}:${s} /100m`;
}

/**
 * Format average speed as "XX.X km/h". distanceMeters and durationSeconds must be > 0.
 */
export function formatSpeedKmh(durationSeconds: number, distanceMeters: number): string {
  const kmh = (distanceMeters / 1000) / (durationSeconds / 3600);
  return `${kmh.toFixed(1)} km/h`;
}

/**
 * Format pace/speed for a triathlon discipline. Returns "" when distance or
 * duration is missing. Run (and any null discipline) keeps the /km format.
 */
export function formatEndurancePace(
  formatter: "per100m" | "kmh" | "perKm",
  durationSeconds: number,
  distanceMeters: number,
): string {
  if (distanceMeters <= 0 || durationSeconds <= 0) return "";
  switch (formatter) {
    case "per100m":
      return formatSwimPace(durationSeconds, distanceMeters);
    case "kmh":
      return formatSpeedKmh(durationSeconds, distanceMeters);
    case "perKm":
      return formatPace(durationSeconds, distanceMeters);
  }
}

/**
 * Format a distance in meters as a human-readable km string.
 * < 1km → "0.8 km", whole km → "5 km", fractional → "5.3 km"
 */
export function formatDistanceKm(meters: number): string {
  const km = meters / 1000;
  if (km < 1) return `${km.toFixed(1)} km`;
  if (km % 1 === 0) return `${km} km`;
  return `${km.toFixed(1)} km`;
}

/**
 * Format a distance for an endurance discipline. Swim (meter input) shows
 * meters under 1 km ("750 m"), everything else uses km.
 */
export function formatEnduranceDistance(inputUnit: "m" | "km", meters: number): string {
  if (inputUnit === "m" && meters < 1000) return `${meters} m`;
  return formatDistanceKm(meters);
}

/**
 * Build a run set summary for the exercise list row.
 * e.g. "5 km · 25:00 · 5:00 /km" or "1 km; 1 km; 1 km; ..." for intervals
 */
export function buildRunSetSummary(
  sets: ProgramSet[],
  discipline: Discipline | null = null,
): string {
  if (sets.length === 0) return "";
  const cfg = disciplineConfig(discipline);
  const tokens = sets.map((s) => {
    const parts: string[] = [];
    if (s.distanceMeters) parts.push(formatEnduranceDistance(cfg.inputUnit, s.distanceMeters));
    if (s.durationSeconds) parts.push(formatTime(s.durationSeconds));
    if (s.distanceMeters && s.durationSeconds) {
      parts.push(formatEndurancePace(cfg.paceFormatter, s.durationSeconds, s.distanceMeters));
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
