/**
 * Direction logic for the app's page transitions.
 *
 * Extracted from `PageTransition.tsx` so the rules can be unit tested. The
 * component owns the animation; this file owns the decision of whether to
 * animate at all, and which way.
 */

export type Direction = "forward" | "back" | "none";

/** How a route change was triggered. */
export type NavSource =
  /** An in-app push: a `<Link>` tap or `router.push`. */
  | "push"
  /**
   * A history entry the platform popped: the browser Back button, or the iOS
   * edge-swipe gesture in a standalone PWA.
   */
  | "history"
  /**
   * `router.back()` called by our own code — a Back button we drew, or the
   * return after saving a set. It arrives as `popstate`, exactly like a swipe,
   * but the user pressed one of our controls and expects our animation.
   */
  | "programmatic-back";

export function getDepth(path: string): number {
  return path.split("/").filter(Boolean).length;
}

/** Direction implied purely by the two paths, ignoring what triggered it. */
export function getDirection(from: string, to: string): Direction {
  if (from === to) return "none";
  const d1 = getDepth(from);
  const d2 = getDepth(to);
  // Both at tab level (depth 0 or 1) → instant switch, no animation.
  // Native tab bars do not slide between tabs.
  if (d1 <= 1 && d2 <= 1) return "none";
  if (d2 > d1) return "forward";
  if (d2 < d1) return "back";
  return "none";
}

/**
 * Whether to animate this route change, and which way.
 *
 * The rule that matters: **do not animate a navigation the platform is already
 * animating.** In a standalone PWA on iOS, an edge swipe runs the system's own
 * interactive back transition, following the finger and taking a snapshot of
 * the previous page with it. Running our slide as well means the screen moves
 * twice for one gesture — the platform's, then ours — which reads as a broken
 * or stuttering animation. It cannot be fixed by tuning our curve, and the
 * system gesture cannot be cancelled from JavaScript, so the only correct move
 * is to stand down and let it own the motion.
 *
 * `programmatic-back` is the exception. `router.back()` also surfaces as a
 * `popstate`, so it is indistinguishable from a swipe at the event level, but
 * no system gesture ran and standing down would leave those transitions dead.
 * Call sites mark their intent (see `nav-intent.ts`) so they keep animating.
 */
export function resolveDirection(
  from: string,
  to: string,
  source: NavSource,
): Direction {
  if (source === "history") return "none";
  return getDirection(from, to);
}
