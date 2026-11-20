/**
 * Garmin fill of a ride (docs/plans/bike-ride-logger.md, 4.8, D6 and D8): a
 * Garmin bike activity that overlaps a finished or ended-early ride fills the
 * ride's steps, corrects its mode, and gives the numbers of 4.6 that need a
 * 1 s stream. Undo restores what was there and the pair never fills again.
 *
 * A run (docs/plans/run-logger.md, 4.8) is filled the same way from a Garmin
 * run, never from a ride, with run fields: cadence doubled to steps per
 * minute, never power; on a treadmill the belt's distance stays. A part of a
 * multisport file (a segment) matches like an activity of its own, keyed by
 * activity and segment. A re-sync of the run's activity rewrites the fields
 * still marked Garmin.
 *
 * - Match: the activity's start to end overlaps the ride's, with 5 min on
 *   either side. Two or more matches fill nothing: the rider picks one.
 * - Split: by Garmin's laps, else by each step's start and end on the wall
 *   clock, less the rider's pauses in the app (`splitRide`).
 * - Fill: empty or clock-sourced fields only, marked `garmin`. Typed and
 *   assistant values stay. What was there is kept in `ride_garmin_fills`.
 *
 * Matching reads only each activity's summary and session; the streams are
 * read for the one activity that fills or is shown.
 *
 * Plain server code: callers resolve the user. The worker calls
 * `fillRidesFromGarmin` after it stored new activities.
 */

