/**
 * Detect "Failed to find Server Action" errors — Next.js raises these when
 * the cached client bundle calls an action ID the running server bundle
 * doesn't know (typically because a new image was deployed while the user
 * had the PWA open with old chunks held by the Service Worker).
 *
 * Treating these as transient and retrying is wrong: the action will never
 * succeed against the new server. The right response is to update the
 * Service Worker and force a reload so the user gets fresh chunks.
 */

const STALE_BUNDLE_RX = /failed to find server action/i;

export function isStaleBundleError(err: unknown): boolean {
  if (!err) return false;
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "";
  return STALE_BUNDLE_RX.test(msg);
}

let reloadTriggered = false;

export async function reloadForFreshBundle(): Promise<void> {
  if (reloadTriggered || typeof window === "undefined") return;
  reloadTriggered = true;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
  } catch {
    // SW unavailable or failed to update — reload anyway, browser cache
    // bust will likely still pick up new chunks.
  }
  window.location.reload();
}
