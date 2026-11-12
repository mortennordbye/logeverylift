/**
 * The athlete profile, thresholds and injuries (docs/plans/athlete-profile.md;
 * decisions D10, D12, D15, D18, T5, T10): one module for the app's Server
 * Actions and the MCP tools. Plain server code that takes a resolved userId.
 *
 * Every write goes through the revision layer (object types athlete,
 * threshold, injury), so each change can be seen and undone, and assistant
 * writes join the rest of the assistant's review.
 *
 * Gates: thresholds are for every user (D15, owner 2026-11-12). The profile,
 * injuries and the interview need the endurance switch (D18); the write
 * functions here check it, so no caller can skip it.
 */

import { db } from "@/db";
import {
  athleteInjuries,
  athleteProfiles,
  athleteThresholds,
  coachMemory,
  planRevisions,
  trainingCycles,
  type EnduranceLevel,
  type InjuryArea,
  type InjurySide,
  type InjuryStatus,
  type PlanObjectType,
  type StrengthGoal,
  type ThresholdKind,
  type ThresholdProtocol,
  type ThresholdSource,
} from "@/db/schema";
import { changeCoachMemory } from "@/lib/coach-memory";
import { enduranceEnabledFor } from "@/lib/endurance";
import { garminAllowedFor } from "@/lib/garmin/access";
import {
  ENDURANCE_OFF,
  PlanConflictError,
  PlanNotFoundError,
  PlanStateError,
  assertAthleteRoom,
  planWrite,
  restoreRevision,
  versionKey,
  type PlanWriteContext,
} from "@/lib/plan-revisions";
import { raceForCycle } from "@/lib/seasons";
import { userToday } from "@/lib/user-settings";
import { cycleWeek, parseDateStr, toDateStr } from "@/lib/utils/cycle-position";
import { cycleLoad, type TrainingPhase } from "@/lib/utils/periodization";
import { DELETED_PLAN_RETENTION_DAYS } from "@/lib/utils/plan-revisions";
import { agreesWithTest, currentThresholds, testInputs, thresholdRangeError, valueFromTest } from "@/lib/utils/thresholds";
import { and, desc, eq, gt, inArray, isNotNull, isNull, sql } from "drizzle-orm";

export type AthleteProfile = typeof athleteProfiles.$inferSelect;
export type ThresholdRow = typeof athleteThresholds.$inferSelect;
export type InjuryRow = typeof athleteInjuries.$inferSelect;

export const INJURY_TEXT_MAX = 500;
export const INJURY_AVOID_MAX = 300;
export const THRESHOLD_NOTES_MAX = 500;
/** The reason on a coach memory entry the interview moved to the profile. */
export const MOVED_REASON = "Moved to the athlete profile by the intake interview";


async function requireEndurance(userId: string) {
  if (!(await enduranceEnabledFor(userId))) throw new PlanStateError(ENDURANCE_OFF);
}

// ── Reads ────────────────────────────────────────────────────────────────────

/** The user's live profile, or null before the first answer. */
export async function getAthleteProfile(userId: string): Promise<AthleteProfile | null> {
  const [row] = await db
    .select()
    .from(athleteProfiles)
    .where(and(eq(athleteProfiles.userId, userId), isNull(athleteProfiles.deletedAt)));
  return row ?? null;
}

/** Live thresholds, newest first. */
export async function listThresholds(userId: string): Promise<ThresholdRow[]> {
  return db
    .select()
    .from(athleteThresholds)
    .where(and(eq(athleteThresholds.userId, userId), isNull(athleteThresholds.deletedAt)))
    .orderBy(desc(athleteThresholds.measuredOn), desc(athleteThresholds.id));
}

/** Live injuries, active and managed first, newest first. Past ones only when asked. */
export async function listInjuries(userId: string, includePast = true): Promise<InjuryRow[]> {
  const rows = await db
    .select()
    .from(athleteInjuries)
    .where(and(eq(athleteInjuries.userId, userId), isNull(athleteInjuries.deletedAt)))
    .orderBy(desc(athleteInjuries.id));
  const rank: Record<InjuryStatus, number> = { active: 0, managed: 1, past: 2 };
  return rows.filter((r) => includePast || r.status !== "past").sort((a, b) => rank[a.status] - rank[b.status]);
}

