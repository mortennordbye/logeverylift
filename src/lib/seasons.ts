/**
 * Seasons, races and phases (docs/plans/seasons.md): one module for the app's
 * Server Actions and the MCP tools. Plain server code that takes a resolved
 * userId and a write context. Every write goes through the revision layer as
 * object type `season` (and `cycle` for the phases it changes), so each change
 * can be seen and undone, and assistant writes join the assistant's review.
 *
 * Races and phase types are endurance fields (D18): writing them needs the
 * endurance switch. Seasons themselves are for everyone (D22).
 */

import { db } from "@/db";
import { racePlans, seasonRaces, seasons, trainingCycles, type PhaseType, type RaceDiscipline, type RacePriority, type TriDistance } from "@/db/schema";
import { enduranceEnabledFor } from "@/lib/endurance";
import {
  PlanNotFoundError,
  PlanStateError,
  activateInSession,
  chainSeason,
  liveSeasonId,
  lockCycleRows,
  releaseSeasonPhases,
  planWrite,
  seasonPhases,
  versionKey,
  type PlanWriteContext,
  type PlanWriteSession,
} from "@/lib/plan-revisions";
import { userToday } from "@/lib/user-settings";
import { toDateStr, weeksForDays } from "@/lib/utils/cycle-position";
import {
  fitTaperChange,
  nextPhase,
  replanReason,
  seasonARace,
  seasonTimeline,
  taperDaysFor,
  taperFit,
  type RaceLike,
  type TaperFit,
  type TimelinePhase,
} from "@/lib/utils/seasons";
import { SEASON_MAX_PHASES } from "@/lib/utils/seasons";
import { and, asc, desc, eq, isNotNull, isNull, or } from "drizzle-orm";

export const SEASON_TEXT_MAX = 500;
export const PHASE_MAX_WEEKS = 52;
export const PHASE_MAX_DAYS = 364;
/** A season holds at most this many races and phases, so the read tool stays small. */
export const SEASON_MAX_RACES = 20;
export { SEASON_MAX_PHASES } from "@/lib/utils/seasons";
/** A new phase with no length given. */
export const DEFAULT_PHASE_WEEKS = 4;

export const RACES_OFF =
  "Races are part of the endurance features, which are off for this account. An admin can turn them on.";
export const PHASE_TYPE_OFF =
  "Phase types are part of the endurance features, which are off for this account. An admin can turn them on.";

type Season = typeof seasons.$inferSelect;
type Race = typeof seasonRaces.$inferSelect;

async function today(userId: string): Promise<string> {
  return toDateStr(await userToday(userId));
}

// ── Reads ────────────────────────────────────────────────────────────────────

export type SeasonStatus = "planned" | "active" | "done";

export function seasonStatus(s: Pick<Season, "startDate" | "endDate">, day: string): SeasonStatus {
  return day < s.startDate ? "planned" : day > s.endDate ? "done" : "active";
}

export type SeasonSummary = Season & {
  status: SeasonStatus;
  aRace: Race | null;
  phaseCount: number;
  currentPhase: string | null;
};

/** The user's live seasons, newest start first. */
export async function listSeasons(userId: string): Promise<SeasonSummary[]> {
  const rows = await db
    .select()
    .from(seasons)
    .where(and(eq(seasons.userId, userId), isNull(seasons.deletedAt)))
    .orderBy(desc(seasons.startDate), desc(seasons.id));
  if (rows.length === 0) return [];
  const day = await today(userId);
  const races = await db.select().from(seasonRaces).where(eq(seasonRaces.userId, userId));
  const phases = await db
    .select({ seasonId: trainingCycles.seasonId, name: trainingCycles.name, status: trainingCycles.status })
    .from(trainingCycles)
    .where(and(eq(trainingCycles.userId, userId), isNull(trainingCycles.deletedAt)));
  return rows.map((s) => {
    const mine = phases.filter((p) => p.seasonId === s.id);
    return {
      ...s,
      status: seasonStatus(s, day),
      aRace: seasonARace(races.filter((r) => r.seasonId === s.id), day),
      phaseCount: mine.length,
      currentPhase: mine.find((p) => p.status === "active")?.name ?? null,
    };
  });
}

