import { db } from "@/db";
import { planRevisions, programSets, seasonRaces, seasons, trainingCycles } from "@/db/schema";
import {
  addPhaseAction,
  addRaceAction,
  clearReplanAction,
  createSeasonAction,
  deleteSeasonAction,
  fitTaperAction,
  movePhaseAction,
  removePhaseAction,
  removeRaceAction,
  resumeSeasonAction,
  setPhaseAction,
  updateRaceAction,
  updateSeasonAction,
} from "@/lib/actions/seasons";
import { getActiveCycleForUser, startTrainingCycle, updateTrainingCycle } from "@/lib/actions/training-cycles";
import { restorePlanRevision } from "@/lib/actions/plan-revisions";
import { getActiveCycle } from "@/lib/garmin/queries";
import { syncPeriodizedTargets } from "@/lib/periodization-sync";
import { purgePlanRevisions } from "@/lib/plan-revisions";
import { activeCycleRace, getSeasonDetail, listSeasons } from "@/lib/seasons";
import { addDays, toDateStr } from "@/lib/utils/cycle-position";
import { scaledDuration } from "@/lib/utils/periodization";
import { and, asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createExercise, createProgram, createUser } from "./factories";
import { asUser } from "./setup";

/** Seasons, races and phases in the app (docs/plans/seasons.md, section 5, integration rows). */

const day = (offset: number) => toDateStr(addDays(new Date(), offset));
let me: string;
let other: string;
let lifter: string;

beforeEach(async () => {
  me = (await createUser({ enduranceEnabled: true })).id;
  other = (await createUser({ enduranceEnabled: true })).id;
  lifter = (await createUser()).id;
});

const seasonRow = async (id: number) => (await db.select().from(seasons).where(eq(seasons.id, id)))[0];
const cycleRow = async (id: number) => (await db.select().from(trainingCycles).where(eq(trainingCycles.id, id)))[0];
const racesOf = (id: number) => db.select().from(seasonRaces).where(eq(seasonRaces.seasonId, id)).orderBy(asc(seasonRaces.id));
const revisionsOf = (type: "season" | "cycle", id: number) =>
  db
    .select()
    .from(planRevisions)
    .where(and(eq(planRevisions.objectType, type), eq(planRevisions.objectId, id)))
    .orderBy(asc(planRevisions.id));

async function newSeason(userId: string, start = day(0), end = day(200)) {
  asUser(userId);
  const r = await createSeasonAction({ name: "Season", goal: "First half", startDate: start, endDate: end });
  if (!r.success) throw new Error(r.error);
  return r.data.id;
}

async function cycle(userId: string, extra: Partial<typeof trainingCycles.$inferInsert> = {}) {
  const [c] = await db.insert(trainingCycles).values({ userId, name: "Block", durationWeeks: 4, ...extra }).returning();
  return c.id;
}

const race = { name: "Haugesund 70.3", raceDate: "2027-08-22", discipline: "triathlon" as const, distance: "half" as const, priority: "A" as const };

describe("seasons", () => {
  it("creates, updates and deletes a season for any user, each a revision", async () => {
    const id = await newSeason(lifter);
    expect(await seasonRow(id)).toMatchObject({ userId: lifter, name: "Season", goal: "First half", version: 1 });
    expect((await updateSeasonAction({ seasonId: id, nextGoal: "Full distance" })).success).toBe(true);
    expect(await seasonRow(id)).toMatchObject({ nextGoal: "Full distance", version: 2 });
    expect((await deleteSeasonAction({ seasonId: id })).success).toBe(true);
    expect((await seasonRow(id)).deletedAt).not.toBeNull();
    expect(await listSeasons(lifter)).toEqual([]);
    expect((await revisionsOf("season", id)).map((r) => [r.action, r.writer])).toEqual([
      ["create", "user"],
      ["update", "user"],
      ["delete", "user"],
    ]);
  });

  it("refuses an end before the start", async () => {
    asUser(me);
    const r = await createSeasonAction({ name: "Bad", startDate: day(10), endDate: day(1) });
    expect(r.success).toBe(false);
    const id = await newSeason(me);
    const u = await updateSeasonAction({ seasonId: id, endDate: day(-5) });
    expect(u).toMatchObject({ success: false, error: expect.stringContaining("end on or after") });
  });

  it("refuses another user's season and changes nothing", async () => {
    const id = await newSeason(me);
    asUser(other);
    expect((await updateSeasonAction({ seasonId: id, name: "Mine" })).success).toBe(false);
    expect((await deleteSeasonAction({ seasonId: id })).success).toBe(false);
    expect((await addRaceAction({ seasonId: id, ...race })).success).toBe(false);
    const c = await cycle(other);
    expect((await addPhaseAction({ seasonId: id, cycleId: c })).success).toBe(false);
    expect(await seasonRow(id)).toMatchObject({ name: "Season", deletedAt: null, version: 1 });
    expect(await racesOf(id)).toEqual([]);
    expect((await cycleRow(c)).seasonId).toBeNull();
  });

  it("deleting keeps the cycles; they read as cycles with no season until a restore", async () => {
    const id = await newSeason(me);
    await addRaceAction({ seasonId: id, ...race });
    const c = await cycle(me);
    await addPhaseAction({ seasonId: id, cycleId: c });
    await deleteSeasonAction({ seasonId: id });
    expect((await cycleRow(c)).seasonId).toBe(id);
    expect(await activeCycleRace(me)).toBeNull();
    const del = (await revisionsOf("season", id)).at(-1)!;
    expect((await restorePlanRevision({ revisionId: del.id })).success).toBe(true);
    expect((await seasonRow(id)).deletedAt).toBeNull();
    expect((await getSeasonDetail(me, id))!.phases.map((p) => p.id)).toEqual([c]);
  });
});

