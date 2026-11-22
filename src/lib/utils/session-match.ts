/**
 * The match of one planned session as words (docs/plans/session-check.md,
 * decisions 4 to 6): how it was logged, which Garmin activity it is matched
 * to, how the steps were filled, and the "Not matched" line with Pick. The
 * server reads the match (src/lib/session-match.ts); these rules only shape it.
 */

import type { RideSport } from "@/db/schema/rides";
import { formatEnduranceDistance, formatSessionLength } from "@/lib/utils/format";
import type { MatchedBy, SessionState, Sport } from "@/lib/utils/session-compliance";
import type { Units } from "@/lib/utils/units";

/** How the session was logged: in the app's ride or run mode, as a plain app workout, or only on the watch. */
export type MatchLogged = "app_ride" | "app_run" | "app_workout" | "watch";

/**
 * A stored Garmin activity. `id` is the app's row id (what a pick stores),
 * `activityId` Garmin's id (what the Garmin pages and the ride fill use).
 * `startTime` is the local wall-clock start as Garmin gives it, in ISO form.
 */
export type MatchActivity = {
  id: number;
  activityId: number;
  name: string;
  startTime: string;
  durationSeconds: number | null;
  distanceMeters: number | null;
};

export type SessionMatch = {
  plannedSessionId: number;
  date: string;
  sport: Sport | null;
  state: SessionState;
  matchedBy: MatchedBy | null;
  program: { id: number; name: string; cycleName: string | null } | null;
  logged: MatchLogged | null;
  /** Null when nothing is matched, or Garmin is not on for the user. */
  garmin: (MatchActivity & { fill: "laps" | "time" | null }) | null;
  /** That day's Garmin activities of the session's sport that a pick may store (Garmin on only). */
  candidates: MatchActivity[];
  /** Pick (nothing matched) or Pick another (a watch match): the stored pick can change it. */
  canPick: boolean;
  /** The step page will have steps: an ended ride or run, or (Garmin on) a matched activity of the sport to split. */
  hasSteps: boolean;
};

/** The step page of a done session. One place, so the route can change in one line. */
export function sessionCheckHref(plannedSessionId: number): string {
  return `/planned/${plannedSessionId}/check`;
}

/**
 * How a session was logged: a workout the app matched (link or app) is a ride
 * or a run when it has a ride of the session's sport (else of any sport), else
 * a plain workout; a pick or a Garmin pair is the watch.
 */
export function loggedOf(matchedBy: MatchedBy | null, rideSports: RideSport[], sport: Sport | null): MatchLogged | null {
  if (matchedBy === "pick" || matchedBy === "garmin") return "watch";
  if (matchedBy !== "link" && matchedBy !== "app") return null;
  const ride = rideSports.find((s) => s === sport) ?? rideSports[0];
  return ride === "bike" ? "app_ride" : ride === "run" ? "app_run" : "app_workout";
}

const LOGGED_TEXT: Record<MatchLogged, string> = {
  app_ride: "In the app · ride mode",
  app_run: "In the app · run mode",
  app_workout: "In the app",
  watch: "On the watch",
};

const SPORT_NOUN: Record<Sport, [string, string]> = { bike: ["ride", "rides"], run: ["run", "runs"], swim: ["swim", "swims"] };

/** "08:05": the local start time. */
export function clockOf(startTime: string): string {
  return startTime.slice(11, 16);
}

/** "45 min" under an hour, "2 h 16 min" from an hour on. */
export function lengthText(seconds: number): string {
  return seconds < 3600 ? `${Math.round(seconds / 60)} min` : formatSessionLength(Math.round(seconds));
}

/** "08:05 · 45 min · 7.8 km" for one activity. */
export function activityText(a: Pick<MatchActivity, "startTime" | "durationSeconds" | "distanceMeters">, units?: Units): string {
  return [
    clockOf(a.startTime),
    ...(a.durationSeconds ? [lengthText(a.durationSeconds)] : []),
    ...(a.distanceMeters ? [formatEnduranceDistance("km", Math.round(a.distanceMeters), units)] : []),
  ].join(" · ");
}

export type MatchBlockView = {
  program: { href: string; text: string } | null;
  logged: string | null;
  garmin:
    | { kind: "matched"; href: string; name: string; detail: string; pickAnother: boolean }
    | { kind: "none"; text: string; pick: boolean }
    | null;
  fill: string | null;
  stepsHref: string | null;
  candidates: { id: number; name: string; detail: string }[];
};

/**
 * The block as words. `garminOn`: the Garmin parts show only for a user with
 * Garmin (decision 5). "See every step" shows for a done bike or run session
 * whose step page has steps (`hasSteps`).
 */
export function matchBlockView(m: SessionMatch, garminOn: boolean, units?: Units): MatchBlockView {
  const program = m.program ? { href: `/programs/${m.program.id}`, text: m.program.cycleName ? `${m.program.cycleName} · ${m.program.name}` : m.program.name } : null;
  let garmin: MatchBlockView["garmin"] = null;
  if (garminOn && m.garmin) {
    garmin = {
      kind: "matched",
      href: `/more/garmin/activity/${m.garmin.activityId}`,
      name: m.garmin.name,
      detail: [clockOf(m.garmin.startTime), ...(m.garmin.durationSeconds ? [lengthText(m.garmin.durationSeconds)] : [])].join(" · "),
      pickAnother: m.canPick && m.candidates.some((c) => c.id !== m.garmin!.id),
    };
  } else if (garminOn && m.sport && (m.canPick || m.logged)) {
    const n = m.candidates.length;
    const [one, many] = SPORT_NOUN[m.sport];
    garmin = { kind: "none", text: `Not matched · ${n === 0 ? `no ${one}` : `${n} ${n === 1 ? one : many}`} that day`, pick: m.canPick && n > 0 };
  }
  const fill = garminOn && m.garmin?.fill ? `Numbers filled from Garmin · split by ${m.garmin.fill === "laps" ? "laps" : "time"}` : null;
  return {
    program,
    logged: m.logged ? LOGGED_TEXT[m.logged] : null,
    garmin,
    fill,
    stepsHref: m.state === "done" && m.hasSteps && (m.sport === "bike" || m.sport === "run") ? sessionCheckHref(m.plannedSessionId) : null,
    candidates: garminOn ? m.candidates.filter((c) => c.id !== m.garmin?.id).map((c) => ({ id: c.id, name: c.name, detail: activityText(c, units) })) : [],
  };
}