const deletedSince = () => new Date(Date.now() - DELETED_PLAN_RETENTION_DAYS * 86_400_000);

/** Thresholds the user deleted and can still restore (90 days), newest first. */
export async function listDeletedThresholds(userId: string) {
  return db
    .select()
    .from(athleteThresholds)
    .where(and(eq(athleteThresholds.userId, userId), isNotNull(athleteThresholds.deletedAt), gt(athleteThresholds.deletedAt, deletedSince())))
    .orderBy(desc(athleteThresholds.deletedAt));
}

/** Injuries the user deleted and can still restore (90 days), newest first. */
export async function listDeletedInjuries(userId: string) {
  return db
    .select()
    .from(athleteInjuries)
    .where(and(eq(athleteInjuries.userId, userId), isNotNull(athleteInjuries.deletedAt), gt(athleteInjuries.deletedAt, deletedSince())))
    .orderBy(desc(athleteInjuries.deletedAt));
}

export type InterviewRace = { date: string | null; distance: "full" | "half" | null; cycleId: number; cycleName: string };

/**
 * The race the interview shows. The only place C3 reads a race. For a phase
 * of a season it is the season's A race, through C1's single race reader
 * (raceForCycle, docs/plans/seasons.md, 2.7); a cycle in no season shows its
 * own race fields, as before.
 */
export async function interviewRace(userId: string): Promise<InterviewRace | null> {
  const [cycle] = await db
    .select({
      id: trainingCycles.id,
      name: trainingCycles.name,
      seasonId: trainingCycles.seasonId,
      raceDate: trainingCycles.raceDate,
      raceDistance: trainingCycles.raceDistance,
    })
    .from(trainingCycles)
    .where(and(eq(trainingCycles.userId, userId), eq(trainingCycles.status, "active"), isNull(trainingCycles.deletedAt)))
    .limit(1);
  if (!cycle) return null;
  if (cycle.seasonId != null) {
    const race = await raceForCycle(userId, cycle);
    if (!race) return null;
    const distance = race.discipline === "triathlon" && (race.distance === "full" || race.distance === "half") ? race.distance : null;
    return { date: race.raceDate, distance, cycleId: cycle.id, cycleName: cycle.name };
  }
  if (!cycle.raceDate && !cycle.raceDistance) return null;
  return { date: cycle.raceDate, distance: cycle.raceDistance, cycleId: cycle.id, cycleName: cycle.name };
}

/**
 * The phase the active cycle is in this week (base, build, peak, taper or
 * maintain, or general prep and transition for a typed phase of a season),
 * for the strength default. Null with no active cycle. A phase of a season
 * reads its phase type (cycleLoad, docs/plans/seasons.md, 2.5).
 */
export async function activeCyclePhase(userId: string): Promise<TrainingPhase | null> {
  const [cycle] = await db
    .select({
      startDate: trainingCycles.startDate,
      durationWeeks: trainingCycles.durationWeeks,
      durationDays: trainingCycles.durationDays,
      goal: trainingCycles.goal,
      athleteLevel: trainingCycles.athleteLevel,
      phaseType: trainingCycles.phaseType,
    })
    .from(trainingCycles)
    .where(and(eq(trainingCycles.userId, userId), eq(trainingCycles.status, "active"), isNull(trainingCycles.deletedAt)))
    .limit(1);
  if (!cycle?.startDate) return null;
  const { currentWeek } = cycleWeek(parseDateStr(cycle.startDate), cycle.durationWeeks, await userToday(userId), cycle.durationDays);
  return cycleLoad({ ...cycle, goal: cycle.goal ?? "build" }, currentWeek, cycle.durationWeeks).phase;
}