describe("races and the re-plan flag (D17)", () => {
  it("adds, renames, moves and removes races; only a date or A change flags", async () => {
    const id = await newSeason(me);
    const added = await addRaceAction({ seasonId: id, ...race });
    expect(added).toMatchObject({ success: true, data: { replanFlagged: expect.stringContaining("added") } });
    await clearReplanAction({ seasonId: id });
    expect((await seasonRow(id)).replanFlaggedAt).toBeNull();

    const [r] = await racesOf(id);
    const renamed = await updateRaceAction({ seasonId: id, raceId: r.id, name: "Haugesund" });
    expect(renamed).toMatchObject({ success: true, data: { replanFlagged: null } });
    expect((await seasonRow(id)).replanFlaggedAt).toBeNull();

    const b = await addRaceAction({ seasonId: id, ...race, name: "Tune-up", raceDate: "2027-06-20", priority: "B" });
    expect(b).toMatchObject({ success: true, data: { replanFlagged: null } });

    const moved = await updateRaceAction({ seasonId: id, raceId: r.id, raceDate: "2027-08-29" });
    expect(moved.success).toBe(true);
    const row = await seasonRow(id);
    expect(row.replanFlaggedAt).not.toBeNull();
    expect(row.replanReason).toBe('A race "Haugesund" moved from 2027-08-22 to 2027-08-29');

    // The phases were not touched by the flag.
    expect((await getSeasonDetail(me, id))!.replan).toMatchObject({ flagged: true });
    expect((await removeRaceAction({ seasonId: id, raceId: r.id })).success).toBe(true);
    expect(await racesOf(id)).toHaveLength(1);
    // A triathlon race keeps no metres; another race keeps no triathlon distance.
    await addRaceAction({ seasonId: id, name: "10k", raceDate: "2027-05-01", discipline: "run", distance: "full", distanceMeters: 10000, priority: "C" });
    expect((await racesOf(id)).at(-1)).toMatchObject({ distance: null, distanceMeters: 10000 });
  });

  it("refuses races with the endurance switch off, and a race on a phase cycle", async () => {
    const id = await newSeason(lifter);
    const r = await addRaceAction({ seasonId: id, ...race });
    expect(r).toMatchObject({ success: false, error: expect.stringContaining("endurance features") });
    expect(await racesOf(id)).toEqual([]);

    const mine = await newSeason(me);
    const c = await cycle(me);
    await addPhaseAction({ seasonId: mine, cycleId: c });
    const u = await updateTrainingCycle({ id: c, raceDate: "2027-08-22", raceDistance: "half" });
    expect(u).toMatchObject({ success: false, error: expect.stringContaining("Set races on the season") });
    expect((await cycleRow(c)).raceDate).toBeNull();
  });
});

