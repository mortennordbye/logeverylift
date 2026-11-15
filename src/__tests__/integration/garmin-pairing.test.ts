import { db } from "@/db";
import { garminActivities, garminActivityStreams, plannedSessions, trainingCycles, workoutSessions, workoutStepResults } from "@/db/schema";
import { afterRideData } from "@/components/features/bike/after/load";
import { setRideRpe } from "@/lib/actions/after-ride";
import { updatePlannedSession } from "@/lib/actions/planned-sessions";
import { storePairings } from "@/lib/garmin/pairing";
import { sessionCompliance } from "@/lib/session-compliance";
import type { StepResult } from "@/lib/utils/step-results";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEMPO_LAPS_5, TEMPO_LAPS_7, TEMPO_WORKOUT } from "../fixtures/bike-sessions";
import { createUser } from "./factories";
import { asUser } from "./setup";

/**
 * Stored Garmin pairs (docs/plans/bike-sessions.md, 5.5, D4 and D5): the
 * worker writes one "garmin" workout session per planned session with its
 * step results, a pick or unpick replaces it, and a rerun changes nothing.
 * The clock is fixed at Thu 2026-11-05 12:00 UTC; the user's zone is UTC.
 */

vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  return { ...actual, env: new Proxy(actual.env, { get: (t, k) => (k === "GARMIN_KEY_ENCRYPTION_KEY" ? "k" : Reflect.get(t, k)) }) };
});

const TUE = "2026-11-03";
let me: string;
let plannedId: number;
let nextGarminId = 1000;

async function activity(userId: string, day: string, durationS: number, laps: object[] = TEMPO_LAPS_5, hour = 6) {
  const garminActivityId = nextGarminId++;
  const [a] = await db
    .insert(garminActivities)
    .values({ userId, garminActivityId, startTimeLocal: new Date(`${day}T0${hour}:00:00Z`), activityType: "indoor_cycling", data: { duration: durationS, distance: 27100, activityName: "Indoor Cycling" } })
    .returning();
  await db.insert(garminActivityStreams).values({ userId, garminActivityId, parserVersion: 3, streams: {}, laps, sets: [], timeInZone: [] });
  return a.id;
}

const garminRows = (userId = me) => db.select().from(workoutSessions).where(and(eq(workoutSessions.userId, userId), eq(workoutSessions.source, "garmin")));
const resultsOf = async (sessionId: number) => (await db.select().from(workoutStepResults).where(eq(workoutStepResults.workoutSessionId, sessionId)))[0];
const tuesday = async () => (await sessionCompliance(me, TUE, TUE)).find((s) => s.id === plannedId)!;

beforeEach(async () => {
  me = (await createUser({ timeZone: "UTC", enduranceEnabled: true, role: "admin" })).id;
  asUser(me, "admin");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));
  const [c] = await db.insert(trainingCycles).values({ userId: me, name: "Block", durationWeeks: 4, status: "active", startDate: "2026-11-02", scheduleType: "day_of_week" }).returning();
  const [p] = await db.insert(plannedSessions).values({ userId: me, cycleId: c.id, date: TUE, position: 1, workout: TEMPO_WORKOUT }).returning();
  plannedId = p.id;
});

afterEach(() => vi.useRealTimers());