import { db } from "@/db";
import { garminActivities, garminActivityStreams, rideEvents, rideGarminFills, rides, workoutSessions, workoutSets, type RideMode, type RideSport } from "@/db/schema";
import type { ResultSource } from "@/db/schema/workout-sets";
import { garminAllowedFor } from "@/lib/garmin/access";
import { sampleDurations } from "@/lib/garmin/analytics/load";
import { isIndoor, sportOf } from "@/lib/garmin/analytics/sport";
import { planSport, rideTimeline, type RidePlan, type RideTimeline } from "@/lib/utils/ride-timeline";
import { runWindowValues } from "@/lib/utils/run-stream";
import {
  clipStreams,
  rideDoneChart,
  rideStreamNumbers,
  sampleIndices,
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
import { and, asc, eq, gte, ilike, inArray, lte, ne, or, sql } from "drizzle-orm";

/** An activity counts as the ride's when it overlaps it with this much to spare on either side (4.8). */
export const MATCH_TOLERANCE_MS = 5 * 60_000;
/** The worker looks for rides to fill this far back. */
const FILL_WINDOW_MS = 7 * 86_400_000;

type Ride = typeof rides.$inferSelect;
type Field = keyof WindowValues | "durationSeconds";

const INDOOR_FIELDS: Field[] = ["avgPower", "avgHr", "maxHr", "avgCadence"];
const OUTDOOR_FIELDS: Field[] = ["avgPower", "avgHr", "maxHr", "avgCadence", "distanceMeters", "avgSpeed", "climbM"];
/** A treadmill run: never power (R11); distance and speed only where the belt gave none (4.8). */
const TREADMILL_FIELDS: Field[] = ["avgHr", "maxHr", "avgCadence", "distanceMeters", "avgSpeed"];
/** An outdoor run; an estimate step also takes its time from its Garmin lap (4.8). */
const RUN_OUTDOOR_FIELDS: Field[] = ["durationSeconds", "avgHr", "maxHr", "avgCadence", "distanceMeters", "avgSpeed", "climbM"];

/**
 * What a fill replaced: per program set the old value and source of each field
 * it wrote, and the mode it corrected. `syncedAt` (a run's fill) is when the
 * activity's file was parsed: a newer parse is a re-sync (4.8).
 */
export type RideFillPrevious = {
  split: RideSplit["method"];
  steps: Record<string, Partial<Record<Field, { value: number | null; source: ResultSource | null }>>>;
  mode: { from: RideMode; to: RideMode; session: RideMode | null } | null;
  syncedAt?: number;
};

/**
 * A stored Garmin activity that may match a ride: its summary times, no
 * streams. `segment` is the part of a multisport file (0 for a one-sport
 * activity), `meters` its distance when Garmin has one.
 */
export type RideCandidate = { garminActivityId: number; segment: number; typeKey: string; startMs: number; endMs: number; meters: number | null };

/** A matched activity with its streams, as the fill and the summary read it. */
export type RideActivity = RideCandidate & {
  /** Stream time 0: the first record (since the parser keeps it), else the session start (the first timer start, the same second in Garmin's files). */
  t0Ms: number;
  streams: RideStreams;
  laps: FitLap[];
  events: FitEvent[];
  /** When the file was parsed (epoch ms): a run's fill re-reads a newer parse (4.8). */
  parsedAt: number;
  /** The parts of a multisport file in order, with their Garmin type; one part for a one-sport activity. */
  segments: { typeKey: string; startMs: number; seconds: number }[];
};

/** Indoor for an indoor or virtual ride, else outdoor (4.8). */
export function modeOfActivity(typeKey: string): RideMode {
  return isIndoor(typeKey) ? "indoor" : "outdoor";
}

const gmt = (v: unknown) => (typeof v === "string" ? Date.parse(`${v.replace(" ", "T")}Z`) : NaN);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Garmin's bike activity types, as `sportOf` reads them, so matching never reads a run or a swim. */
const bikeType = or(
  ilike(garminActivities.activityType, "%cycling%"),
  ilike(garminActivities.activityType, "%biking%"),
  ilike(garminActivities.activityType, "%bike%"),
  eq(garminActivities.activityType, "virtual_ride"),
);
/** Garmin's run types (running, treadmill, indoor, trail, track), as `sportOf` reads them. */
const runType = or(ilike(garminActivities.activityType, "%run%"), ilike(garminActivities.activityType, "%trail%"));
/** A multisport activity: its parts match by their own sport. */
const multiType = or(
  ilike(garminActivities.activityType, "%multi%"),
  ilike(garminActivities.activityType, "%triathlon%"),
  ilike(garminActivities.activityType, "%duathlon%"),
);

/** A FIT session's sport as a Garmin activity type, so `sportOf` and `isIndoor` read a part of a multisport file as they read an activity. */
export function segmentTypeKey(sport: unknown, subSport: unknown): string {
  const sp = typeof sport === "string" ? sport.toLowerCase() : "";
  const sub = typeof subSport === "string" ? subSport.toLowerCase() : "";
  if (sp === "running") {
    for (const k of ["treadmill", "indoor", "trail", "track"]) if (sub.includes(k)) return `${k}_running`;
    return "running";
  }
  if (sp === "cycling") return sub.includes("virtual") ? "virtual_ride" : sub.includes("indoor") ? "indoor_cycling" : "cycling";
  return sp || "other";
}

type StoredSegment = { sport?: unknown; subSport?: unknown; startTime?: unknown; totalElapsedTime?: unknown; totalDistance?: unknown };
/** A part of a multisport file and a one-sport activity this close at both ends are the same (Garmin may list a part as an activity too). */
const SAME_PART_MS = 60_000;
const streamOf = and(eq(garminActivityStreams.userId, garminActivities.userId), eq(garminActivityStreams.garminActivityId, garminActivities.garminActivityId));

/**
 * The user's stored Garmin activities of the ride's sport (a ride's bike
 * activities, a run's runs) with streams that overlap the ride (5 min
 * tolerance), from their summary and session times only. The parts of a
 * multisport file match one by one.
 */
export async function rideMatches(userId: string, ride: { startedAt: number; endedAt: number }, sport: RideSport = "bike"): Promise<RideCandidate[]> {
  // start_time_local is local time stored as UTC: a day either side covers every time zone.
  const rows = await db
    .select({
      garminActivityId: garminActivities.garminActivityId,
      typeKey: garminActivities.activityType,
      startGmt: sql<string | null>`${garminActivities.data}->>'startTimeGMT'`,
      elapsed: sql<number | null>`(${garminActivities.data}->>'elapsedDuration')::float8`,
      duration: sql<number | null>`(${garminActivities.data}->>'duration')::float8`,
      sessionStart: sql<string | null>`${garminActivityStreams.session}->>'startTime'`,
      sessionElapsed: sql<number | null>`(${garminActivityStreams.session}->>'totalElapsedTime')::float8`,
      meters: sql<number | null>`(${garminActivities.data}->>'distance')::float8`,
      segments: sql<StoredSegment[] | null>`${garminActivityStreams.session}->'segments'`,
    })
    .from(garminActivities)
    .innerJoin(garminActivityStreams, streamOf)
    .where(
      and(
        eq(garminActivities.userId, userId),
        or(sport === "run" ? runType : bikeType, multiType),
        gte(garminActivities.startTimeLocal, new Date(ride.startedAt - 86_400_000)),
        lte(garminActivities.startTimeLocal, new Date(ride.endedAt + 86_400_000)),
      ),
    )
    .orderBy(asc(garminActivities.startTimeLocal));
  const out: RideCandidate[] = [];
  const parts: RideCandidate[] = [];
  const overlaps = (startMs: number, endMs: number) => startMs - MATCH_TOLERANCE_MS < ride.endedAt && endMs + MATCH_TOLERANCE_MS > ride.startedAt;
  for (const r of rows) {
    const segs = Array.isArray(r.segments) && r.segments.length > 1 ? r.segments : null;
    if (segs) {
      segs.forEach((g, segment) => {
        const typeKey = segmentTypeKey(g.sport, g.subSport);
        const startMs = typeof g.startTime === "string" ? Date.parse(g.startTime) : NaN;
        const seconds = num(g.totalElapsedTime);
        if (sportOf(typeKey) !== sport || !Number.isFinite(startMs) || seconds === null) return;
        const endMs = startMs + seconds * 1000;
        if (overlaps(startMs, endMs)) parts.push({ garminActivityId: r.garminActivityId, segment, typeKey, startMs, endMs, meters: num(g.totalDistance) });
      });
      continue;
    }
    if (sportOf(r.typeKey) !== sport) continue;
    const startMs = r.sessionStart ? Date.parse(r.sessionStart) : gmt(r.startGmt);
    const seconds = num(r.sessionElapsed) ?? num(r.elapsed) ?? num(r.duration);
    if (!Number.isFinite(startMs) || seconds === null) continue;
    const endMs = startMs + seconds * 1000;
    if (overlaps(startMs, endMs)) out.push({ garminActivityId: r.garminActivityId, segment: 0, typeKey: r.typeKey, startMs, endMs, meters: num(r.meters) });
  }
  // A part Garmin also lists as an activity of its own is one match, not two.
  for (const p of parts) if (!out.some((o) => Math.abs(o.startMs - p.startMs) <= SAME_PART_MS && Math.abs(o.endMs - p.endMs) <= SAME_PART_MS)) out.push(p);
  return out.sort((a, b) => a.startMs - b.startMs);
}

/**
 * One matched activity with its streams, laps and timer events; null when its
 * streams are unusable. A part of a multisport file keeps only its own laps;
 * its streams stay whole, as the split reads them on the wall clock.
 */
export async function loadActivity(userId: string, c: RideCandidate): Promise<RideActivity | null> {
  const [r] = await db
    .select({
      streams: garminActivityStreams.streams,
      laps: garminActivityStreams.laps,
      events: garminActivityStreams.events,
      session: garminActivityStreams.session,
      parsedAt: garminActivityStreams.parsedAt,
    })
    .from(garminActivityStreams)
    .where(and(eq(garminActivityStreams.userId, userId), eq(garminActivityStreams.garminActivityId, c.garminActivityId)));
  const streams = (r?.streams ?? {}) as RideStreams;
  if (!r || !Array.isArray(streams.t)) return null;
  const session = (r.session ?? {}) as Record<string, unknown>;
  const events = Array.isArray(r.events) ? (r.events as FitEvent[]) : [];
  const first = typeof session.firstRecordTime === "string" ? Date.parse(session.firstRecordTime) : NaN;
  const stored = Array.isArray(session.segments) ? (session.segments as StoredSegment[]) : [];
  const segments =
    stored.length > 1
      ? stored.map((g) => ({ typeKey: segmentTypeKey(g.sport, g.subSport), startMs: typeof g.startTime === "string" ? Date.parse(g.startTime) : NaN, seconds: num(g.totalElapsedTime) ?? 0 }))
      : [{ typeKey: c.typeKey, startMs: c.startMs, seconds: (c.endMs - c.startMs) / 1000 }];
  const laps = Array.isArray(r.laps) ? (r.laps as FitLap[]) : [];
  return {
    ...c,
    t0Ms: Number.isFinite(first) ? first : c.startMs,
    streams,
    // A part's own laps: those that start inside it.
    laps: stored.length > 1 ? laps.filter((l) => { const at = typeof l.startTime === "string" ? Date.parse(l.startTime) : NaN; return at >= c.startMs && at < c.endMs; }) : laps,
    events,
    parsedAt: r.parsedAt.getTime(),
    segments,
  };
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
  return splitRide(timeline.steps, a.laps, a.events, a.t0Ms, timeline.pauses);
}

type FillResult = { status: "filled"; fields: number } | { status: "exists" } | { status: "not_ended" };

/**
 * A run's mode from its Garmin activity (4.8): a treadmill or indoor run is
 * the treadmill; outdoors only when the run's part of the stream has GPS
 * positions; else the run keeps its mode.
 */
export function runModeOf(a: Pick<RideActivity, "typeKey" | "streams">, windows: RideSplit["windows"], current: RideMode): RideMode {
  if (isIndoor(a.typeKey)) return "indoor";
  const lat = a.streams.lat;
  const gps = !!lat && windows.some((w) => sampleIndices(a.streams.t, w).some((i) => lat[i] !== null && lat[i] !== undefined));
  return gps ? "outdoor" : current;
}

/**
 * The fields one window fills on a row, with the value each takes: the
 * fields of the ride's sport and mode that are empty or clock-sourced (a run
 * that Garmin moves from the treadmill outdoors also takes over the belt's
 * distance and speed: GPS wins, 4.8). A treadmill step whose distance the
 * belt gave keeps its speed too. An outdoor estimate step takes its time from
 * its Garmin lap.
 */
function fillPatch(
  row: typeof workoutSets.$inferSelect,
  values: Partial<Record<Field, number | null>>,
  fields: Field[],
  opts: { run: boolean; beltOutdoors: boolean; treadmill: boolean; lapTime: boolean },
): Partial<Record<Field, number>> {
  const sources = row.sources ?? {};
  const fillable = (f: Field) => {
    const src = sources[f as keyof typeof sources] ?? null;
    if (row[f] === null || src === "clock") return true;
    return opts.beltOutdoors && src === "belt" && (f === "distanceMeters" || f === "avgSpeed");
  };
  const patch: Partial<Record<Field, number>> = {};
  for (const f of fields) {
    const v = values[f];
    if (v === null || v === undefined || !fillable(f)) continue;
    if (f === "durationSeconds" && !opts.lapTime) continue;
    if (opts.treadmill && f === "avgSpeed" && !fillable("distanceMeters")) continue;
    patch[f] = v;
  }
  return patch;
}

/** The values and the fields of one window for the ride's sport and mode. */
function windowFill(plan: RidePlan, a: RideActivity, w: RideSplit["windows"][number], split: RideSplit, mode: RideMode) {
  if (planSport(plan) !== "run") return { values: windowValues(a.streams, w, mode) as Partial<Record<Field, number | null>>, fields: mode === "indoor" ? INDOOR_FIELDS : OUTDOOR_FIELDS };
  const step = plan.steps.find((p) => p.programSetId === w.programSetId);
  const d = sampleDurations(a.streams.t);
  const lapTime = split.method === "laps" && step?.run?.rule === "estimate";
  return {
    values: {
      ...runWindowValues(a.streams, w, mode, d),
      // The lap's moving time: Garmin's pauses inside it are gaps in the stream.
      durationSeconds: lapTime ? Math.round(sampleIndices(a.streams.t, w).reduce((s, i) => s + d[i], 0)) : null,
    } as Partial<Record<Field, number | null>>,
    fields: mode === "indoor" ? TREADMILL_FIELDS : RUN_OUTDOOR_FIELDS,
    lapTime,
  };
}

/**
 * Fill the ride's steps from one activity. Writes only empty or clock-sourced
 * fields; a pair already filled or declined, or a ride with a fill standing
 * (the partial unique index), writes nothing. `ex` may be an open transaction:
 * the fill then runs in a savepoint of it.
 */
export async function fillRide(userId: string, ride: Ride, a: RideActivity, timeline?: RideTimeline, ex: Pick<typeof db, "transaction"> = db): Promise<FillResult> {
  const t = timeline ?? (await timelineOf(ride));
  if (!ended(t)) return { status: "not_ended" };
  const plan = ride.plan as RidePlan;
  const run = planSport(plan) === "run";
  const split = rideSplit(t, a);
  const mode = run ? runModeOf(a, split.windows, plan.mode) : modeOfActivity(a.typeKey);

  return ex.transaction(async (tx) => {
    // One fill at a time per ride: the worker and a Pick wait for each other here.
    await tx.select({ id: rides.id }).from(rides).where(eq(rides.id, ride.id)).for("update");
    const [fill] = await tx
      .insert(rideGarminFills)
      .values({ userId, rideId: ride.id, garminActivityId: a.garminActivityId, segment: a.segment, previous: {} })
      .onConflictDoNothing()
      .returning({ id: rideGarminFills.id });
    if (!fill) return { status: "exists" } as const;

    const previous: RideFillPrevious = { split: split.method, steps: {}, mode: null, ...(run && { syncedAt: a.parsedAt }) };
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
      const { values, fields, lapTime = false } = windowFill(plan, a, w, split, mode);
      const patch = fillPatch(row, values, fields, { run, beltOutdoors: run && mode === "outdoor" && plan.mode === "indoor", treadmill: run && mode === "indoor", lapTime });
      if (!Object.keys(patch).length) continue;
      const sources = { ...(row.sources ?? {}) };
      const prev: RideFillPrevious["steps"][string] = {};
      for (const f of Object.keys(patch) as Field[]) {
        prev[f] = { value: row[f], source: sources[f as keyof typeof sources] ?? null };
        sources[f as keyof typeof sources] = "garmin";
      }
      written += Object.keys(patch).length;
      previous.steps[w.programSetId] = prev;
      await tx
        .update(workoutSets)
        .set({ ...patch, sources })
        .where(eq(workoutSets.id, row.id));
    }

    if (plan.mode !== mode) {
      // A run keeps its mode on its ride only (docs/plans/run-logger.md, step 0): its workout's ride_mode is the bike screen's.
      const [s] = run ? [] : await tx.select({ rideMode: workoutSessions.rideMode }).from(workoutSessions).where(eq(workoutSessions.id, ride.sessionId));
      previous.mode = { from: plan.mode, to: mode, session: s?.rideMode ?? null };
      await setRideMode(tx, ride, mode, run ? undefined : mode);
    }
    await tx.update(rideGarminFills).set({ previous }).where(eq(rideGarminFills.id, fill.id));
    return { status: "filled", fields: written } as const;
  });
}