/** Active coach memory entries the interview offers to move (kinds limit and observation). */
export async function memoryToOffer(userId: string) {
  return db
    .select({ id: coachMemory.id, kind: coachMemory.kind, text: coachMemory.text, entryDate: coachMemory.entryDate, version: coachMemory.version })
    .from(coachMemory)
    .where(
      and(
        eq(coachMemory.userId, userId),
        isNull(coachMemory.deletedAt),
        eq(coachMemory.active, true),
        inArray(coachMemory.kind, ["limit", "observation"]),
      ),
    )
    .orderBy(desc(coachMemory.entryDate), desc(coachMemory.id));
}

export type InterviewStep = "race" | "experience" | "availability" | "strength" | "thresholds";

/** Interview steps with no answer yet. Injuries have no "unanswered" state: none is an answer. */
export function missingSteps(
  profile: AthleteProfile | null,
  thresholds: ThresholdRow[],
  race: InterviewRace | null,
): InterviewStep[] {
  const out: InterviewStep[] = [];
  if (!race) out.push("race");
  if (!profile?.enduranceLevel) out.push("experience");
  if (!profile?.availableDays?.length || profile.hoursPerWeek == null) out.push("availability");
  if (!profile?.strengthGoal) out.push("strength");
  if (thresholds.length === 0) out.push("thresholds");
  return out;
}

// ── Garmin suggestions (admins only, D12) ────────────────────────────────────

export type ThresholdSuggestion = { kind: ThresholdKind; value: number; weekStart: string; basis: string };

/**
 * The Garmin estimate per kind, as a suggestion next to the stored value.
 * Only where Garmin is allowed (admins with the key set). Nothing is stored
 * until the user or assistant takes it. No swim CSS: no estimate exists.
 */
export async function garminSuggestions(userId: string, stored?: ThresholdRow[]): Promise<ThresholdSuggestion[]> {
  if (!(await garminAllowedFor(userId))) return [];
  const { getTrendsData } = await import("@/lib/garmin/queries");
  const { thresholdHistory } = await import("@/lib/garmin/analytics/trends");
  const { addDays } = await import("@/lib/garmin/dates");
  const trends = await getTrendsData(userId);
  if (trends.acts.length === 0) return [];
  const lastDay = trends.acts.reduce((m, a) => (a.day > m ? a.day : m), trends.acts[0].day);
  const th = thresholdHistory(trends.acts, addDays(lastDay, -6), lastDay).at(-1);
  const out: ThresholdSuggestion[] = [];
  const push = (kind: ThresholdKind, value: number | null | undefined, basis: string) => {
    if (value != null && Number.isFinite(value) && value > 0 && !thresholdRangeError(kind, value)) {
      out.push({ kind, value, weekStart: th?.weekStart ?? lastDay, basis });
    }
  };
  if (th) {
    push("ftp", th.ftp, "your rides, last 90 days");
    push("lthr_bike", th.lthrBike ?? th.watchLthr, th.lthrBike ? "your rides, last 90 days" : "your watch");
    push("lthr_run", th.lthrRun ?? th.watchLthr, th.lthrRun ? "your runs, last 90 days" : "your watch");
    push("run_threshold_pace", th.cs != null ? Math.round(th.cs * 1000) / 1000 : null, "critical speed from your runs, last 90 days");
  }
  const maxHr = [...trends.acts].reverse().find((a) => a.watchMaxHr)?.watchMaxHr;
  push("max_hr", maxHr, "your watch");

  const current = currentThresholds(stored ?? (await listThresholds(userId)));
  return out.filter((s) => {
    const c = current[s.kind];
    if (!c) return true;
    const same = s.kind === "run_threshold_pace" ? Math.abs(c.value - s.value) < 0.005 : Math.round(c.value) === Math.round(s.value);
    if (same) return false;
    // A field test from the estimate's week or later beats the estimate.
    return !(c.source === "test" && c.measuredOn >= s.weekStart);
  });
}

// ── Profile writes ───────────────────────────────────────────────────────────

export type ProfileChange = {
  enduranceLevel?: EnduranceLevel | null;
  availableDays?: number[] | null;
  hoursPerWeek?: number | null;
  longestDayMinutes?: number | null;
  longDay?: number | null;
  strengthGoal?: StrengthGoal | null;
  completeInterview?: boolean;
};