describe("phases", () => {
  it("adds an existing cycle (its race moves to the season), a new draft, and moves and removes them", async () => {
    const id = await newSeason(me);
    const c = await cycle(me, { raceDate: "2027-08-22", raceDistance: "half", version: 3 });
    const a = await addPhaseAction({ seasonId: id, cycleId: c, phaseType: "base", durationWeeks: 9 });
    expect(a).toMatchObject({ success: true, data: { cycleId: c, raceMoved: true } });
    expect(await cycleRow(c)).toMatchObject({ seasonId: id, phaseOrder: 1, phaseType: "base", durationWeeks: 9, raceDate: null, raceDistance: null, version: 4 });
    expect(await racesOf(id)).toEqual([expect.objectContaining({ raceDate: "2027-08-22", distance: "half", priority: "A" })]);
    // A moved race is not a change of plan: no flag.
    expect((await seasonRow(id)).replanFlaggedAt).toBeNull();

    const t = await addPhaseAction({ seasonId: id, name: "Taper", phaseType: "taper" });
    expect(t.success).toBe(true);
    const taper = t.success ? t.data.cycleId : 0;
    // A taper with no length gets the half's 10 days.
    expect(await cycleRow(taper)).toMatchObject({ seasonId: id, phaseOrder: 2, durationDays: 10, durationWeeks: 2, status: "draft" });

    const g = await addPhaseAction({ seasonId: id, name: "General", phaseType: "general", durationDays: 20, position: 1 });
    const general = g.success ? g.data.cycleId : 0;
    const order = async () => (await getSeasonDetail(me, id))!.phases.map((p) => p.id);
    expect(await order()).toEqual([general, c, taper]);
    await movePhaseAction({ seasonId: id, cycleId: general, position: 2 });
    expect(await order()).toEqual([c, general, taper]);
    await removePhaseAction({ seasonId: id, cycleId: general });
    expect(await order()).toEqual([c, taper]);
    expect(await cycleRow(general)).toMatchObject({ seasonId: null, phaseOrder: null, phaseType: null });
    expect((await cycleRow(taper)).phaseOrder).toBe(2);

    await setPhaseAction({ seasonId: id, cycleId: c, durationDays: 60 });
    expect(await cycleRow(c)).toMatchObject({ durationDays: 60, durationWeeks: 9 });
    const s = await seasonRow(id);
    expect(s.version).toBeGreaterThan(1);
    expect((await revisionsOf("season", id)).every((r) => r.writer === "user")).toBe(true);
  });

  it("refuses phase types with the switch off, and a cycle in another season", async () => {
    const id = await newSeason(lifter);
    const r = await addPhaseAction({ seasonId: id, name: "Base", phaseType: "base" });
    expect(r).toMatchObject({ success: false, error: expect.stringContaining("endurance features") });
    const plain = await addPhaseAction({ seasonId: id, name: "Strength block", durationWeeks: 6 });
    expect(plain.success).toBe(true);

    const a = await newSeason(me);
    const b = await newSeason(me);
    const c = await cycle(me);
    await addPhaseAction({ seasonId: a, cycleId: c });
    expect(await addPhaseAction({ seasonId: b, cycleId: c })).toMatchObject({ success: false, error: expect.stringContaining("another season") });
  });

  it("fit taper sets the phase before the taper so the taper ends on race day", async () => {
    const id = await newSeason(me, day(1));
    const raceDay = day(1 + 60 + 10 - 1 + 4);
    await addRaceAction({ seasonId: id, ...race, raceDate: raceDay });
    const b = await addPhaseAction({ seasonId: id, name: "Build", phaseType: "build", durationDays: 60 });
    await addPhaseAction({ seasonId: id, name: "Taper", phaseType: "taper", durationDays: 10 });
    const before = await getSeasonDetail(me, id);
    expect(before!.taperFit).toMatchObject({ status: "early", days: 4 });
    const fit = await fitTaperAction({ seasonId: id });
    expect(fit).toMatchObject({ success: true, data: { durationDays: 64 } });
    expect((await cycleRow(b.success ? b.data.cycleId : 0)).durationDays).toBe(64);
    expect((await getSeasonDetail(me, id))!.taperFit.status).toBe("fits");
    expect(await fitTaperAction({ seasonId: id })).toMatchObject({ success: false, error: expect.stringContaining("already") });
  });
});