/**
 * A re-sync of a run's activity (4.8): Garmin's treadmill calibration changes
 * the distance after the run, and the file is parsed again. Rewrites only the
 * fields still marked Garmin (a value typed over since stays), on a fill that
 * stands; a declined pair is never touched.
 */
export async function refreshRunFill(ride: Ride, fillId: number, a: RideActivity, t: RideTimeline): Promise<number> {
  const plan = ride.plan as RidePlan;
  const split = rideSplit(t, a);
  return db.transaction(async (tx) => {
    await tx.select({ id: rides.id }).from(rides).where(eq(rides.id, ride.id)).for("update");
    const [fill] = await tx.select().from(rideGarminFills).where(and(eq(rideGarminFills.id, fillId), eq(rideGarminFills.declined, false))).for("update");
    if (!fill) return 0;
    const previous = fill.previous as RideFillPrevious;
    const ids = split.windows.map((w) => w.programSetId);
    const rows = ids.length ? await tx.select().from(workoutSets).where(and(eq(workoutSets.sessionId, ride.sessionId), inArray(workoutSets.programSetId, ids))).for("update") : [];
    let written = 0;
    for (const w of split.windows) {
      const row = rows.find((r) => r.programSetId === w.programSetId);
      if (!row) continue;
      const { values, fields } = windowFill(plan, a, w, split, plan.mode);
      const sources = row.sources ?? {};
      const patch: Partial<Record<Field, number>> = {};
      for (const f of fields) {
        const v = values[f];
        if (sources[f as keyof typeof sources] !== "garmin" || v === null || v === undefined || v === row[f]) continue;
        patch[f] = v;
      }
      if (!Object.keys(patch).length) continue;
      written += Object.keys(patch).length;
      await tx.update(workoutSets).set(patch).where(eq(workoutSets.id, row.id));
    }
    await tx.update(rideGarminFills).set({ previous: { ...previous, syncedAt: a.parsedAt } }).where(eq(rideGarminFills.id, fill.id));
    return written;
  });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The ride's mode on the ride, its frozen plan and (a ride's) workout (D6: the Garmin activity type corrects it). A run's workout is not touched (`sessionMode` undefined). */
