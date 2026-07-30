/**
 * Marks a `router.back()` that our own UI initiated.
 *
 * `router.back()` and the iOS edge-swipe both arrive as a `popstate`, so the
 * event alone cannot tell them apart — and they need opposite treatment. A
 * swipe is already being animated by the system and we must not animate over
 * it; a Back button we drew has no system animation and must keep ours.
 *
 * Call `markProgrammaticBack()` immediately before `router.back()`. The flag is
 * consumed by the next route change and self-clears shortly after, so a marked
 * call that never navigates (blocked, or the user is already at the first
 * entry) cannot leak into an unrelated swipe later.
 */

let programmaticBack = false;
let clearTimer: ReturnType<typeof setTimeout> | undefined;

/** Window in which the marked navigation is expected to land. */
const INTENT_TTL_MS = 1_000;

export function markProgrammaticBack(): void {
  programmaticBack = true;
  if (clearTimer) clearTimeout(clearTimer);
  clearTimer = setTimeout(() => {
    programmaticBack = false;
    clearTimer = undefined;
  }, INTENT_TTL_MS);
}

/** Reads and clears the flag. */
export function consumeProgrammaticBack(): boolean {
  const was = programmaticBack;
  programmaticBack = false;
  if (clearTimer) {
    clearTimeout(clearTimer);
    clearTimer = undefined;
  }
  return was;
}

/** Test seam — resets module state between cases. */
export function resetNavIntent(): void {
  programmaticBack = false;
  if (clearTimer) {
    clearTimeout(clearTimer);
    clearTimer = undefined;
  }
}

type HistoryNavWindow = Window & { __lelHistoryNav?: boolean };

/**
 * Reads and clears the "this route change came from the history stack" flag.
 *
 * The flag is set by a pre-hydration script in the root layout rather than a
 * React effect, because the App Router registers its own `popstate` listener
 * during hydration and listeners fire in registration order. A listener added
 * afterwards can run *after* React has re-rendered with the new pathname, which
 * made swipes read as pushes under load. The inline script always wins.
 *
 * Lives here rather than inline in the component so the component does not
 * assign to a global during render, which `react-hooks/immutability` rightly
 * rejects.
 */
export function consumeHistoryNav(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as HistoryNavWindow;
  const was = w.__lelHistoryNav === true;
  w.__lelHistoryNav = false;
  return was;
}