describe("the chained start (owner decision 1)", () => {
  it("starting phase 1 schedules phase 2 for the day after it ends; on that day phase 2 starts", async () => {
    const id = await newSeason(me, day(0));
    const p1 = await addPhaseAction({ seasonId: id, name: "Base", durationDays: 10 });
    const p2 = await addPhaseAction({ seasonId: id, name: "Build", durationWeeks: 4 });
    const one = p1.success ? p1.data.cycleId : 0;
    const two = p2.success ? p2.data.cycleId : 0;
    // The season starts today, so nothing starts by itself: the user starts it.
    expect((await cycleRow(one)).scheduledStartDate).toBeNull();
    expect((await getSeasonDetail(me, id))!.next).toMatchObject({ cycleId: one, scheduled: false });

    expect((await startTrainingCycle(one)).success).toBe(true);
    expect(await cycleRow(two)).toMatchObject({ status: "draft", scheduledStartDate: day(10) });

    // Ten days later: phase 1 has ended, phase 2 starts on the read.
    await db.update(trainingCycles).set({ startDate: day(-10) }).where(eq(trainingCycles.id, one));
    await db.update(trainingCycles).set({ scheduledStartDate: day(0) }).where(eq(trainingCycles.id, two));
    const active = await getActiveCycleForUser();
    expect(active.success && active.data?.cycle.id).toBe(two);
    expect(await cycleRow(one)).toMatchObject({ status: "completed" });
    expect(await cycleRow(two)).toMatchObject({ status: "active", startDate: day(0), scheduledStartDate: null });
  });

  it("a season ahead schedules its first phase for the season start", async () => {
    const id = await newSeason(me, day(14));
    const p = await addPhaseAction({ seasonId: id, name: "General", durationWeeks: 6 });
    expect((await cycleRow(p.success ? p.data.cycleId : 0)).scheduledStartDate).toBe(day(14));
  });

  it("a cycle started outside the season pauses the chain; resume picks it up", async () => {
    const id = await newSeason(me, day(0));
    const p1 = await addPhaseAction({ seasonId: id, name: "Base", durationWeeks: 4 });
    const p2 = await addPhaseAction({ seasonId: id, name: "Build", durationWeeks: 4 });
    const one = p1.success ? p1.data.cycleId : 0;
    const two = p2.success ? p2.data.cycleId : 0;
    await startTrainingCycle(one);
    expect((await cycleRow(two)).scheduledStartDate).toBe(day(28));

    const outside = await cycle(me, { name: "Deload week" });
    await startTrainingCycle(outside);
    expect(await cycleRow(one)).toMatchObject({ status: "completed" });
    expect((await cycleRow(two)).scheduledStartDate).toBeNull();
    const paused = await getSeasonDetail(me, id);
    expect(paused!.next).toMatchObject({ cycleId: two, scheduled: false });
    // Editing the season does not steal the user's choice.
    await setPhaseAction({ seasonId: id, cycleId: two, durationWeeks: 5 });
    expect((await cycleRow(two)).scheduledStartDate).toBeNull();

    const resumed = await resumeSeasonAction({ seasonId: id });
    expect(resumed.success).toBe(true);
    // Phase 1 was planned for 4 weeks from today, so phase 2 waits for that day.
    expect(await cycleRow(two)).toMatchObject({ status: "draft", scheduledStartDate: day(28) });
  });

  it("a length change of the active phase moves the next start", async () => {
    const id = await newSeason(me, day(0));
    const p1 = await addPhaseAction({ seasonId: id, name: "Base", durationWeeks: 4 });
    const p2 = await addPhaseAction({ seasonId: id, name: "Build", durationWeeks: 4 });
    await startTrainingCycle(p1.success ? p1.data.cycleId : 0);
    await setPhaseAction({ seasonId: id, cycleId: p1.success ? p1.data.cycleId : 0, durationDays: 30 });
    expect((await cycleRow(p2.success ? p2.data.cycleId : 0)).scheduledStartDate).toBe(day(30));
  });
});

