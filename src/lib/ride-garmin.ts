/**
 * Garmin fill of a ride (docs/plans/bike-ride-logger.md, 4.8, D6 and D8): a
 * Garmin bike activity that overlaps a finished or ended-early ride fills the
 * ride's steps, corrects its mode, and gives the numbers of 4.6 that need a
 * 1 s stream. Undo restores what was there and the pair never fills again.
 *
 * - Match: the activity's start to end overlaps the ride's, with 5 min on
 *   either side. Two or more matches fill nothing: the rider picks one.
 * - Split: by Garmin's laps or by the timeline's step times (`splitRide`).
 * - Fill: empty or clock-sourced fields only, marked `garmin`. Typed and
 *   assistant values stay. What was there is kept in `ride_garmin_fills`.
 *
 * Plain server code: callers resolve the user. The worker calls
 * `fillRidesFromGarmin` after it stored new activities.
 */

import { db } from "@/db";
import { garminActivities, garminActivityStreams, rideEvents, rideGarminFills, rides, workoutSessions, workoutSets, type RideMode } from "@/db/schema";
import type { ResultSource } from "@/db/schema/workout-sets";
import { garminAllowedFor } from "@/lib/garmin/access";
import { isIndoor, sportOf } from "@/lib/garmin/analytics/sport";
import { rideTimeline, type RidePlan, type RideTimeline } from "@/lib/utils/ride-timeline";
import {
  rideDoneChart,
  rideStreamNumbers,
  splitRide,
  windowValues,
  type DoneChart,
  type FitEvent,
  type FitLap,
  type RideSplit,
  type RideStreams,
  type StreamNumbers,
  type WindowValues,
} from "@/lib/utils/ride-stream";
import { and, asc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";

/** An activity counts as the ride's when it overlaps it with this much to spare on either side (4.8). */
export const MATCH_TOLERANCE_MS = 5 * 60_000;
/** The worker looks for rides to fill this far back. */
const FILL_WINDOW_MS = 7 * 86_400_000;

type Ride = typeof rides.$inferSelect;
type Field = keyof WindowValues;

const INDOOR_FIELDS: Field[] = ["avgPower", "avgHr", "maxHr", "avgCadence"];
const OUTDOOR_FIELDS: Field[] = ["avgPower", "avgHr", "maxHr", "avgCadence", "distanceMeters", "avgSpeed", "climbM"];

/** What a fill replaced: per program set the old value and source of each field it wrote, and the mode it corrected. */
export type RideFillPrevious = {
  split: RideSplit["method"];
  steps: Record<string, Partial<Record<Field, { value: number | null; source: ResultSource | null }>>>;
  mode: { from: RideMode; to: RideMode; session: RideMode | null } | null;
};

/** A stored Garmin activity with its streams, as the fill reads it. */
export type RideActivity = {
  garminActivityId: number;
  typeKey: string;
  startMs: number;
  endMs: number;
  /** Stream time 0, the FIT session's start. */
  t0Ms: number;
  streams: RideStreams;
  laps: FitLap[];
  events: FitEvent[];
};

/** Indoor for an indoor or virtual ride, else outdoor (4.8). */
export function modeOfActivity(typeKey: string): RideMode {
  return isIndoor(typeKey) ? "indoor" : "outdoor";
}

const gmt = (v: unknown) => (typeof v === "string" ? Date.parse(`${v.replace(" ", "T")}Z`) : NaN);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function toActivity(r: { garminActivityId: number; typeKey: string; data: unknown; streams: unknown; laps: unknown; events: unknown; session: unknown }): RideActivity | null {
  const data = (r.data ?? {}) as Record<string, unknown>;
  const session = (r.session ?? {}) as Record<string, unknown>;
  const startMs = typeof session.startTime === "string" ? Date.parse(session.startTime) : gmt(data.startTimeGMT);
  const seconds = num(session.totalElapsedTime) ?? num(data.elapsedDuration) ?? num(data.duration);
  const streams = (r.streams ?? {}) as RideStreams;
  if (!Number.isFinite(startMs) || seconds === null || !Array.isArray(streams.t)) return null;
  return {
    garminActivityId: r.garminActivityId,
    typeKey: r.typeKey,
    startMs,
    endMs: startMs + seconds * 1000,
    t0Ms: startMs,
    streams,
    laps: Array.isArray(r.laps) ? (r.laps as FitLap[]) : [],
    events: Array.isArray(r.events) ? (r.events as FitEvent[]) : [],
  };
}

/** The user's stored Garmin bike activities with streams that overlap the ride (5 min tolerance). */
export async function rideMatches(userId: string, ride: { startedAt: number; endedAt: number }): Promise<RideActivity[]> {
  // start_time_local is local time stored as UTC: a day either side covers every time zone.
  const rows = await db
    .select({
      garminActivityId: garminActivities.garminActivityId,
      typeKey: garminActivities.activityType,
      data: garminActivities.data,
      streams: garminActivityStreams.streams,
      laps: garminActivityStreams.laps,
      events: garminActivityStreams.events,
      session: garminActivityStreams.session,
    })
    .from(garminActivities)
    .innerJoin(
      garminActivityStreams,
      and(eq(garminActivityStreams.userId, garminActivities.userId), eq(garminActivityStreams.garminActivityId, garminActivities.garminActivityId)),
    )
    .where(
      and(
        eq(garminActivities.userId, userId),
        gte(garminActivities.startTimeLocal, new Date(ride.startedAt - 86_400_000)),
        lte(garminActivities.startTimeLocal, new Date(ride.endedAt + 86_400_000)),
      ),
    )
    .orderBy(asc(garminActivities.startTimeLocal));
  return rows
    .filter((r) => sportOf(r.typeKey) === "bike")
    .map(toActivity)
    .filter((a): a is RideActivity => !!a && a.startMs - MATCH_TOLERANCE_MS < ride.endedAt && a.endMs + MATCH_TOLERANCE_MS > ride.startedAt);
}

/** The ride's timeline from its stored events. */
async function timelineOf(ride: Ride): Promise<RideTimeline> {
  const events = await db.select().from(rideEvents).where(eq(rideEvents.rideId, ride.id)).orderBy(asc(rideEvents.seq));
  return rideTimeline(
    ride.plan as RidePlan,
    events.map((e) => ({ seq: e.seq, kind: e.kind, value: e.value, at: e.at.getTime() })),
    Date.now(),
    { heartbeatAt: ride.heartbeatAt?.getTime() ?? null },
  );
}

const ended = (t: RideTimeline) => (t.status === "finished" || t.status === "ended_early") && t.startedAt !== null && t.endedAt !== null;

/** The split of an activity into the ride's ridden steps. */
export function rideSplit(timeline: RideTimeline, a: RideActivity): RideSplit {
  return splitRide(timeline.steps, a.laps, a.events, a.t0Ms);
}

type FillResult = { status: "filled"; fields: number } | { status: "exists" } | { status: "not_ended" };

/**
 * Fill the ride's steps from one activity. Writes only empty or clock-sourced
 * fields; a pair already filled or declined writes nothing.
 */
export async function fillRide(userId: string, ride: Ride, a: RideActivity, timeline?: RideTimeline): Promise<FillResult> {
  const t = timeline ?? (await timelineOf(ride));
  if (!ended(t)) return { status: "not_ended" };
  const mode = modeOfActivity(a.typeKey);
  const split = rideSplit(t, a);
  const fields = mode === "indoor" ? INDOOR_FIELDS : OUTDOOR_FIELDS;

  return db.transaction(async (tx) => {
    const [fill] = await tx
      .insert(rideGarminFills)
      .values({ userId, rideId: ride.id, garminActivityId: a.garminActivityId, previous: {} })
      .onConflictDoNothing()
      .returning({ id: rideGarminFills.id });
    if (!fill) return { status: "exists" } as const;

    const previous: RideFillPrevious = { split: split.method, steps: {}, mode: null };
    const ids = split.windows.map((w) => w.programSetId);
    const rows = ids.length
      ? await tx
          .select()
          .from(workoutSets)
          .where(and(eq(workoutSets.sessionId, ride.sessionId), inArray(workoutSets.programSetId, ids)))
          .for("update")
      : [];
    let written = 0;
    for (const w of split.windows) {
      const row = rows.find((r) => r.programSetId === w.programSetId);
      if (!row || (row.stepStatus !== "done" && row.stepStatus !== "partial")) continue;
      const values = windowValues(a.streams, w, mode);
      const sources = { ...(row.sources ?? {}) };
      const patch: Partial<Record<Field, number>> = {};
      const prev: RideFillPrevious["steps"][string] = {};
      for (const f of fields) {
        const v = values[f];
        const src = sources[f] ?? null;
        if (v === null || (row[f] !== null && src !== "clock")) continue;
        prev[f] = { value: row[f], source: src };
        patch[f] = v;
        sources[f] = "garmin";
      }
      if (!Object.keys(patch).length) continue;
      written += Object.keys(patch).length;
      previous.steps[w.programSetId] = prev;
      await tx
        .update(workoutSets)
        .set({ ...patch, sources })
        .where(eq(workoutSets.id, row.id));
    }

    const plan = ride.plan as RidePlan;
    if (plan.mode !== mode) {
      const [s] = await tx.select({ rideMode: workoutSessions.rideMode }).from(workoutSessions).where(eq(workoutSessions.id, ride.sessionId));
      previous.mode = { from: plan.mode, to: mode, session: s?.rideMode ?? null };
      await setRideMode(tx, ride, mode, mode);
    }
    await tx.update(rideGarminFills).set({ previous }).where(eq(rideGarminFills.id, fill.id));
    return { status: "filled", fields: written } as const;
  });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The ride's mode on the ride, its frozen plan and its workout (D6: the Garmin activity type corrects it). */
async function setRideMode(tx: Tx, ride: Ride, mode: RideMode, sessionMode: RideMode | null) {
  await tx
    .update(rides)
    .set({ mode, plan: sql`jsonb_set(${rides.plan}, '{mode}', to_jsonb(${mode}::text))` })
    .where(eq(rides.id, ride.id));
  await tx.update(workoutSessions).set({ rideMode: sessionMode }).where(and(eq(workoutSessions.id, ride.sessionId), eq(workoutSessions.userId, ride.userId)));
}

/**
 * After a Garmin import: fill each of the user's rides of the last 7 days
 * that has ended, has no fill yet and exactly one matching activity whose
 * pair the rider has not declined. Garmin access only.
 */
export async function fillRidesFromGarmin(userId: string, now = Date.now()): Promise<number> {
  if (!(await garminAllowedFor(userId))) return 0;
  const recent = await db
    .select()
    .from(rides)
    .where(and(eq(rides.userId, userId), ne(rides.status, "ready"), gte(rides.startedAt, new Date(now - FILL_WINDOW_MS))));
  if (!recent.length) return 0;
  const fills = await db
    .select({ rideId: rideGarminFills.rideId, garminActivityId: rideGarminFills.garminActivityId, declined: rideGarminFills.declined })
    .from(rideGarminFills)
    .where(inArray(rideGarminFills.rideId, recent.map((r) => r.id)));
  let filled = 0;
  for (const ride of recent) {
    const mine = fills.filter((f) => f.rideId === ride.id);
    if (mine.some((f) => !f.declined)) continue;
    const t = await timelineOf(ride);
    if (!ended(t)) continue;
    const matches = await rideMatches(userId, { startedAt: t.startedAt!, endedAt: t.endedAt! });
    if (matches.length !== 1 || mine.some((f) => f.garminActivityId === matches[0].garminActivityId)) continue;
    const r = await fillRide(userId, ride, matches[0], t);
    if (r.status === "filled") filled++;
  }
  return filled;
}

/** Undo the ride's fill: restore each field Garmin still holds, and the mode, then mark the pair declined. */
export async function undoRideFill(userId: string, rideId: number): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [fill] = await tx
      .select()
      .from(rideGarminFills)
      .where(and(eq(rideGarminFills.userId, userId), eq(rideGarminFills.rideId, rideId), eq(rideGarminFills.declined, false)))
      .for("update");
    if (!fill) return false;
    const [ride] = await tx.select().from(rides).where(and(eq(rides.id, rideId), eq(rides.userId, userId)));
    if (!ride) return false;
    const previous = fill.previous as RideFillPrevious;
    const ids = Object.keys(previous.steps ?? {}).map(Number);
    const rows = ids.length
      ? await tx.select().from(workoutSets).where(and(eq(workoutSets.sessionId, ride.sessionId), inArray(workoutSets.programSetId, ids))).for("update")
      : [];
    for (const row of rows) {
      const prev = previous.steps[String(row.programSetId)] ?? {};
      const sources = { ...(row.sources ?? {}) };
      const patch: Partial<Record<Field, number | null>> = {};
      for (const [f, p] of Object.entries(prev) as [Field, { value: number | null; source: ResultSource | null }][]) {
        // A value the rider typed over since stays.
        if (sources[f] !== "garmin") continue;
        patch[f] = p.value;
        if (p.source) sources[f] = p.source;
        else delete sources[f];
      }
      if (Object.keys(patch).length) await tx.update(workoutSets).set({ ...patch, sources }).where(eq(workoutSets.id, row.id));
    }
    if (previous.mode && (ride.plan as RidePlan).mode === previous.mode.to) await setRideMode(tx, ride, previous.mode.from, previous.mode.session);
    await tx.update(rideGarminFills).set({ declined: true }).where(eq(rideGarminFills.id, fill.id));
    return true;
  });
}