export type SeasonDetail = {
  season: Season;
  status: SeasonStatus;
  races: Race[];
  phases: (TimelinePhase & { version: number })[];
  aRace: Race | null;
  /** Default taper length for the A race, in days. */
  taperDays: number | null;
  taperFit: TaperFit;
  /** The phase that starts next, and whether it is scheduled. Not scheduled = the chain is paused (2.4). */
  next: { cycleId: number; name: string; plannedStart: string; scheduled: boolean } | null;
  /** Days of the season before the first phase starts, and days the last phase runs past the end. */
  gapBefore: number;
  overrunAfter: number;
  replan: { flagged: boolean; since: Date | null; reason: string | null };
};

const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** One of the user's live seasons with its races, its phase timeline and the taper fit. Null if not found. */
export async function getSeasonDetail(userId: string, seasonId: number): Promise<SeasonDetail | null> {
  const [season] = await db
    .select()
    .from(seasons)
    .where(and(eq(seasons.id, seasonId), eq(seasons.userId, userId), isNull(seasons.deletedAt)));
  if (!season) return null;
  const day = await today(userId);
  const races = await db
    .select()
    .from(seasonRaces)
    .where(eq(seasonRaces.seasonId, seasonId))
    .orderBy(asc(seasonRaces.raceDate), asc(seasonRaces.id));
  const rows = await seasonPhases(db, seasonId);
  const versions = new Map(rows.map((r) => [r.id, r.version]));
  const timeline = seasonTimeline(season.startDate, rows).map((p) => ({ ...p, version: versions.get(p.id) ?? 1 }));
  const aRace = seasonARace(races, day);
  const next = nextPhase(timeline);
  return {
    season,
    status: seasonStatus(season, day),
    races,
    phases: timeline,
    aRace,
    taperDays: aRace ? taperDaysFor(aRace) : null,
    taperFit: taperFit(timeline, aRace),
    next: next ? { cycleId: next.id, name: next.name, plannedStart: next.start, scheduled: next.scheduledStartDate != null } : null,
    gapBefore: timeline.length ? Math.max(0, dayDiff(season.startDate, timeline[0].start)) : 0,
    overrunAfter: timeline.length ? Math.max(0, dayDiff(season.endDate, timeline.at(-1)!.end)) : 0,
    replan: { flagged: season.replanFlaggedAt != null, since: season.replanFlaggedAt, reason: season.replanReason },
  };
}

/** The user's live cycles in no live season: what "Add phase" can pick. */
export async function seasonlessCycles(userId: string) {
  return db
    .select({ id: trainingCycles.id, name: trainingCycles.name, status: trainingCycles.status })
    .from(trainingCycles)
    // plan-read: includes deleted (seasons: a phase of a deleted season counts as free)
    .leftJoin(seasons, eq(seasons.id, trainingCycles.seasonId))
    .where(
      and(
        eq(trainingCycles.userId, userId),
        isNull(trainingCycles.deletedAt),
        or(isNull(trainingCycles.seasonId), isNotNull(seasons.deletedAt)),
      ),
    )
    .orderBy(desc(trainingCycles.createdAt));
}

/** The season a cycle is a phase of, with its races, for the cycle page. Null when it is in no live season. */
export async function seasonOfCycle(userId: string, cycle: { id: number; seasonId: number | null }) {
  if (cycle.seasonId == null) return null;
  const detail = await getSeasonDetail(userId, cycle.seasonId);
  if (!detail) return null;
  const position = detail.phases.findIndex((p) => p.id === cycle.id);
  return { id: detail.season.id, name: detail.season.name, position: position + 1, phaseCount: detail.phases.length, races: detail.races, replan: detail.replan };
}

// ── The race a cycle reads (2.7, D8) ─────────────────────────────────────────