async function setRideMode(tx: Tx, ride: Ride, mode: RideMode, sessionMode: RideMode | null | undefined) {
  await tx
    .update(rides)
    .set({ mode, plan: sql`jsonb_set(${rides.plan}, '{mode}', to_jsonb(${mode}::text))` })
    .where(eq(rides.id, ride.id));
  if (sessionMode === undefined) return;
  await tx.update(workoutSessions).set({ rideMode: sessionMode }).where(and(eq(workoutSessions.id, ride.sessionId), eq(workoutSessions.userId, ride.userId)));
}

/**
 * After a Garmin import: fill each of the user's rides and runs of the last 7
 * days that has ended, has no fill yet and exactly one matching activity of
 * its sport whose pair the user has not declined. A run whose fill stands is
 * filled again where its activity was parsed again since (a re-sync, 4.8).
 * Garmin access only. A ride that fails is logged and the others go on.
 */
export async function fillRidesFromGarmin(userId: string, now = Date.now()): Promise<number> {
  if (!(await garminAllowedFor(userId))) return 0;
  const recent = await db
    .select()
    .from(rides)
    .where(and(eq(rides.userId, userId), ne(rides.status, "ready"), gte(rides.startedAt, new Date(now - FILL_WINDOW_MS))));
  if (!recent.length) return 0;
  const fills = await db
    .select({ id: rideGarminFills.id, rideId: rideGarminFills.rideId, garminActivityId: rideGarminFills.garminActivityId, segment: rideGarminFills.segment, declined: rideGarminFills.declined, previous: rideGarminFills.previous })
    .from(rideGarminFills)
    .where(inArray(rideGarminFills.rideId, recent.map((r) => r.id)));
  let filled = 0;
  for (const ride of recent) {
    const mine = fills.filter((f) => f.rideId === ride.id);
    const sport = planSport(ride.plan as RidePlan);
    const standing = mine.find((f) => !f.declined);
    try {
      if (standing) {
        if (sport === "run") await resyncRun(userId, ride, standing);
        continue;
      }
      const t = await timelineOf(ride);
      if (!ended(t)) continue;
      const matches = await rideMatches(userId, { startedAt: t.startedAt!, endedAt: t.endedAt! }, sport);
      // Two or more wait for a pick; a declined pair waits for "Fill from Garmin".
      if (matches.length !== 1 || mine.some((f) => f.garminActivityId === matches[0].garminActivityId && f.segment === matches[0].segment)) continue;
      const a = await loadActivity(userId, matches[0]);
      if (!a) continue;
      const r = await fillRide(userId, ride, a, t);
      if (r.status === "filled") filled++;
    } catch (e) {
      console.error("[fillRidesFromGarmin] failed", { rideId: ride.id }, e instanceof Error ? e.message : "unknown");
    }
  }
  return filled;
}