/**
 * Set any profile fields. Creates the profile on the first write. Throws
 * PlanConflictError on a stale version, PlanStateError with the switch off.
 */
export async function saveAthleteProfile(ctx: PlanWriteContext, change: ProfileChange, expectedVersion?: number) {
  await requireEndurance(ctx.userId);
  const set: Partial<typeof athleteProfiles.$inferInsert> = {};
  for (const k of ["enduranceLevel", "availableDays", "hoursPerWeek", "longestDayMinutes", "longDay", "strengthGoal"] as const) {
    if (change[k] !== undefined) (set as Record<string, unknown>)[k] = change[k];
  }
  if (set.availableDays) set.availableDays = [...new Set(set.availableDays)].sort((a, b) => a - b);
  if (change.completeInterview) set.interviewCompletedAt = new Date();
  const { result, versions } = await planWrite(ctx, async (w) => {
    // One profile per user: two first writes must not both insert.
    await w.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`athlete_profile:${ctx.userId}`}))`);
    const [existing] = await w.tx
      // plan-read: includes deleted (a profile cleared by an undo comes back, so the one-per-user index holds)
      .select()
      .from(athleteProfiles)
      .where(eq(athleteProfiles.userId, ctx.userId));
    if (!existing) {
      if (expectedVersion !== undefined && expectedVersion !== 1) {
        throw new PlanStateError("No athlete profile yet: leave out expectedVersion for the first write");
      }
      const [row] = await w.tx
        .insert(athleteProfiles)
        .values({ userId: ctx.userId, ...set })
        .returning();
      w.create({ type: "athlete", id: row.id });
      return row;
    }
    if (existing.deletedAt) {
      // Cleared by an undo of its creation: it starts again empty.
      await w.touch({ type: "athlete", id: existing.id }, { allowDeleted: true });
      const [row] = await w.tx
        .update(athleteProfiles)
        .set({
          enduranceLevel: null,
          availableDays: null,
          hoursPerWeek: null,
          longestDayMinutes: null,
          longDay: null,
          strengthGoal: null,
          interviewCompletedAt: null,
          ...set,
          deletedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(athleteProfiles.id, existing.id))
        .returning();
      return row;
    }
    await w.touch({ type: "athlete", id: existing.id }, { expectedVersion });
    const [row] = await w.tx
      .update(athleteProfiles)
      .set({ ...set, updatedAt: new Date() })
      .where(eq(athleteProfiles.id, existing.id))
      .returning();
    return row;
  });
  return { profile: result, version: versions.get(versionKey({ type: "athlete", id: result.id })) ?? result.version };
}

// ── Threshold writes ─────────────────────────────────────────────────────────

export type ThresholdInput = {
  kind: ThresholdKind;
  /** Stored metric value; may be left out when a test gives it. */
  value?: number;
  measuredOn?: string;
  source: ThresholdSource;
  protocol?: ThresholdProtocol | null;
  testData?: Record<string, unknown> | null;
  notes?: string | null;
};

/** The value to store, from the typed value or the test, checked against the range. */
export function resolveThresholdValue(input: Pick<ThresholdInput, "kind" | "value" | "protocol" | "testData">): number {
  let value = input.value;
  if (input.protocol) {
    if (!input.testData) throw new PlanStateError("testData is required with a protocol");
    const t = valueFromTest(input.kind, input.protocol, input.testData);
    if ("error" in t) throw new PlanStateError(t.error);
    if (value != null && !agreesWithTest(value, t.value)) {
      throw new PlanStateError(`The value does not match the test: the test gives ${t.value}`);
    }
    value = t.value;
  }
  if (value == null) throw new PlanStateError("A value or a field test is required");
  const err = thresholdRangeError(input.kind, value);
  if (err) throw new PlanStateError(err);
  return value;
}

/** A threshold's date may not be after today in the user's zone: a future row would stay current. */
async function assertNotFuture(userId: string, measuredOn: string) {
  if (measuredOn > toDateStr(await userToday(userId))) throw new PlanStateError("The date is after today");
}

export async function addThreshold(ctx: PlanWriteContext, input: ThresholdInput) {
  const value = resolveThresholdValue(input);
  if (input.source === "test" && !input.protocol) throw new PlanStateError("A field test needs its protocol");
  const measuredOn = input.measuredOn ?? toDateStr(await userToday(ctx.userId));
  await assertNotFuture(ctx.userId, measuredOn);
  const { result, versions } = await planWrite(ctx, async (w) => {
    await assertAthleteRoom(w.tx, ctx.userId, "threshold", input.kind);
    const [row] = await w.tx
      .insert(athleteThresholds)
      .values({
        userId: ctx.userId,
        kind: input.kind,
        value,
        measuredOn,
        source: input.source,
        protocol: input.protocol ?? null,
        // Only the test's own inputs; anything else the caller sent is not kept.
        testData: input.protocol && input.testData ? testInputs(input.kind, input.protocol, input.testData) : null,
        notes: input.notes ?? null,
      })
      .returning();
    w.create({ type: "threshold", id: row.id });
    return row;
  });
  return { threshold: result, version: versions.get(versionKey({ type: "threshold", id: result.id })) ?? 1 };
}

export type ThresholdChange = Partial<Omit<ThresholdInput, "kind">>;

/** Update or soft delete one threshold. Throws PlanNotFoundError, PlanConflictError or PlanStateError. */
export async function changeThreshold(ctx: PlanWriteContext, id: number, change: ThresholdChange | "delete", expectedVersion?: number) {
  if (change !== "delete" && change.measuredOn) await assertNotFuture(ctx.userId, change.measuredOn);
  const { result, versions } = await planWrite(ctx, async (w) => {
    if (change === "delete") {
      await w.touch({ type: "threshold", id }, { action: "delete", expectedVersion });
      await w.tx.update(athleteThresholds).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(athleteThresholds.id, id));
      return null;
    }
    await w.touch({ type: "threshold", id }, { expectedVersion });
    const [cur] = await w.tx
      // plan-read: includes deleted (touch above refused a deleted row)
      .select()
      .from(athleteThresholds)
      .where(eq(athleteThresholds.id, id));
    const protocol = change.protocol !== undefined ? change.protocol : cur.protocol;
    const testData = change.testData !== undefined ? change.testData : (cur.testData as Record<string, unknown> | null);
    const set: Partial<typeof athleteThresholds.$inferInsert> = { updatedAt: new Date() };
    if (change.value !== undefined || change.protocol !== undefined || change.testData !== undefined) {
      set.value = resolveThresholdValue({
        kind: cur.kind,
        value: change.value ?? (change.protocol !== undefined || change.testData !== undefined ? undefined : cur.value),
        protocol,
        testData,
      });
      set.protocol = protocol ?? null;
      set.testData = protocol && testData ? testInputs(cur.kind, protocol, testData) : null;
    }
    if (change.measuredOn !== undefined) set.measuredOn = change.measuredOn;
    if (change.source !== undefined) set.source = change.source;
    if (change.notes !== undefined) set.notes = change.notes;
    if ((set.source ?? cur.source) === "test" && !(set.protocol !== undefined ? set.protocol : cur.protocol)) {
      throw new PlanStateError("A field test needs its protocol");
    }
    const [row] = await w.tx.update(athleteThresholds).set(set).where(eq(athleteThresholds.id, id)).returning();
    return row;
  });
  return { threshold: result, version: versions.get(versionKey({ type: "threshold", id })) ?? null };
}

// ── Injury writes ────────────────────────────────────────────────────────────

export type InjuryInput = {
  area: InjuryArea;
  side?: InjurySide | null;
  description: string;
  avoid?: string | null;
  status: InjuryStatus;
  startedOn?: string | null;
  endedOn?: string | null;
};

export async function addInjury(ctx: PlanWriteContext, input: InjuryInput) {
  await requireEndurance(ctx.userId);
  const { result, versions } = await planWrite(ctx, async (w) => {
    await assertAthleteRoom(w.tx, ctx.userId, "injury");
    const [row] = await w.tx
      .insert(athleteInjuries)
      .values({
        userId: ctx.userId,
        area: input.area,
        side: input.side ?? null,
        description: input.description,
        avoid: input.avoid ?? null,
        status: input.status,
        startedOn: input.startedOn ?? null,
        endedOn: input.endedOn ?? null,
      })
      .returning();
    w.create({ type: "injury", id: row.id });
    return row;
  });
  return { injury: result, version: versions.get(versionKey({ type: "injury", id: result.id })) ?? 1 };
}

/** Update or soft delete one injury. */
export async function changeInjury(ctx: PlanWriteContext, id: number, change: Partial<InjuryInput> | "delete", expectedVersion?: number) {
  await requireEndurance(ctx.userId);
  const { result, versions } = await planWrite(ctx, async (w) => {
    if (change === "delete") {
      await w.touch({ type: "injury", id }, { action: "delete", expectedVersion });
      await w.tx.update(athleteInjuries).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(athleteInjuries.id, id));
      return null;
    }
    await w.touch({ type: "injury", id }, { expectedVersion });
    const set: Partial<typeof athleteInjuries.$inferInsert> = { updatedAt: new Date() };
    for (const k of ["area", "side", "description", "avoid", "status", "startedOn", "endedOn"] as const) {
      if (change[k] !== undefined) (set as Record<string, unknown>)[k] = change[k];
    }
    const [row] = await w.tx.update(athleteInjuries).set(set).where(eq(athleteInjuries.id, id)).returning();
    return row;
  });
  return { injury: result, version: versions.get(versionKey({ type: "injury", id })) ?? null };
}

// ── Restore and the memory move ──────────────────────────────────────────────

/** Bring a deleted threshold or injury back from the revision of its delete. Null when there is none. */
export async function restoreDeletedAthleteRow(ctx: PlanWriteContext, type: "threshold" | "injury", id: number) {
  if (type === "injury") await requireEndurance(ctx.userId);
  const since = new Date(Date.now() - DELETED_PLAN_RETENTION_DAYS * 86_400_000);
  const table = type === "threshold" ? athleteThresholds : athleteInjuries;
  const [row] = await db
    .select({ deletedAt: table.deletedAt })
    .from(table)
    .where(and(eq(table.id, id), eq(table.userId, ctx.userId), gt(table.deletedAt, since)));
  if (!row?.deletedAt) return null;
  const [rev] = await db
    .select({ id: planRevisions.id })
    .from(planRevisions)
    .where(
      and(
        eq(planRevisions.userId, ctx.userId),
        eq(planRevisions.objectType, type as PlanObjectType),
        eq(planRevisions.objectId, id),
        eq(planRevisions.action, "delete"),
      ),
    )
    .orderBy(desc(planRevisions.id))
    .limit(1);
  if (!rev) return null;
  return restoreRevision(ctx, rev.id);
}

/**
 * The interview's "Moved": the user restated a coach memory entry in the
 * profile, so the entry goes out of use. Only limit and observation entries.
 */
export async function moveMemoryEntry(ctx: PlanWriteContext, id: number, expectedVersion?: number) {
  await requireEndurance(ctx.userId);
  const [entry] = await db
    .select({ kind: coachMemory.kind, active: coachMemory.active })
    .from(coachMemory)
    .where(and(eq(coachMemory.id, id), eq(coachMemory.userId, ctx.userId), isNull(coachMemory.deletedAt)));
  if (!entry) throw new PlanNotFoundError({ type: "memory", id });
  if (entry.kind !== "limit" && entry.kind !== "observation") {
    throw new PlanStateError("Only limit and observation entries move to the athlete profile");
  }
  return changeCoachMemory({ ...ctx, reason: ctx.reason ?? MOVED_REASON }, id, { active: false }, expectedVersion);
}

export { PlanConflictError, PlanNotFoundError, PlanStateError };
