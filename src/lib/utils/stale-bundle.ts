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
// The Service Worker update check gets this long. On a stalled network it may
// never answer, and the page must still reload.
export const SW_UPDATE_TIMEOUT_MS = 3_000;
// Stop after this many reloads in a row that reached no Server Action, each
// within RELOAD_WINDOW_MS of the one before. The window keeps separate deploys
// hours apart in a long-lived PWA from adding up. The count and the time of
// the last reload live in sessionStorage (no personal data) so they survive
// the reloads they count; without storage the 30-second guard still applies.
export const MAX_STALE_RELOADS = 3;
export const RELOAD_WINDOW_MS = 5 * 60_000;
const RELOAD_COUNT_KEY = "staleBundleReloads";

function reloadCount(): number {
  try {
    const { n, at } = JSON.parse(sessionStorage.getItem(RELOAD_COUNT_KEY) ?? "{}") as { n?: number; at?: number };
    if (typeof n !== "number" || typeof at !== "number") return 0;
    return Date.now() - at > RELOAD_WINDOW_MS ? 0 : n;
  } catch {
    return 0;
  }
}

function setReloadCount(n: number): void {
  try {
    if (n > 0) sessionStorage.setItem(RELOAD_COUNT_KEY, JSON.stringify({ n, at: Date.now() }));
    else sessionStorage.removeItem(RELOAD_COUNT_KEY);
  } catch {
    // Storage blocked: no count, so no cap beyond the 30-second guard.
  }
}

/**
 * A Server Action reached the server and was recognised, so this bundle is
 * current. Resets the reload count.
 */
export function noteActionReached(): void {
  if (typeof window === "undefined") return;
  if (reloadCount() > 0) setReloadCount(0);
}

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
 * Reload the page to get the new bundle. Returns "reloading" when a reload is
 * under way, "later" when it holds off for now (see RELOAD_GUARD_MS), and
 * "failed" after MAX_STALE_RELOADS reloads that did not help.
 *
 * The reload is enough on its own: the Service Worker serves page navigations
 * network-first and JS chunks by content-hashed URL, so the new HTML brings
 * new chunk URLs that the old cache can't answer. Asking the worker to update
 * first just swaps the cached shell sooner.
 */
export function reloadForFreshBundle(): "reloading" | "later" | "failed" {
  if (typeof window === "undefined") return "later";
  if (reloadTriggered) return "reloading";
  const count = reloadCount();
  if (count >= MAX_STALE_RELOADS) return "failed";
  if (reloadedJustNow()) return "later";
  reloadTriggered = true;
  setReloadCount(count + 1);
  void (async () => {
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      await Promise.race([
        reg?.update(),
        new Promise((resolve) => setTimeout(resolve, SW_UPDATE_TIMEOUT_MS)),
      ]);
    } catch {
      // No Service Worker, or the update check failed: the reload still
      // fetches the new page from the network.
    }
    await new Promise((resolve) => setTimeout(resolve, RELOAD_DELAY_MS));
    window.location.reload();
  })();
  return "reloading";
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
 *
 * While that reload is under way the answer is "App updating" at once: the
 * request was already sent with a stale action ID, and the reload would cut
 * it off before it settles, leaving the caller waiting on nothing.
 */
export async function callAction<R extends { success: boolean }>(
  call: Promise<R>,
): Promise<R | { success: false; error: string }> {
  if (isReloadPending()) {
    call.catch(() => {});
    return { success: false, error: "App updating" };
  }
  try {
    const result = await call;
    noteActionReached();
    return result;
  } catch (err) {
    if (isStaleBundleError(err)) {
      void reloadForFreshBundle();
      return { success: false, error: "App updating" };
    }
    return { success: false, error: "Couldn't reach the server" };
  }
}