/** A run's standing fill, filled again when its activity was parsed after the fill (4.8). Reads the streams only then. */
async function resyncRun(userId: string, ride: Ride, fill: { id: number; garminActivityId: number; segment: number; previous: unknown }) {
  const [p] = await db
    .select({ parsedAt: garminActivityStreams.parsedAt })
    .from(garminActivityStreams)
    .where(and(eq(garminActivityStreams.userId, userId), eq(garminActivityStreams.garminActivityId, fill.garminActivityId)));
  const syncedAt = (fill.previous as RideFillPrevious).syncedAt ?? 0;
  if (!p || p.parsedAt.getTime() <= syncedAt) return;
  const t = await timelineOf(ride);
  if (!ended(t)) return;
  const c = (await rideMatches(userId, { startedAt: t.startedAt!, endedAt: t.endedAt! }, "run")).find((m) => m.garminActivityId === fill.garminActivityId && m.segment === fill.segment);
  const a = c ? await loadActivity(userId, c) : null;
  if (a) await refreshRunFill(ride, fill.id, a, t);
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
    const run = planSport(ride.plan as RidePlan) === "run";
    if (previous.mode && (ride.plan as RidePlan).mode === previous.mode.to) await setRideMode(tx, ride, previous.mode.from, run ? undefined : previous.mode.session);
    await tx.update(rideGarminFills).set({ declined: true }).where(eq(rideGarminFills.id, fill.id));
    return true;
  });
}

