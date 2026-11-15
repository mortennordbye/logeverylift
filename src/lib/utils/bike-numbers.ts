/**
 * Pure rules and texts for the bike numbers (docs/plans/bike-sessions.md,
 * section 3 and 5.2): the FTP line, the watch FTP note, and custom HR zones.
 */

import type { BikeNumbers } from "@/lib/bike-numbers";

/** The automatic FTP replaces the current one only when it moves by this share or more. */
export const FTP_UPDATE_SHARE = 0.03;
/** The watch FTP note shows when the watch is more than this share off. */
export const WATCH_FTP_SHARE = 0.05;
/** An automatic FTP update shows "FTP changed from" for this many days. */
export const FTP_CHANGED_DAYS = 7;

export const HR_ZONE_MIN = 40;
export const HR_ZONE_MAX = 250;

type FtpRow = { value: number; source: "manual" | "test" | "garmin"; measuredOn: string };

/**
 * The value before the last automatic update, or null. Rule: the newest FTP
 * row is a garmin row from the last 7 days, an older row exists, and the
 * value changed. `rows` are live FTP rows, newest first.
 */
export function ftpChangedFrom(rows: FtpRow[], today: string): number | null {
  const [cur, prev] = rows;
  if (!cur || !prev || cur.source !== "garmin") return null;
  const days = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${cur.measuredOn}T00:00:00Z`)) / 86_400_000;
  if (days > FTP_CHANGED_DAYS) return null;
  return Math.round(prev.value) !== Math.round(cur.value) ? Math.round(prev.value) : null;
}

/** True when the estimate is 3 % or more away from the current value. */
export function ftpMoved(current: number, estimate: number): boolean {
  return Math.abs(estimate - current) / current >= FTP_UPDATE_SHARE;
}

/** "FTP 186 W, from your rides (best 60 min on 10 Nov)", "FTP 200 W, set by hand". */
export function ftpLineText(ftp: NonNullable<BikeNumbers["ftp"]>): string {
  const w = `FTP ${Math.round(ftp.value)} W`;
  if (ftp.source === "manual") return `${w}, set by hand`;
  if (ftp.source === "test") return `${w}, from your FTP test`;
  return ftp.basis ? `${w}, from your rides (${ftp.basis})` : `${w}, from your rides`;
}

/** "FTP changed from 180 to 186 W", or null. */
export function ftpChangedText(ftp: BikeNumbers["ftp"]): string | null {
  return ftp?.changedFrom != null ? `FTP changed from ${ftp.changedFrom} to ${Math.round(ftp.value)} W` : null;
}

/** "Your watch uses 266 W. Set it to 186 W so the watch power zones match.", when the watch is more than 5 % off. */
export function watchFtpNote(n: Pick<BikeNumbers, "ftp" | "watchFtp">): string | null {
  if (!n.ftp || !n.watchFtp) return null;
  const app = Math.round(n.ftp.value);
  if (Math.abs(n.watchFtp - app) / app <= WATCH_FTP_SHARE) return null;
  return `Your watch uses ${Math.round(n.watchFtp)} W. Set it to ${app} W so the watch power zones match.`;
}

/** Why five zone floors and a max HR are not a valid zone set, or null when they are. */
export function zoneFloorsError(floors: number[], maxHr: number): string | null {
  if (floors.length !== 5) return "Give a start for each of the five zones";
  for (const v of [...floors, maxHr]) {
    if (!Number.isInteger(v) || v < HR_ZONE_MIN || v > HR_ZONE_MAX) return `Use whole numbers from ${HR_ZONE_MIN} to ${HR_ZONE_MAX} bpm`;
  }
  for (let i = 1; i < floors.length; i++) if (floors[i] <= floors[i - 1]) return `Zone ${i + 1} must start above zone ${i}`;
  if (maxHr <= floors[4]) return "Max HR must be above the start of zone 5";
  return null;
}
