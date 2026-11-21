/**
 * Pure logic for body measurements (docs/plans/body-measurements.md): change
 * since a date, the left and right note, body ratios and the next log date.
 * Nothing here is stored; the page works it out on each read.
 */

import type { BodySide, BodySite, bodyMeasurements } from "@/db/schema/body-measurements";
import { addDaysStr } from "@/lib/utils/seasons";

export type MeasurementRow = Pick<typeof bodyMeasurements.$inferSelect, "id" | "site" | "side" | "valueCm" | "measuredOn">;

export type ChangeSince = "first" | "3m" | "last";

export const CHANGE_SINCE_OPTIONS: { value: ChangeSince; label: string }[] = [
  { value: "first", label: "First log" },
  { value: "3m", label: "3 months" },
  { value: "last", label: "Last log" },
];

/** One site and side's values, oldest first. */
export function seriesOf(rows: MeasurementRow[], site: BodySite, side: BodySide): MeasurementRow[] {
  return rows
    .filter((r) => r.site === site && r.side === side)
    .sort((a, b) => a.measuredOn.localeCompare(b.measuredOn));
}

/** The latest value of a site and side, or null. */
export function latestOf(rows: MeasurementRow[], site: BodySite, side: BodySide): MeasurementRow | null {
  return seriesOf(rows, site, side).at(-1) ?? null;
}

/** "YYYY-MM-DD" `months` months before `day`, on the last day of a shorter month (31 May to 28 Feb). */
export function monthsBefore(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m - 1 - months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 - months, Math.min(d, lastDay))).toISOString().slice(0, 10);
}

/**
 * The latest value against a reference value of the same series: the first
 * log, the value as of three months before today (else the first log), or the
 * log before the latest. Null when there is nothing to compare with.
 */
export function changeSince(
  series: MeasurementRow[],
  since: ChangeSince,
  today: string,
): { delta: number; from: string } | null {
  if (series.length < 2) return null;
  const latest = series[series.length - 1];
  let ref: MeasurementRow;
  if (since === "last") ref = series[series.length - 2];
  else if (since === "first") ref = series[0];
  else {
    const cutoff = monthsBefore(today, 3);
    ref = series.filter((r) => r.measuredOn <= cutoff).at(-1) ?? series[0];
  }
  return { delta: round1(latest.valueCm - ref.valueCm), from: ref.measuredOn };
}

export const round1 = (v: number) => Math.round(v * 10) / 10;

/** A sided part's change per side, "▲0.5 · new", or null when no side has one. */
export function sidedChange(series: MeasurementRow[][], since: ChangeSince, today: string): string | null {
  // A side with no values says nothing.
  const changes = series.filter((s) => s.length > 0).map((s) => changeSince(s, since, today));
  return changes.some(Boolean) ? changes.map((c) => (c ? formatChange(c.delta) : "new")).join(" · ") : null;
}

/** "36.5" or "36": one decimal, none when it is zero. */
export const formatCm = (v: number) => String(round1(v));

/** A change as a neutral arrow and number (decision 4): "▲0.5", "▼2.0", "±0". */
export function formatChange(delta: number): string {
  if (Math.abs(delta) < 0.05) return "±0";
  return `${delta > 0 ? "▲" : "▼"}${Math.abs(delta).toFixed(1)}`;
}

/** "Right is 1.1 cm bigger" when the two sides differ by 1 cm or more (decision 5). */
export function sideNote(left: number | null, right: number | null): string | null {
  if (left === null || right === null) return null;
  const diff = round1(right - left);
  if (Math.abs(diff) < 1) return null;
  return `${diff > 0 ? "Right" : "Left"} is ${Math.abs(diff).toFixed(1)} cm bigger`;
}

/**
 * Body fat by the US Navy method (Hodgdon and Beckett), in cm. Men use neck
 * and waist, women also hips. Null when an input is missing or the inputs
 * cannot give a value.
 */
export function navyBodyFat(input: {
  gender: string | null;
  heightCm: number | null;
  neck: number | null;
  waist: number | null;
  hips: number | null;
}): number | null {
  const { gender, heightCm, neck, waist, hips } = input;
  if (!heightCm || neck === null || waist === null) return null;
  let pct: number;
  if (gender === "male") {
    if (waist - neck <= 0) return null;
    pct = 495 / (1.0324 - 0.19077 * Math.log10(waist - neck) + 0.15456 * Math.log10(heightCm)) - 450;
  } else if (gender === "female") {
    if (hips === null || waist + hips - neck <= 0) return null;
    pct = 495 / (1.29579 - 0.35004 * Math.log10(waist + hips - neck) + 0.221 * Math.log10(heightCm)) - 450;
  } else return null;
  return Number.isFinite(pct) && pct > 0 && pct < 75 ? pct : null;
}

export type Ratio = { id: string; label: string; note: string; value: string };

/** The body ratio rows (decision 7); a row whose input is missing is left out. */
export function bodyRatios(input: {
  gender: string | null;
  heightCm: number | null;
  neck: number | null;
  shoulders: number | null;
  waist: number | null;
  hips: number | null;
}): Ratio[] {
  const { heightCm, shoulders, waist, hips } = input;
  const out: Ratio[] = [];
  const two = (v: number) => v.toFixed(2);
  if (waist !== null && heightCm)
    out.push({ id: "waist-height", label: "Waist to height", note: "Under 0.5 · lower health risk", value: two(waist / heightCm) });
  if (waist !== null && hips !== null)
    out.push({ id: "waist-hips", label: "Waist to hips", note: "WHO limit 0.90 for men, 0.85 for women", value: two(waist / hips) });
  if (shoulders !== null && waist !== null)
    out.push({ id: "shoulders-waist", label: "Shoulders to waist", note: "Goes up when shoulders grow or waist drops", value: two(shoulders / waist) });
  const fat = navyBodyFat(input);
  if (fat !== null)
    out.push({ id: "body-fat", label: "Body fat estimate", note: "US Navy method · about ± 3 %", value: `${Math.round(fat)} %` });
  return out;
}

/** The latest log date plus 14 days (decision 8). */
export const nextLogFrom = (latest: string) => addDaysStr(latest, 14);
