/**
 * Keep the screen awake during a guided session (docs/plans/endurance-app.md,
 * 3.6). The browser drops the lock when the page hides, so the player asks
 * again when it is visible. Where the API is missing or refused, the player
 * shows a hint and keeps timing from timestamps. No hidden-video trick.
 *
 * Client only.
 */

export type WakeLockHandle = { release: () => Promise<void> };

export function wakeLockSupported(): boolean {
  return typeof navigator !== "undefined" && "wakeLock" in navigator && !!navigator.wakeLock;
}

/** Ask for a screen wake lock; null when unsupported or refused. */
export async function requestWakeLock(): Promise<WakeLockHandle | null> {
  if (!wakeLockSupported()) return null;
  try {
    return await navigator.wakeLock.request("screen");
  } catch {
    return null;
  }
}
