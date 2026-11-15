import { updateFtpEstimate } from "./ftp-estimate";
import { storePairings } from "./pairing";

/**
 * Work that reads stored activities and their FIT files, once per worker tick.
 * Each step fails alone: a broken FTP estimate must not stop pairing.
 */
export async function afterActivitiesSynced(userId: string, now: Date): Promise<void> {
  for (const [name, step] of [
    ["ftp estimate", updateFtpEstimate],
    ["pairing", storePairings],
  ] as const) {
    try {
      await step(userId, now);
    } catch (e) {
      console.error(`[afterActivitiesSynced] ${name} failed`, { userId }, e instanceof Error ? e.message : "unknown");
    }
  }
}