describe("storePairings", () => {
  it("writes one garmin session with step results from 5 laps, and a second run writes nothing new", async () => {
    const act = await activity(me, TUE, 3912);
    await storePairings(me, new Date());
    const rows = await garminRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ plannedSessionId: plannedId, garminActivityId: act, isCompleted: true, date: TUE, programId: null });
    const results = await resultsOf(rows[0].id);
    expect(results.source).toBe("garmin");
    expect((results.steps as StepResult[]).map((s) => s.value)).toEqual([121, 140, 98, 142, 115]);
    expect(await tuesday()).toMatchObject({ state: "done", matchedBy: "garmin", garminActivityId: act, band: "green" });

    await storePairings(me, new Date());
    const again = await garminRows();
    expect(again.map((r) => r.id)).toEqual([rows[0].id]);
    expect(await db.select().from(workoutStepResults).where(eq(workoutStepResults.userId, me))).toHaveLength(1);
  });

  it("joins the distance laps of a 7-lap ride into their steps", async () => {
    await activity(me, TUE, 3912, TEMPO_LAPS_7);
    await storePairings(me, new Date());
    const [row] = await garminRows();
    const steps = (await resultsOf(row.id)).steps as StepResult[];
    expect(steps).toHaveLength(5);
    expect(steps[1]).toMatchObject({ activeSeconds: 899, value: Math.round((640 * 139 + 259 * 140) / 899) });
  });

  it("does not pair a ride under half the planned time (D5), but a pick does", async () => {
    const short = await activity(me, TUE, 1800);
    await storePairings(me, new Date());
    expect(await garminRows()).toEqual([]);
    expect((await tuesday()).state).toBe("unconfirmed");

    expect(await updatePlannedSession({ op: "pick", id: plannedId, garminActivityId: short })).toMatchObject({ success: true });
    expect(await garminRows()).toEqual([expect.objectContaining({ garminActivityId: short, plannedSessionId: plannedId })]);
    expect(await tuesday()).toMatchObject({ state: "done", matchedBy: "pick", garminActivityId: short });
    await storePairings(me, new Date());
    expect(await garminRows()).toHaveLength(1);
  });

  it("a pick replaces the stored pair, and the worker keeps it", async () => {
    const auto = await activity(me, TUE, 3912);
    const other = await activity(me, TUE, 3000, TEMPO_LAPS_5, 7);
    await storePairings(me, new Date());
    expect((await garminRows()).map((r) => r.garminActivityId)).toEqual([auto]);

    expect(await updatePlannedSession({ op: "pick", id: plannedId, garminActivityId: other })).toMatchObject({ success: true });
    await storePairings(me, new Date());
    const rows = await garminRows();
    expect(rows.map((r) => r.garminActivityId)).toEqual([other]);
    expect(await resultsOf(rows[0].id)).toBeDefined();
  });

  it("unpick drops the pair, and the worker does not pair the session again", async () => {
    await activity(me, TUE, 3912);
    await storePairings(me, new Date());
    expect(await garminRows()).toHaveLength(1);

    expect(await updatePlannedSession({ op: "unpick", id: plannedId })).toMatchObject({ success: true });
    expect(await garminRows()).toEqual([]);
    const [row] = await db.select().from(plannedSessions).where(eq(plannedSessions.id, plannedId));
    expect(row).toMatchObject({ garminUnpaired: true, garminActivityId: null });
    await storePairings(me, new Date());
    expect(await garminRows()).toEqual([]);
    expect((await tuesday()).state).toBe("unconfirmed");
  });

  it("the after view shows the step table, the match note and the day's rides", async () => {
    const act = await activity(me, TUE, 3912, TEMPO_LAPS_7);
    await storePairings(me, new Date());
    const v = (await afterRideData(me, plannedId))!;
    expect(v).toMatchObject({ band: "green", minutes: "65 of 65 min", matchNote: "Matched by laps: 5 of 5" });
    expect(v.rows.map((r) => r.avgPower)).toEqual([121, 139, 98, 141, 115]);
    expect(v.choices).toEqual([expect.objectContaining({ id: act, paired: true })]);
    expect(await afterRideData((await createUser({ role: "admin", enduranceEnabled: true })).id, plannedId)).toBeNull();
  });

  it("refuses another user's unpick and RPE", async () => {
    await activity(me, TUE, 3912);
    await storePairings(me, new Date());
    const them = (await createUser({ timeZone: "UTC", enduranceEnabled: true, role: "admin" })).id;
    asUser(them, "admin");
    expect(await updatePlannedSession({ op: "unpick", id: plannedId })).toMatchObject({ success: false });
    expect(await setRideRpe({ plannedSessionId: plannedId, rpe: 6 })).toMatchObject({ success: false });
    expect(await garminRows()).toHaveLength(1);

    asUser(me, "admin");
    expect(await setRideRpe({ plannedSessionId: plannedId, rpe: 6 })).toMatchObject({ success: true });
    expect((await garminRows())[0].rpe).toBe(6);
  });
});