/** Fill the ride from the activity the rider picked out of two or more matches. A declined pair may be picked again. */
export async function pickRideActivity(userId: string, rideId: number, garminActivityId: number): Promise<"filled" | "not_found" | "already_filled"> {
  const [ride] = await db.select().from(rides).where(and(eq(rides.id, rideId), eq(rides.userId, userId)));
  if (!ride) return "not_found";
  const t = await timelineOf(ride);
  if (!ended(t)) return "not_found";
  const fills = await db.select().from(rideGarminFills).where(eq(rideGarminFills.rideId, rideId));
  if (fills.some((f) => !f.declined)) return "already_filled";
  const a = (await rideMatches(userId, { startedAt: t.startedAt!, endedAt: t.endedAt! })).find((m) => m.garminActivityId === garminActivityId);
  if (!a) return "not_found";
  await db.delete(rideGarminFills).where(and(eq(rideGarminFills.rideId, rideId), eq(rideGarminFills.garminActivityId, garminActivityId)));
  const r = await fillRide(userId, ride, a, t);
  return r.status === "filled" ? "filled" : "already_filled";
}

// ── Reading ──────────────────────────────────────────────────────────────────

export type RideGarminView = {
  /** "filled": a fill stands (Undo); "pick": two or more activities match and none fills; "none": nothing to show. */
  state: "filled" | "pick" | "none";
  garminActivityId: number | null;
  /** Any fill of this ride was undone. */
  declined: boolean;
  candidates: { garminActivityId: number; startMs: number; seconds: number }[];
  /** The stream numbers and chart of the filled activity. */
  stream: { split: RideSplit["method"]; numbers: StreamNumbers; chart: DoneChart | null } | null;
};