export type CycleRace = {
  name: string;
  raceDate: string;
  discipline: RaceDiscipline;
  distance: TriDistance | null;
  distanceMeters: number | null;
  priority: RacePriority;
  /** Where the race lives: the cycle's season, or the cycle itself (a cycle in no season). */
  source: "season" | "cycle";
  seasonId: number | null;
};

/**
 * The single reader of a cycle's race: the season's A race (the next one on or
 * after today, else the last) when the cycle is a phase of a live season, else
 * the cycle's own race fields. Null when there is none. Every reader of "the
 * race" (Garmin's race views, the intake interview in package C3) uses this.
 */
export async function raceForCycle(
  userId: string,
  cycle: { seasonId: number | null; raceDate: string | null; raceDistance: "full" | "half" | null },
): Promise<CycleRace | null> {
  if (cycle.seasonId != null) {
    const [season] = await db
      .select({ id: seasons.id })
      .from(seasons)
      .where(and(eq(seasons.id, cycle.seasonId), eq(seasons.userId, userId), isNull(seasons.deletedAt)));
    if (season) {
      const races = await db.select().from(seasonRaces).where(eq(seasonRaces.seasonId, season.id));
      const a = seasonARace(races, await today(userId));
      return a
        ? {
            name: a.name,
            raceDate: a.raceDate,
            discipline: a.discipline,
            distance: a.distance,
            distanceMeters: a.distanceMeters,
            priority: a.priority,
            source: "season",
            seasonId: season.id,
          }
        : null;
    }
  }
  if (!cycle.raceDate) return null;
  return {
    name: "Race",
    raceDate: cycle.raceDate,
    discipline: "triathlon",
    distance: cycle.raceDistance,
    distanceMeters: null,
    priority: "A",
    source: "cycle",
    seasonId: null,
  };
}

/** The first day of the taper phase the season's A race uses, or null with no taper or no A race. */
export async function seasonTaperStart(userId: string, seasonId: number): Promise<string | null> {
  const detail = await getSeasonDetail(userId, seasonId);
  if (!detail || detail.taperFit.status === "no_race" || detail.taperFit.status === "no_taper") return null;
  const id = detail.taperFit.taperId;
  return detail.phases.find((p) => p.id === id)?.start ?? null;
}

/** The race of the user's active cycle (raceForCycle), or null with no active cycle or no race. */
export async function activeCycleRace(userId: string): Promise<CycleRace | null> {
  const [cycle] = await db
    .select({ seasonId: trainingCycles.seasonId, raceDate: trainingCycles.raceDate, raceDistance: trainingCycles.raceDistance })
    .from(trainingCycles)
    .where(and(eq(trainingCycles.userId, userId), eq(trainingCycles.status, "active"), isNull(trainingCycles.deletedAt)))
    .orderBy(desc(trainingCycles.createdAt))
    .limit(1);
  return cycle ? raceForCycle(userId, cycle) : null;
}

// ── Season writes ────────────────────────────────────────────────────────────

export type SeasonInput = {
  name: string;
  goal?: string | null;
  startDate: string;
  endDate: string;
  nextGoal?: string | null;
};

function checkDates(start: string, end: string) {
  if (end < start) throw new PlanStateError("The season must end on or after its start.");
}

export async function createSeason(ctx: PlanWriteContext, input: SeasonInput) {
  checkDates(input.startDate, input.endDate);
  const { result } = await planWrite(ctx, async (w) => {
    const [row] = await w.tx
      .insert(seasons)
      .values({
        userId: ctx.userId,
        name: input.name,
        goal: input.goal ?? null,
        startDate: input.startDate,
        endDate: input.endDate,
        nextGoal: input.nextGoal ?? null,
      })
      .returning();
    w.create({ type: "season", id: row.id });
    return row;
  });
  return { season: result, version: 1 };
}

export type SeasonPatch = Partial<SeasonInput>;