/**
 * Fill the ride (or run) from an activity the user picked: one of two or more
 * matches, or the one match after an Undo ("Fill from Garmin"). `segment` is
 * the part of a multisport file. The check, the removal of a declined marker
 * for that pair and the fill are one transaction, so a failure keeps the
 * marker and a worker fill cannot slip in between.
 */
export async function pickRideActivity(
  userId: string,
  rideId: number,
  garminActivityId: number,
  segment = 0,
): Promise<"filled" | "not_found" | "already_filled" | "already_filled_run"> {
  let already: "already_filled" | "already_filled_run" = "already_filled";
  return db.transaction(async (tx) => {
    const [ride] = await tx.select().from(rides).where(and(eq(rides.id, rideId), eq(rides.userId, userId))).for("update");
    if (!ride) return "not_found";
    if (planSport(ride.plan as RidePlan) === "run") already = "already_filled_run";
    const t = await timelineOf(ride);
    if (!ended(t)) return "not_found";
    const fills = await tx.select().from(rideGarminFills).where(eq(rideGarminFills.rideId, rideId));
    if (fills.some((f) => !f.declined)) return already;
    const c = (await rideMatches(userId, { startedAt: t.startedAt!, endedAt: t.endedAt! }, planSport(ride.plan as RidePlan))).find(
      (m) => m.garminActivityId === garminActivityId && m.segment === segment,
    );
    const a = c ? await loadActivity(userId, c) : null;
    if (!a) return "not_found";
    await tx
      .delete(rideGarminFills)
      .where(and(eq(rideGarminFills.rideId, rideId), eq(rideGarminFills.garminActivityId, garminActivityId), eq(rideGarminFills.segment, segment)));
    const r = await fillRide(userId, ride, a, t, tx);
    if (r.status !== "filled") throw new PickRace();
    return "filled";
  }).catch((e) => {
    if (e instanceof PickRace) return already;
    throw e;
  });
}

