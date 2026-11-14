/**
 * Where a Back control goes, and what it says. Pure, so the rules can be unit
 * tested; `BackLink` (src/components/ui/BackLink.tsx) owns the navigation.
 *
 * Back goes to the page the user came from when that page is in the app: a
 * real history pop, the same as the iOS edge swipe, which keeps the previous
 * page's URL and state. Otherwise (cold start, reload after a full load, the
 * login redirect, a form left behind) it links to the page's parent. See
 * docs/plans/back-navigation.md.
 */

export type BackTarget = { href: string; label: string };

export type BackDecision =
  | { kind: "pop"; label: string }
  | { kind: "link"; href: string; label: string };

/** Route patterns and the name Back shows for them. `*` is one path segment. */
const LABELS: [string, string][] = [
  ["/", "Home"],
  ["/more", "More"],
  ["/history", "History"],
  ["/history/*", "Session"],
  ["/exercises", "Exercises"],
  ["/exercises/*", "Exercise"],
  ["/week", "Week"],
  ["/planned/*", "Session"],
  ["/planned/*/results", "Results"],
  ["/cycles", "Cycles"],
  ["/cycles/*", "Cycle"],
  ["/seasons", "Cycles"],
  ["/seasons/*", "Season"],
  ["/races/*/plan", "Race plan"],
  ["/programs", "Programs"],
  ["/programs/*", "Program"],
  ["/programs/*/workout", "Workout"],
  ["/programs/*/workout/exercises/*", "Sets"],
  ["/programs/*/exercises/*", "Sets"],
  ["/settings", "Settings"],
  ["/more/metrics", "Progress"],
  ["/more/calendar", "Calendar"],
  ["/more/friends", "Friends"],
  ["/more/friends/*", "Profile"],
  ["/more/garmin", "Garmin"],
  ["/more/garmin/activity/*", "Activity"],
  ["/more/garmin/race", "Race"],
  ["/more/account", "Account"],
  ["/more/account/gym", "Your gym"],
  ["/more/gyms", "Gym map"],
  ["/more/assistants", "Connected assistants"],
  ["/more/athlete", "Athlete profile"],
  ["/more/admin", "Admin"],
  ["/more/thresholds", "Thresholds"],
  ["/more/nutrition", "Nutrition"],
  ["/more/workouts", "Workouts"],
];

/** Routes Back never returns to: sign-in and one-off screens. */
const NEVER = ["/login", "/signup", "/welcome", "/consent", "/oauth"];

/** Last segments of form and player screens: done once, not gone back into. */
const FORM_ENDINGS = new Set(["new", "edit", "finish", "add-exercise", "interview", "play"]);

function pathOf(url: string): string {
  const path = url.split(/[?#]/)[0];
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

function withoutHash(url: string): string {
  const u = url.split("#")[0];
  const [path, query] = u.split("?");
  const p = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  return query ? `${p}?${query}` : p;
}

function segments(path: string): string[] {
  return path.split("/").filter(Boolean);
}

/** The name Back shows for `url`, or null for a route without one. */
export function backLabelFor(url: string): string | null {
  const parts = segments(pathOf(url));
  for (const [pattern, label] of LABELS) {
    const want = segments(pattern);
    if (want.length === parts.length && want.every((w, i) => w === "*" || w === parts[i])) return label;
  }
  return null;
}

function isAppPath(url: string): boolean {
  return url.startsWith("/") && !url.startsWith("//");
}

function isForm(path: string): boolean {
  const parts = segments(path);
  if (FORM_ENDINGS.has(parts[parts.length - 1])) return true;
  // The set editor: .../sets/new and .../sets/<id>.
  return parts[parts.length - 2] === "sets";
}

/**
 * @param prev    the app URL the current entry was pushed from (nav-history.ts), or null
 * @param current the current path
 * @param fallback the page's parent, used when there is nothing to go back to
 */
export function resolveBack(prev: string | null, current: string, fallback: BackTarget): BackDecision {
  const toFallback: BackDecision = { kind: "link", href: fallback.href, label: fallback.label };
  if (!prev || !isAppPath(prev)) return toFallback;
  const prevPath = pathOf(prev);
  if (NEVER.some((p) => prevPath === p || prevPath.startsWith(`${p}/`))) return toFallback;
  if (isForm(prevPath)) return toFallback;
  if (prevPath === pathOf(current)) return toFallback;
  // The fallback's label names its exact URL: the Garmin activities tab, not
  // whichever Garmin tab the user was on.
  if (withoutHash(prev) === withoutHash(fallback.href)) return { kind: "pop", label: fallback.label };
  return { kind: "pop", label: backLabelFor(prev) ?? "Back" };
}

/**
 * After a save or a delete, whether returning to `target` should pop history
 * (the page before is the target) rather than replace this entry with it.
 * Replacing then would leave the target twice in a row, and Back or the edge
 * swipe would land on the stale copy.
 */
export function returnsByPop(prev: string | null, target: string): boolean {
  return !!prev && isAppPath(prev) && pathOf(prev) === pathOf(target);
}