describe("phase curves in the weekly sync", () => {
  async function periodizedCycle(extra: Partial<typeof trainingCycles.$inferInsert>) {
    const run = await createExercise({ category: "cardio", discipline: "run" });
    const { program, slots } = await createProgram(me, [
      { exerciseId: run.id, sets: [{ peakDurationSeconds: 3600, durationSeconds: 3600, sessionRole: "work", targetHeartRateZone: 1, restTimeSeconds: 10 }] },
    ]);
    const c = await cycle(me, { status: "active", startDate: day(0), durationWeeks: 2, ...extra });
    return { c, program, setId: slots[0].setIds[0] };
  }
  const setRow = async (id: number) => (await db.select().from(programSets).where(eq(programSets.id, id)))[0];

  it("a taper phase writes the taper share; a transition leaves zone and rest", async () => {
    const t = await periodizedCycle({ phaseType: "taper", durationDays: 10 });
    await syncPeriodizedTargets(t.c, me, [{ programId: t.program.id }], 1, 2, "build", null);
    expect(await setRow(t.setId)).toMatchObject({ durationSeconds: scaledDuration(3600, 0.6), targetHeartRateZone: 4 });

    const tr = await periodizedCycle({ phaseType: "transition" });
    await syncPeriodizedTargets(tr.c, me, [{ programId: tr.program.id }], 1, 2, "build", null);
    expect(await setRow(tr.setId)).toMatchObject({ durationSeconds: scaledDuration(3600, 0.5), targetHeartRateZone: 1, restTimeSeconds: 10 });
  });

  it("a cycle with no phase type writes the same numbers as before seasons", async () => {
    const t = await periodizedCycle({ durationWeeks: 12 });
    await syncPeriodizedTargets(t.c, me, [{ programId: t.program.id }], 1, 12, "build", null);
    // Week 1 of a 12-week block: the old curve's 0.60 ramp start, base zone 3.
    expect(await setRow(t.setId)).toMatchObject({ durationSeconds: scaledDuration(3600, 0.6), targetHeartRateZone: 3, restTimeSeconds: 60 });
  });
});

describe("restore and the race reader", () => {
  it("a revision from before seasons, with a race, restored onto a phase cycle keeps the race on the season", async () => {
    asUser(me);
    const c = await cycle(me, { durationWeeks: 8 });
    await updateTrainingCycle({ id: c, raceDate: "2027-08-22", raceDistance: "half" });
    const withRace = (await revisionsOf("cycle", c)).at(-1)!;
    // Shaped like a revision stored before this package: no season keys.
    const snap = withRace.snapshot as { cycle: Record<string, unknown> };
    for (const k of ["seasonId", "phaseOrder", "phaseType", "durationDays"]) delete snap.cycle[k];
    await db.update(planRevisions).set({ snapshot: snap }).where(eq(planRevisions.id, withRace.id));
    const id = await newSeason(me);
    await addPhaseAction({ seasonId: id, cycleId: c });
    const r = await restorePlanRevision({ revisionId: withRace.id });
    expect(r).toMatchObject({ success: true, data: { skipped: ["Race kept on the season"] } });
    expect(await cycleRow(c)).toMatchObject({ raceDate: null, raceDistance: null, seasonId: id });
  });

  it("a season restore brings its races back with their ids", async () => {
    const id = await newSeason(me);
    await addRaceAction({ seasonId: id, ...race });
    const [r] = await racesOf(id);
    const kept = (await revisionsOf("season", id)).at(-1)!;
    await removeRaceAction({ seasonId: id, raceId: r.id });
    await clearReplanAction({ seasonId: id });
    expect((await restorePlanRevision({ revisionId: kept.id })).success).toBe(true);
    expect((await racesOf(id)).map((x) => x.id)).toEqual([r.id]);
    // Bringing an A race back is a race change: the season is flagged again.
    expect((await seasonRow(id)).replanFlaggedAt).not.toBeNull();
  });

  it("Garmin's active cycle reads the season's A race for a phase, and the cycle's own otherwise", async () => {
    const plain = await cycle(me, { status: "active", startDate: day(0), raceDate: "2027-08-22", raceDistance: "full" });
    expect(await getActiveCycle(me)).toMatchObject({ raceDate: "2027-08-22", raceDistance: "full" });
    const id = await newSeason(me);
    await addRaceAction({ seasonId: id, ...race });
    // The season already has a race that day, so the cycle's race is not added twice.
    await addPhaseAction({ seasonId: id, cycleId: plain });
    expect(await racesOf(id)).toHaveLength(1);
    expect(await getActiveCycle(me)).toMatchObject({ raceDate: "2027-08-22", raceDistance: "half" });
    expect(await activeCycleRace(me)).toMatchObject({ source: "season", seasonId: id, name: "Haugesund 70.3" });
  });
});

describe("retention", () => {
  it("purges a season deleted more than 90 days ago, keeping its cycles", async () => {
    const id = await newSeason(me);
    const c = await cycle(me);
    await addPhaseAction({ seasonId: id, cycleId: c });
    await deleteSeasonAction({ seasonId: id });
    await db.update(seasons).set({ deletedAt: new Date(Date.now() - 91 * 86_400_000) }).where(eq(seasons.id, id));
    await purgePlanRevisions();
    expect(await seasonRow(id)).toBeUndefined();
    expect(await revisionsOf("season", id)).toEqual([]);
    expect(await cycleRow(c)).toMatchObject({ seasonId: null, deletedAt: null });
  });
});