const NONE: RideGarminView = { state: "none", garminActivityId: null, declined: false, candidates: [], stream: null };

/** The ride's Garmin state for the summary and get_ride. Garmin access only; else nothing. */
export async function rideGarminView(userId: string, rideId: number): Promise<RideGarminView> {
  if (!(await garminAllowedFor(userId))) return NONE;
  const [ride] = await db.select().from(rides).where(and(eq(rides.id, rideId), eq(rides.userId, userId)));
  if (!ride) return NONE;
  const t = await timelineOf(ride);
  if (!ended(t)) return NONE;
  const fills = await db.select().from(rideGarminFills).where(eq(rideGarminFills.rideId, rideId));
  const active = fills.find((f) => !f.declined) ?? null;
  const declined = fills.some((f) => f.declined);
  const matches = await rideMatches(userId, { startedAt: t.startedAt!, endedAt: t.endedAt! });
  if (active) {
    const a = matches.find((m) => m.garminActivityId === active.garminActivityId) ?? null;
    if (!a) return { ...NONE, state: "filled", garminActivityId: active.garminActivityId, declined };
    const plan = ride.plan as RidePlan;
    const split = rideSplit(t, a);
    const ftp = plan.thresholds.ftp ?? null;
    return {
      state: "filled",
      garminActivityId: a.garminActivityId,
      declined,
      candidates: [],
      stream: {
        split: split.method,
        numbers: rideStreamNumbers(a.streams, plan.steps, split.windows, { ftp, lthr: plan.thresholds.lthr_bike ?? null, mode: plan.mode }),
        chart: rideDoneChart(a.streams, plan.steps, split, ftp),
      },
    };
  }
  if (matches.length >= 2) {
    return {
      ...NONE,
      state: "pick",
      declined,
      candidates: matches.map((m) => ({ garminActivityId: m.garminActivityId, startMs: m.startMs, seconds: Math.round((m.endMs - m.startMs) / 1000) })),
    };
  }
  return { ...NONE, declined };
}