async function lockedSeason(w: PlanWriteSession, seasonId: number, expectedVersion?: number): Promise<Season> {
  await w.touch({ type: "season", id: seasonId }, { expectedVersion });
  // Then its phases in id order, the lock order restores use too.
  await lockCycleRows(w.tx, (await seasonPhases(w.tx, seasonId)).map((p) => p.id));
  const [row] = await w.tx.select().from(seasons).where(and(eq(seasons.id, seasonId), isNull(seasons.deletedAt)));
  return row;
}

function seasonVersion(versions: Map<string, number>, seasonId: number) {
  return versions.get(versionKey({ type: "season", id: seasonId })) ?? null;
}

export async function updateSeason(ctx: PlanWriteContext, seasonId: number, patch: SeasonPatch, expectedVersion?: number) {
  const { result, versions } = await planWrite(ctx, async (w) => {
    const current = await lockedSeason(w, seasonId, expectedVersion);
    const set: Partial<typeof seasons.$inferInsert> = { updatedAt: new Date() };
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.goal !== undefined) set.goal = patch.goal;
    if (patch.nextGoal !== undefined) set.nextGoal = patch.nextGoal;
    if (patch.startDate !== undefined) set.startDate = patch.startDate;
    if (patch.endDate !== undefined) set.endDate = patch.endDate;
    checkDates(set.startDate ?? current.startDate, set.endDate ?? current.endDate);
    const [row] = await w.tx.update(seasons).set(set).where(eq(seasons.id, seasonId)).returning();
    // A new start can move when the first phase is due.
    if (set.startDate !== undefined) await chainSeason(w, seasonId);
    return row;
  });
  return { season: result, version: seasonVersion(versions, seasonId) };
}

/**
 * Soft delete a season. Its cycles stay (owner decision 3) and act as cycles
 * with no season until the season is restored or purged: each gets the
 * season's A race back as its own, and the chained start of the next phase
 * is dropped (releaseSeasonPhases).
 */
export async function deleteSeason(ctx: PlanWriteContext, seasonId: number, expectedVersion?: number) {
  await planWrite(ctx, async (w) => {
    await w.touch({ type: "season", id: seasonId }, { action: "delete", expectedVersion });
    await releaseSeasonPhases(w, seasonId);
    await w.tx.update(seasons).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(seasons.id, seasonId));
  });
}

/** "Mark as re-planned": clear the flag a race change set (D17). */
export async function clearReplan(ctx: PlanWriteContext, seasonId: number, expectedVersion?: number) {
  const { result, versions } = await planWrite(ctx, async (w) => {
    const current = await lockedSeason(w, seasonId, expectedVersion);
    // No flag: nothing to clear, no revision, no new version.
    if (!current.replanFlaggedAt) return current.version;
    await w.tx
      .update(seasons)
      .set({ replanFlaggedAt: null, replanReason: null, updatedAt: new Date() })
      .where(eq(seasons.id, seasonId));
    return null;
  });
  return { version: result ?? seasonVersion(versions, seasonId) };
}

// ── Races (2.6, 2.7) ─────────────────────────────────────────────────────────

export type RaceInput = {
  name: string;
  raceDate: string;
  discipline: RaceDiscipline;
  distance?: TriDistance | null;
  distanceMeters?: number | null;
  priority: RacePriority;
};

function cleanRace(r: RaceInput): RaceInput {
  return {
    ...r,
    distance: r.discipline === "triathlon" ? (r.distance ?? null) : null,
    distanceMeters: r.discipline === "triathlon" ? null : (r.distanceMeters ?? null),
  };
}

/** Run a race write: lock the season, apply it, and flag the season when the change needs a re-plan. */
async function raceWrite<T>(
  ctx: PlanWriteContext,
  seasonId: number,
  expectedVersion: number | undefined,
  fn: (w: PlanWriteSession) => Promise<T>,
) {
  if (!(await enduranceEnabledFor(ctx.userId))) throw new PlanStateError(RACES_OFF);
  const { result, versions } = await planWrite(ctx, async (w) => {
    await lockedSeason(w, seasonId, expectedVersion);
    const before = (await w.tx.select().from(seasonRaces).where(eq(seasonRaces.seasonId, seasonId))) as RaceLike[];
    const out = await fn(w);
    const after = (await w.tx.select().from(seasonRaces).where(eq(seasonRaces.seasonId, seasonId))) as RaceLike[];
    const reason = replanReason(before, after);
    if (reason) {
      await w.tx
        .update(seasons)
        .set({ replanFlaggedAt: new Date(), replanReason: reason, updatedAt: new Date() })
        .where(eq(seasons.id, seasonId));
    }
    return { out, replanFlagged: reason };
  });
  return { ...result, version: seasonVersion(versions, seasonId) };
}

