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

/**
 * The server logs `Failed to find Server Action "<id>"`, but that wording is
 * not always what reaches the client — Next commonly surfaces the rejection as
 * a generic "unexpected response" instead. Matching only the server text meant
 * the recovery below never fired in production: the 2026-08-24 rollout logged
 * 59 of these while the lifter saw a plain "tap Retry" toast.
 *
 * A false positive costs a single reload and nothing else — queued mutations
 * are persisted and replayed on the next mount — whereas a false negative
 * silently drops a write after 5 retries. Match broadly on purpose.
 */
const STALE_BUNDLE_PATTERNS = [
  /failed to find server action/i,
  /unexpected response was received from the server/i,
];

/** Pull a matchable string out of whatever the action layer rejected with. */
function errorText(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) {
    // Next attaches a `digest` to server-thrown errors; it can carry the
    // reason when `message` has been flattened to something generic.
    const digest = (err as Error & { digest?: unknown }).digest;
    return [err.message, typeof digest === "string" ? digest : ""]
      .filter(Boolean)
      .join(" ");
  }
  if (typeof err === "object" && err !== null) {
    const o = err as { message?: unknown; digest?: unknown };
    return [o.message, o.digest]
      .filter((v): v is string => typeof v === "string")
      .join(" ");
  }
  return "";
}

export function isStaleBundleError(err: unknown): boolean {
  if (!err) return false;
  const msg = errorText(err);
  if (!msg) return false;
  return STALE_BUNDLE_PATTERNS.some((rx) => rx.test(msg));
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

/** Test seam — the reload is once-per-page-load, which unit tests must reset. */
export function __resetReloadGuardForTests(): void {
  reloadTriggered = false;
}