/** A fill landed between the check and the insert: roll the pick back. */
class PickRace extends Error {}

// ── Reading ──────────────────────────────────────────────────────────────────

export type RideGarminView = {
  /**
   * "filled": a fill stands (Undo); "pick": two or more activities match and
   * none fills; "refill": the one match was undone ("Fill from Garmin");
   * "none": nothing to show.
   */
  state: "filled" | "pick" | "refill" | "none";
  garminActivityId: number | null;
  /** Any fill of this ride was undone. */
  declined: boolean;
  /** The activities to pick from ("pick"), or the one to fill again ("refill"). A run's also have their part of a multisport file and their distance. */
  candidates: { garminActivityId: number; startMs: number; seconds: number; segment?: number; meters?: number | null }[];
  /** The stream numbers and chart of the filled activity, from the ride's own part of it. */
  stream: { split: RideSplit["method"]; numbers: StreamNumbers; chart: DoneChart | null } | null;
};

const NONE: RideGarminView = { state: "none", garminActivityId: null, declined: false, candidates: [], stream: null };

/**
 * The Garmin state of an ended ride or run (Garmin access checked by the
 * caller): its standing fill with the activity loaded, the matches to pick
 * from, or the one to fill again. Streams are read only for the filled one.
 */
export async function garminFillState(userId: string, ride: Ride, t: RideTimeline) {
  const run = planSport(ride.plan as RidePlan) === "run";
  const fills = await db.select().from(rideGarminFills).where(eq(rideGarminFills.rideId, ride.id));
  const active = fills.find((f) => !f.declined) ?? null;
  const declined = fills.some((f) => f.declined);
  const matches = await rideMatches(userId, { startedAt: t.startedAt!, endedAt: t.endedAt! }, run ? "run" : "bike");
  const listed = (ms: RideCandidate[]): RideGarminView["candidates"] =>
    ms.map((m) => ({
      garminActivityId: m.garminActivityId,
      startMs: m.startMs,
      seconds: Math.round((m.endMs - m.startMs) / 1000),
      ...(run && { segment: m.segment, meters: m.meters }),
    }));
  if (active) {
    const c = matches.find((m) => m.garminActivityId === active.garminActivityId && m.segment === active.segment) ?? null;
    const a = c ? await loadActivity(userId, c) : null;
    return { state: "filled" as const, garminActivityId: active.garminActivityId, declined, candidates: [], activity: a };
  }
  if (matches.length >= 2) return { state: "pick" as const, garminActivityId: null, declined, candidates: listed(matches), activity: null };
  if (matches.length === 1 && fills.some((f) => f.declined && f.garminActivityId === matches[0].garminActivityId && f.segment === matches[0].segment)) {
    return { state: "refill" as const, garminActivityId: null, declined, candidates: listed(matches), activity: null };
  }
  return { state: "none" as const, garminActivityId: null, declined, candidates: [], activity: null };
}

