/**
 * Race-day plans on the server (docs/plans/nutrition-and-race-day.md, 4 and
 * 8). The stored row holds only the inputs (race_plans.plan); the timeline,
 * pacing and fuel schedule are worked out on read from the race, the current
 * thresholds, the athlete profile, body weight, sweat tests and fuel logs, so a
 * retest changes the plan at once. Every write is a revision (object type
 * `race_plan`). Callers resolve the user and check the endurance switch.
 */

import { db } from "@/db";
import { athleteProfiles, racePlans, seasonRaces, seasons } from "@/db/schema";
import { listThresholds } from "@/lib/athlete-profile";
import { latestWeightKg, nutritionSummary } from "@/lib/nutrition";
import { planWrite, PlanConflictError, PlanNotFoundError, PlanStateError, type PlanWriteContext } from "@/lib/plan-revisions";
import { userToday } from "@/lib/user-settings";
import { toDateStr } from "@/lib/utils/cycle-position";
import { caffeinePlan, FLUID_SAFETY, NUTRITION_DISCLAIMER, raceMorning } from "@/lib/utils/fueling";
import { ASSUMED_SPEED, fuelRates, legLimitError, fuelSchedule, fuelTotals, LEG_METERS, racePlan, type PlanDistance } from "@/lib/utils/race-plan";
import { currentThresholds } from "@/lib/utils/thresholds";
import { racePlanInput, type RacePlanInput } from "@/lib/validators/nutrition";
import { and, asc, eq, gte, isNull, sql } from "drizzle-orm";

export const RACE_PLAN_DISTANCE_OFF = "Race plans cover half and full distance triathlons for now.";

export type PlanRace = { id: number; seasonId: number; name: string; raceDate: string; priority: string; distance: string | null; discipline: string };

/** One of the user's races on a live season, or null. */
export async function ownedRace(userId: string, raceId: number): Promise<PlanRace | null> {
  const [r] = await db
    .select({
      id: seasonRaces.id,
      seasonId: seasonRaces.seasonId,
      name: seasonRaces.name,
      raceDate: seasonRaces.raceDate,
      priority: seasonRaces.priority,
      distance: seasonRaces.distance,
      discipline: seasonRaces.discipline,
    })
    .from(seasonRaces)
    .innerJoin(seasons, and(eq(seasons.id, seasonRaces.seasonId), isNull(seasons.deletedAt)))
    .where(and(eq(seasonRaces.id, raceId), eq(seasonRaces.userId, userId)));
  return r ?? null;
}

/** Half and full triathlons on the user's live seasons from today on, by date. */
export async function plannableRaces(userId: string, today: string): Promise<PlanRace[]> {
  const rows = await db
    .select({
      id: seasonRaces.id,
      seasonId: seasonRaces.seasonId,
      name: seasonRaces.name,
      raceDate: seasonRaces.raceDate,
      priority: seasonRaces.priority,
      distance: seasonRaces.distance,
      discipline: seasonRaces.discipline,
    })
    .from(seasonRaces)
    .innerJoin(seasons, and(eq(seasons.id, seasonRaces.seasonId), isNull(seasons.deletedAt)))
    .where(and(eq(seasonRaces.userId, userId), eq(seasonRaces.discipline, "triathlon"), gte(seasonRaces.raceDate, today)))
    .orderBy(asc(seasonRaces.raceDate), asc(seasonRaces.id));
  return rows.filter((r) => r.distance === "half" || r.distance === "full");
}

const planDistance = (r: PlanRace): PlanDistance | null =>
  r.discipline === "triathlon" && (r.distance === "half" || r.distance === "full") ? r.distance : null;

/** The stored row for a race, live or soft deleted. */
async function rowFor(userId: string, raceId: number) {
  // plan-read: includes deleted (the caller checks deletedAt, and the next save revives a deleted row)
  const [row] = await db.select().from(racePlans).where(and(eq(racePlans.seasonRaceId, raceId), eq(racePlans.userId, userId)));
  return row ?? null;
}

/** Everything the race plan page and the MCP read show. Null when the race is not the user's. */
export async function getRacePlan(userId: string, raceId: number) {
  const race = await ownedRace(userId, raceId);
  if (!race) return null;
  const distance = planDistance(race);
  const row = await rowFor(userId, raceId);
  const live = row && !row.deletedAt ? row : null;
  const inputs = (live?.plan ?? {}) as RacePlanInput;
  if (!distance) return { race, distance: null, id: live?.id ?? null, version: live?.version ?? null, inputs, unsupported: RACE_PLAN_DISTANCE_OFF } as const;
  const [rows, [profile], weightKg, nutrition] = await Promise.all([
    listThresholds(userId),
    db
      .select({ level: athleteProfiles.enduranceLevel })
      .from(athleteProfiles)
      .where(and(eq(athleteProfiles.userId, userId), isNull(athleteProfiles.deletedAt))),
    latestWeightKg(userId),
    nutritionSummary(userId, inputs.raceTemperatureC ?? null),
  ]);
  const cur = currentThresholds(rows);
  const anchors = {
    ftp: cur.ftp?.value ?? null,
    lthrBike: cur.lthr_bike?.value ?? null,
    lthrRun: cur.lthr_run?.value ?? null,
    runSpeed: cur.run_threshold_pace?.value ?? null,
    swimCss: cur.swim_css?.value ?? null,
  };
  const firstTimer = profile?.level == null || profile.level === "novice";
  const plan = racePlan(distance, inputs, anchors, firstTimer);
  const carbs = fuelRates(nutrition.gut.raceTarget, nutrition.gut.proved);
  const schedule = fuelSchedule(plan.timeline, inputs.fuelIntervalMinutes ?? 20, {
    carbs,
    fluid: [nutrition.fluid.low, nutrition.fluid.high],
    sodium: [nutrition.sodium.low, nutrition.sodium.high],
  });
  return {
    race,
    distance,
    id: live?.id ?? null,
    version: live?.version ?? null,
    inputs,
    firstTimer,
    anchors,
    plan,
    fuel: {
      carbsPerHour: carbs,
      carbsText:
        nutrition.gut.raceTarget == null
          ? `No proved gut tolerance yet: the plan uses ${carbs.bike} g/h on the bike, the bottom of the usual band. Train your gut first (Nutrition), and never race on more than you tested.`
          : carbs.bike < 60
            ? `You tolerated ${nutrition.gut.proved} g/h in training, so the plan uses ${carbs.bike} g/h on the bike (80 % of it). Train your gut toward 60-80 g/h before race day.`
            : `${carbs.bike} g/h on the bike: about 80 % of the ${nutrition.gut.proved} g/h you tolerated in training.`,
      carbsEvidence: "Coach convention; the bike and run split is inference",
      fluid: nutrition.fluid,
      sodium: nutrition.sodium,
      sweatTestOn: nutrition.test?.testedOn ?? null,
      schedule,
      totals: fuelTotals(schedule),
      caffeine: inputs.caffeine ? caffeinePlan(weightKg) : null,
    },
    raceMorning: raceMorning(weightKg),
    safety: [NUTRITION_DISCLAIMER, FLUID_SAFETY, "Pacing is a guide from your thresholds, never a finish prediction."],
  } as const;
}