export async function addRace(ctx: PlanWriteContext, seasonId: number, input: RaceInput, expectedVersion?: number) {
  return raceWrite(ctx, seasonId, expectedVersion, async (w) => {
    const existing = await w.tx.select({ id: seasonRaces.id }).from(seasonRaces).where(eq(seasonRaces.seasonId, seasonId));
    if (existing.length >= SEASON_MAX_RACES) throw new PlanStateError(`A season holds at most ${SEASON_MAX_RACES} races.`);
    const [row] = await w.tx
      .insert(seasonRaces)
      .values({ ...cleanRace(input), seasonId, userId: ctx.userId })
      .returning();
    return row;
  });
}

async function ownRace(w: PlanWriteSession, seasonId: number, raceId: number): Promise<Race> {
  const [row] = await w.tx
    .select()
    .from(seasonRaces)
    .where(and(eq(seasonRaces.id, raceId), eq(seasonRaces.seasonId, seasonId)));
  if (!row) throw new PlanStateError("Race not found in this season.");
  return row;
}

export async function updateRace(
  ctx: PlanWriteContext,
  seasonId: number,
  raceId: number,
  patch: Partial<RaceInput>,
  expectedVersion?: number,
) {
  return raceWrite(ctx, seasonId, expectedVersion, async (w) => {
    const current = await ownRace(w, seasonId, raceId);
    const merged = cleanRace({
      name: patch.name ?? current.name,
      raceDate: patch.raceDate ?? current.raceDate,
      discipline: patch.discipline ?? current.discipline,
      distance: patch.distance !== undefined ? patch.distance : current.distance,
      distanceMeters: patch.distanceMeters !== undefined ? patch.distanceMeters : current.distanceMeters,
      priority: patch.priority ?? current.priority,
    });
    const [row] = await w.tx.update(seasonRaces).set(merged).where(eq(seasonRaces.id, raceId)).returning();
    return row;
  });
}

export async function removeRace(ctx: PlanWriteContext, seasonId: number, raceId: number, expectedVersion?: number) {
  return raceWrite(ctx, seasonId, expectedVersion, async (w) => {
    await ownRace(w, seasonId, raceId);
    await w.tx.delete(seasonRaces).where(eq(seasonRaces.id, raceId));
    // Its race plan stays, hidden, until a season restore brings the race back;
    // the purge counts from now (docs/plans/nutrition-and-race-day.md, 3).
    await w.tx.update(racePlans).set({ orphanedAt: new Date() }).where(and(eq(racePlans.seasonRaceId, raceId), eq(racePlans.userId, ctx.userId)));
    return null;
  });
}

// ── Phases (2.4) ─────────────────────────────────────────────────────────────

export type PhaseLength = { durationWeeks?: number; durationDays?: number | null };

/** The weeks and days columns for a length: days win, and set weeks to the weeks they span. */
function lengthColumns(len: PhaseLength): { durationWeeks: number; durationDays: number | null } | null {
  if (len.durationDays != null) {
    if (!Number.isInteger(len.durationDays) || len.durationDays < 1 || len.durationDays > PHASE_MAX_DAYS) {
      throw new PlanStateError(`A phase is 1 to ${PHASE_MAX_DAYS} days.`);
    }
    return { durationWeeks: weeksForDays(len.durationDays), durationDays: len.durationDays };
  }
  if (len.durationWeeks != null) {
    if (!Number.isInteger(len.durationWeeks) || len.durationWeeks < 1 || len.durationWeeks > PHASE_MAX_WEEKS) {
      throw new PlanStateError(`A phase is 1 to ${PHASE_MAX_WEEKS} weeks.`);
    }
    return { durationWeeks: len.durationWeeks, durationDays: null };
  }
  return null;
}