/** An ended ride or run of the user with its timeline; null when it is not the user's or has not ended. */
export async function endedRideOf(userId: string, rideId: number, sport: RideSport): Promise<{ ride: Ride; t: RideTimeline } | null> {
  const [ride] = await db.select().from(rides).where(and(eq(rides.id, rideId), eq(rides.userId, userId), eq(rides.sport, sport)));
  if (!ride) return null;
  const t = await timelineOf(ride);
  return ended(t) ? { ride, t } : null;
}

/** The ride's Garmin state for the summary and get_ride. Garmin access only; else nothing. Streams are read only for the filled activity. */
export async function rideGarminView(userId: string, rideId: number): Promise<RideGarminView> {
  if (!(await garminAllowedFor(userId))) return NONE;
  const found = await endedRideOf(userId, rideId, "bike");
  if (!found) return NONE;
  const { ride, t } = found;
  const g = await garminFillState(userId, ride, t);
  const a = g.activity;
  if (g.state !== "filled" || !a) return { state: g.state, garminActivityId: g.garminActivityId, declined: g.declined, candidates: g.candidates, stream: null };
  const plan = ride.plan as RidePlan;
  const split = rideSplit(t, a);
  const ftp = plan.thresholds.ftp ?? null;
  // The ride's own part of the activity: from its first step's start to its last step's end.
  const streams = split.windows.length ? clipStreams(a.streams, split.windows[0].from, split.windows.at(-1)!.to) : a.streams;
  return {
    state: "filled",
    garminActivityId: a.garminActivityId,
    declined: g.declined,
    candidates: [],
    stream: {
      split: split.method,
      numbers: rideStreamNumbers(streams, plan.steps, split.windows, { ftp, lthr: plan.thresholds.lthr_bike ?? null, mode: plan.mode }),
      chart: rideDoneChart(streams, plan.steps, split, ftp),
    },
  };
}