/**
 * The bike time and athlete level the pacing rule needs, for the Garmin race
 * page: the bike time from the plan of the next race of this distance (an A
 * race first), else the assumed speed, as the race plan uses.
 */
export async function bikeContext(userId: string, distance: PlanDistance): Promise<{ bikeHours: number; firstTimer: boolean }> {
  const today = toDateStr(await userToday(userId));
  const races = (await plannableRaces(userId, today)).filter((r) => r.distance === distance);
  const race = races.find((r) => r.priority === "A") ?? races[0];
  const row = race ? await rowFor(userId, race.id) : null;
  const minutes = row && !row.deletedAt ? (row.plan as RacePlanInput).bikeMinutes : null;
  const [profile] = await db
    .select({ level: athleteProfiles.enduranceLevel })
    .from(athleteProfiles)
    .where(and(eq(athleteProfiles.userId, userId), isNull(athleteProfiles.deletedAt)));
  return {
    bikeHours: (minutes ?? LEG_METERS[distance].bike / ASSUMED_SPEED.bike / 60) / 60,
    firstTimer: profile?.level == null || profile.level === "novice",
  };
}

/** The next A race the user can plan, else the next plannable race. */
export async function defaultPlanRace(userId: string): Promise<PlanRace | null> {
  const today = toDateStr(await userToday(userId));
  const races = await plannableRaces(userId, today);
  return races.find((r) => r.priority === "A") ?? races[0] ?? null;
}

/**
 * Change a race's plan inputs (a null clears one). The first save creates the
 * row; a soft-deleted row (an undone create) comes back. Throws
 * PlanNotFoundError, PlanConflictError or PlanStateError.
 */
export async function saveRacePlan(ctx: PlanWriteContext, raceId: number, change: RacePlanInput, expectedVersion?: number): Promise<{ id: number; version: number }> {
  const race = await ownedRace(ctx.userId, raceId);
  if (!race) throw new PlanNotFoundError({ type: "race_plan", id: 0 });
  const distance = planDistance(race);
  if (!distance) throw new PlanStateError(RACE_PLAN_DISTANCE_OFF);
  const { result, versions } = await planWrite(ctx, async (w) => {
    await w.tx.execute(sqlLock(raceId));
    // plan-read: includes deleted (a deleted plan's row is revived here)
    const [row] = await w.tx.select().from(racePlans).where(and(eq(racePlans.seasonRaceId, raceId), eq(racePlans.userId, ctx.userId)));
    if (!row || row.deletedAt) {
      if (row && expectedVersion !== undefined) throw new PlanConflictError({ type: "race_plan", id: row.id }, row.version, expectedVersion);
      const plan = merge({}, change, distance);
      if (row) {
        await w.touch({ type: "race_plan", id: row.id }, { allowDeleted: true, action: "restore" });
        await w.tx.update(racePlans).set({ plan, deletedAt: null, updatedAt: new Date() }).where(eq(racePlans.id, row.id));
        return row.id;
      }
      const [made] = await w.tx.insert(racePlans).values({ userId: ctx.userId, seasonRaceId: raceId, plan }).returning({ id: racePlans.id });
      w.create({ type: "race_plan", id: made.id });
      return made.id;
    }
    await w.touch({ type: "race_plan", id: row.id }, { expectedVersion });
    const plan = merge(row.plan as RacePlanInput, change, distance);
    await w.tx.update(racePlans).set({ plan, updatedAt: new Date() }).where(eq(racePlans.id, row.id));
    return row.id;
  });
  return { id: result, version: versions.get(`race_plan:${result}`) ?? 1 };
}

/** The stored inputs with a change applied: undefined keeps a field, null clears it. */
function merge(current: RacePlanInput, change: RacePlanInput, distance: PlanDistance): RacePlanInput {
  const out: Record<string, unknown> = { ...current };
  for (const [k, v] of Object.entries(change)) {
    if (v === undefined) continue;
    if (v === null) delete out[k];
    else out[k] = v;
  }
  const plan = racePlanInput.parse(out);
  const tooLong = legLimitError(distance, plan);
  if (tooLong) throw new PlanStateError(tooLong);
  return plan;
}

function sqlLock(raceId: number) {
  return sql`SELECT pg_advisory_xact_lock(hashtext(${`race_plan:${raceId}`}))`;
}
