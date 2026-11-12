/**
 * Detect a stale bundle: the client calling a Server Action ID the running
 * server doesn't know. Action IDs change on every deploy (the build salts them
 * with a fresh encryption key, and we keep it that way because the image is
 * public), so any client that was open across a deploy hits this on its next
 * write.
 *
 * The server answers with `x-nextjs-action-not-found: 1` and logs "Failed to
 * find Server Action". The client router turns that header into an
 * `UnrecognizedActionError` with the text `Server Action "<id>" was not found
 * on the server` (next/dist/client/components/router-reducer/reducers/
 * server-action-reducer.js). Matching only the server's log line is what let
 * every write after a deploy look like a network error.
 *
 * Retrying with the same bundle never succeeds. The fix is to load the new
 * bundle and send the write again from there.
 */

const STALE_BUNDLE_RX = /failed to find server action|server action ".*" was not found on the server/i;

export function isStaleBundleError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof Error && err.name === "UnrecognizedActionError") return true;
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "";
  return STALE_BUNDLE_RX.test(msg);
}

// A page that a reload opened this recently does not reload again. If the new
// bundle is stale too (a rolling deploy still serving from an old pod), the
// queue waits and retries instead of reloading in a loop.
export const RELOAD_GUARD_MS = 30_000;
// Long enough to read the "Updating app" toast, and for the queue to write
// what it holds to localStorage before the page goes.
export const RELOAD_DELAY_MS = 1_500;

let reloadTriggered = false;

/** True once this page has started a reload for a fresh bundle. */
export function isReloadPending(): boolean {
  return reloadTriggered;
}

function reloadedJustNow(): boolean {
  const nav = performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined;
  return nav?.type === "reload" && performance.now() < RELOAD_GUARD_MS;
}

/**
 * Reload the page to get the new bundle. Returns true when a reload is under
 * way, false when it holds off (see RELOAD_GUARD_MS).
 *
 * The reload is enough on its own: the Service Worker serves page navigations
 * network-first and JS chunks by content-hashed URL, so the new HTML brings
 * new chunk URLs that the old cache can't answer. Asking the worker to update
 * first just swaps the cached shell sooner.
 */
export function reloadForFreshBundle(): boolean {
  if (typeof window === "undefined") return false;
  if (reloadTriggered) return true;
  if (reloadedJustNow()) return false;
  reloadTriggered = true;
  void (async () => {
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      await reg?.update();
    } catch {
      // No Service Worker, or the update check failed: the reload still
      // fetches the new page from the network.
    }
    await new Promise((resolve) => setTimeout(resolve, RELOAD_DELAY_MS));
    window.location.reload();
  })();
  return true;
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