async function checkPhaseType(userId: string, phaseType: PhaseType | null | undefined) {
  if (phaseType != null && !(await enduranceEnabledFor(userId))) throw new PlanStateError(PHASE_TYPE_OFF);
}

/** Give the season's phases the order of `ids` (1-based), touching only the cycles whose position changes. */
async function renumber(w: PlanWriteSession, ids: number[], current: Map<number, number | null>) {
  for (const [i, id] of ids.entries()) {
    if (current.get(id) === i + 1) continue;
    await w.touch({ type: "cycle", id });
    await w.tx.update(trainingCycles).set({ phaseOrder: i + 1 }).where(eq(trainingCycles.id, id));
  }
}

async function orderedPhaseIds(w: PlanWriteSession, seasonId: number) {
  const rows = await seasonPhases(w.tx, seasonId);
  return { ids: rows.map((r) => r.id), current: new Map(rows.map((r) => [r.id, r.phaseOrder])) };
}

function place(ids: number[], id: number, position: number | undefined): number[] {
  const rest = ids.filter((x) => x !== id);
  const at = position == null ? rest.length : Math.max(0, Math.min(rest.length, position - 1));
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

export type AddPhaseInput = PhaseLength & {
  /** An existing cycle that is in no season, or a new draft with `name`. */
  cycleId?: number;
  cycleVersion?: number;
  name?: string;
  scheduleType?: "day_of_week" | "rotation";
  /** 1-based position; the end when omitted. */
  position?: number;
  phaseType?: PhaseType | null;
};

export type PhaseResult = {
  cycleId: number;
  seasonVersion: number | null;
  cycleVersion: number | null;
  /** The cycle's own race moved to the season as an A race (D8). */
  raceMoved: boolean;
};

/**
 * Add a phase: an existing cycle joins the season, or a new draft cycle is
 * made in it. The cycle's own race moves to the season (one home, D8).
 */
export async function addPhase(ctx: PlanWriteContext, seasonId: number, input: AddPhaseInput, expectedVersion?: number): Promise<PhaseResult> {
  await checkPhaseType(ctx.userId, input.phaseType);
  if (input.cycleId == null && !input.name) throw new PlanStateError("Give a cycleId to add an existing cycle, or a name for a new one.");
  const len = lengthColumns(input);
  const { result, versions } = await planWrite(ctx, async (w) => {
    await lockedSeason(w, seasonId, expectedVersion);
    const { ids, current } = await orderedPhaseIds(w, seasonId);
    if (ids.length >= SEASON_MAX_PHASES) throw new PlanStateError(`A season holds at most ${SEASON_MAX_PHASES} phases.`);
    let cycleId: number;
    let raceMoved = false;
    if (input.cycleId != null) {
      cycleId = input.cycleId;
      await w.touch({ type: "cycle", id: cycleId }, { expectedVersion: input.cycleVersion });
      const [cycle] = await w.tx.select().from(trainingCycles).where(and(eq(trainingCycles.id, cycleId), isNull(trainingCycles.deletedAt)));
      // A phase of a deleted season is free to join another (owner decision 3).
      if ((await liveSeasonId(w.tx, cycle.seasonId)) != null) {
        throw new PlanStateError(cycle.seasonId === seasonId ? "This cycle is already a phase of this season." : "This cycle is a phase of another season. Remove it there first.");
      }
      if (cycle.raceDate) {
        const [same] = await w.tx
          .select({ id: seasonRaces.id })
          .from(seasonRaces)
          .where(and(eq(seasonRaces.seasonId, seasonId), eq(seasonRaces.raceDate, cycle.raceDate)));
        if (!same) {
          await w.tx.insert(seasonRaces).values({
            seasonId,
            userId: ctx.userId,
            name: "Race",
            raceDate: cycle.raceDate,
            discipline: "triathlon",
            distance: cycle.raceDistance,
            priority: "A",
          });
        }
        raceMoved = true;
      }
      await w.tx
        .update(trainingCycles)
        .set({
          seasonId,
          raceDate: null,
          raceDistance: null,
          ...(input.phaseType !== undefined ? { phaseType: input.phaseType } : {}),
          ...(len ?? {}),
        })
        .where(eq(trainingCycles.id, cycleId));
    } else {
      let cols = len;
      if (!cols && input.phaseType === "taper") {
        // A taper with no length gets the A race's default (2.5).
        const races = await w.tx.select().from(seasonRaces).where(eq(seasonRaces.seasonId, seasonId));
        const a = seasonARace(races, await today(ctx.userId));
        if (a) cols = lengthColumns({ durationDays: taperDaysFor(a) });
      }
      cols ??= { durationWeeks: DEFAULT_PHASE_WEEKS, durationDays: null };
      const [row] = await w.tx
        .insert(trainingCycles)
        .values({
          userId: ctx.userId,
          name: input.name!,
          scheduleType: input.scheduleType ?? "day_of_week",
          seasonId,
          phaseType: input.phaseType ?? null,
          ...cols,
        })
        .returning({ id: trainingCycles.id });
      cycleId = row.id;
      w.create({ type: "cycle", id: cycleId });
    }
    const order = place(ids, cycleId, input.position);
    // The new phase has no position yet; renumber gives it one.
    current.set(cycleId, null);
    await renumber(w, order, current);
    await chainSeason(w, seasonId);
    return { cycleId, raceMoved };
  });
  return {
    ...result,
    seasonVersion: seasonVersion(versions, seasonId),
    cycleVersion: versions.get(versionKey({ type: "cycle", id: result.cycleId })) ?? null,
  };
}

async function phaseOf(w: PlanWriteSession, seasonId: number, cycleId: number, cycleVersion?: number) {
  await w.touch({ type: "cycle", id: cycleId }, { expectedVersion: cycleVersion });
  const [cycle] = await w.tx.select().from(trainingCycles).where(and(eq(trainingCycles.id, cycleId), isNull(trainingCycles.deletedAt)));
  if (cycle.seasonId !== seasonId) throw new PlanStateError("This cycle is not a phase of this season.");
  return cycle;
}

function phaseResult(versions: Map<string, number>, seasonId: number, cycleId: number): PhaseResult {
  return {
    cycleId,
    seasonVersion: seasonVersion(versions, seasonId),
    cycleVersion: versions.get(versionKey({ type: "cycle", id: cycleId })) ?? null,
    raceMoved: false,
  };
}

/** Take a cycle out of the season. It becomes a cycle with no season and no race; its whole curve applies again. */
export async function removePhase(ctx: PlanWriteContext, seasonId: number, cycleId: number, expectedVersion?: number, cycleVersion?: number) {
  const { versions } = await planWrite(ctx, async (w) => {
    await lockedSeason(w, seasonId, expectedVersion);
    const cycle = await phaseOf(w, seasonId, cycleId, cycleVersion);
    await w.tx
      .update(trainingCycles)
      .set({
        seasonId: null,
        phaseOrder: null,
        phaseType: null,
        // A start the chain scheduled is the season's, not the cycle's.
        ...(cycle.status === "draft" ? { scheduledStartDate: null } : {}),
      })
      .where(eq(trainingCycles.id, cycleId));
    const { ids, current } = await orderedPhaseIds(w, seasonId);
    await renumber(w, ids, current);
    await chainSeason(w, seasonId);
  });
  return phaseResult(versions, seasonId, cycleId);
}

/** Move a phase to a 1-based position. */
export async function movePhase(
  ctx: PlanWriteContext,
  seasonId: number,
  cycleId: number,
  position: number,
  expectedVersion?: number,
  cycleVersion?: number,
) {
  const { versions } = await planWrite(ctx, async (w) => {
    await lockedSeason(w, seasonId, expectedVersion);
    await phaseOf(w, seasonId, cycleId, cycleVersion);
    const { ids, current } = await orderedPhaseIds(w, seasonId);
    await renumber(w, place(ids, cycleId, position), current);
    await chainSeason(w, seasonId);
  });
  return phaseResult(versions, seasonId, cycleId);
}

/** Change a phase's type or length. */
export async function setPhase(
  ctx: PlanWriteContext,
  seasonId: number,
  cycleId: number,
  change: PhaseLength & { phaseType?: PhaseType | null },
  expectedVersion?: number,
  cycleVersion?: number,
) {
  await checkPhaseType(ctx.userId, change.phaseType);
  const len = lengthColumns(change);
  if (!len && change.phaseType === undefined) throw new PlanStateError("Nothing to change: give phaseType, durationWeeks or durationDays.");
  const { versions } = await planWrite(ctx, async (w) => {
    await lockedSeason(w, seasonId, expectedVersion);
    await phaseOf(w, seasonId, cycleId, cycleVersion);
    await w.tx
      .update(trainingCycles)
      .set({
        ...(change.phaseType !== undefined ? { phaseType: change.phaseType } : {}),
        ...(len ?? {}),
        // A new curve or length re-derives this week's targets.
        lastSyncedWeek: null,
      })
      .where(eq(trainingCycles.id, cycleId));
    await chainSeason(w, seasonId);
  });
  return phaseResult(versions, seasonId, cycleId);
}

/** "Fit taper": change the length of the phase before the taper so the taper ends on the A race day (2.5). */
export async function fitTaper(ctx: PlanWriteContext, seasonId: number, expectedVersion?: number) {
  const detail = await getSeasonDetail(ctx.userId, seasonId);
  if (!detail) throw new PlanNotFoundError({ type: "season", id: seasonId });
  const change = fitTaperChange(detail.phases, detail.aRace, await today(ctx.userId));
  if (typeof change === "string") throw new PlanStateError(change);
  const done = await setPhase(ctx, seasonId, change.cycleId, { durationDays: change.durationDays }, expectedVersion);
  return { ...done, durationDays: change.durationDays };
}

/**
 * Pick the chain up again after a cycle outside the season ran (2.4): the next
 * phase starts today when its planned day has come, else it is scheduled.
 */
export async function resumeSeason(ctx: PlanWriteContext, seasonId: number, expectedVersion?: number) {
  const day = await today(ctx.userId);
  const { result, versions } = await planWrite(ctx, async (w) => {
    // The season is locked and checked first; the resume is its own revision.
    const season = await lockedSeason(w, seasonId, expectedVersion);
    await w.touch({ type: "season", id: seasonId }, { force: true });
    const next = nextPhase(seasonTimeline(season.startDate, await seasonPhases(w.tx, seasonId)));
    if (!next) throw new PlanStateError("The season has no phase left to start.");
    if (next.start <= day) {
      await activateInSession(w, next.id, day);
      return { cycleId: next.id, startsOn: day };
    }
    // Schedule it: one cycle is scheduled at a time, so any other start is dropped.
    const others = await w.tx
      .select({ id: trainingCycles.id })
      .from(trainingCycles)
      .where(
        and(
          eq(trainingCycles.userId, ctx.userId),
          isNotNull(trainingCycles.scheduledStartDate),
          isNull(trainingCycles.deletedAt),
        ),
      );
    for (const o of others.filter((o) => o.id !== next.id)) {
      await w.touch({ type: "cycle", id: o.id });
      await w.tx.update(trainingCycles).set({ scheduledStartDate: null }).where(eq(trainingCycles.id, o.id));
    }
    await w.touch({ type: "cycle", id: next.id });
    await w.tx.update(trainingCycles).set({ scheduledStartDate: next.start }).where(eq(trainingCycles.id, next.id));
    return { cycleId: next.id, startsOn: next.start };
  });
  return { ...result, version: seasonVersion(versions, seasonId) };
}
