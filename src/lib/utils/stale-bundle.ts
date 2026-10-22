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

/**
 * Await a Server Action from client code, turning a rejection into an ordinary
 * failed result.
 *
 * A Server Action returns `{ success: false }` for anything the server
 * decided, but the call itself rejects when the request never completes:
 * offline, cut off by a navigation, or a stale bundle after a deploy. Callers
 * already handle the failed result (revert the optimistic change, stay on the
 * form); a rejection skipped that handling, left the change on screen as if
 * saved, and surfaced as an unhandled rejection. Routed through here, both
 * cases take the same path, and a stale bundle also triggers the reload that
 * fixes it.
 */
export async function callAction<R extends { success: boolean }>(
  call: Promise<R>,
): Promise<R | { success: false; error: string }> {
  try {
    return await call;
  } catch (err) {
    if (isStaleBundleError(err)) {
      void reloadForFreshBundle();
      return { success: false, error: "App updating" };
    }
    return { success: false, error: "Couldn't reach the server" };
  }
}
