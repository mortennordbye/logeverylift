import { db } from "@/db";
import { athleteThresholds, garminDailyMetrics, plannedSessions, trainingCycles, users, workoutSessions, workoutSets, workoutStepResults } from "@/db/schema";
import { collectUserData } from "@/lib/account-data";
import { saveStepResultsAction } from "@/lib/actions/step-results";
import { scopedServer } from "@/lib/mcp/scopes";
import { registerEnduranceAppTools } from "@/lib/mcp/tools/endurance-app";
import { registerPlannedSessionTools } from "@/lib/mcp/tools/planned-sessions";
import { registerWorkoutLibraryTools } from "@/lib/mcp/tools/workouts-compliance";
import { sportExerciseId } from "@/lib/session-answers";
import { sessionCompliance } from "@/lib/session-compliance";
import { saveStepResults } from "@/lib/step-results";
import { appSessionLoads, getTrainingLoad } from "@/lib/training-load";
import { parseWorkout, type Workout } from "@/lib/utils/workout-steps";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExercise, createUser } from "./factories";
import { mcpTools } from "./mcp-call";
import { asUser } from "./setup";

/**
 * Endurance in the app and load without Garmin (docs/plans/endurance-app.md):
 * the step results save path, the load reader and its one source, the MCP
 * tools, the migration and the export. Clock: Thu 2026-11-05 12:00 UTC; the
 * users' zone is UTC.
 */

let garminAllowed = false;
vi.mock("@/lib/garmin/access", () => ({ garminAllowedFor: async () => garminAllowed, garminAllowed: () => garminAllowed }));

const TODAY = "2026-11-05";
let me: string;
let other: string;

function parse(json: unknown): Workout {
  const r = parseWorkout(json);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.workout;
}

const ride = parse({
  v: 1,
  sport: "bike",
  name: "Short sweet spot",
  steps: [
    { type: "warmup", end: { type: "time", seconds: 600 }, target: { metric: "power", anchor: "ftp", low: 50, high: 70 } },
    { type: "repeat", count: 2, steps: [{ type: "work", end: { type: "time", seconds: 600 }, target: { metric: "power", anchor: "ftp", low: 88, high: 93 } }] },
    { type: "cooldown", end: { type: "lap" } },
  ],
});

async function plannedWith(userId: string, workout: Workout | null, date = TODAY) {
  const [c] = await db.insert(trainingCycles).values({ userId, name: "Block", durationWeeks: 4, status: "active", startDate: "2026-11-02" }).returning();
  const [p] = await db.insert(plannedSessions).values({ userId, cycleId: c.id, date, position: 1, workout, label: workout ? null : "Strength" }).returning();
  return p.id;
}

const runResults = [
  { key: "s1", status: "done", activeSeconds: 600 },
  { key: "s3#1", status: "done", activeSeconds: 600, value: 225 },
  { key: "s3#2", status: "skipped", activeSeconds: 120 },
  { key: "s4", status: "partial", activeSeconds: 300 },
];

beforeEach(async () => {
  garminAllowed = false;
  me = (await createUser({ timeZone: "UTC", enduranceEnabled: true })).id;
  other = (await createUser({ timeZone: "UTC", enduranceEnabled: true })).id;
  asUser(me);
  // The built-in exercises the save path logs on (lowest id per discipline, not custom).
  for (const discipline of ["bike", "run", "swim"] as const) {
    if ((await sportExerciseId(discipline)) == null) await createExercise({ name: `Built-in ${discipline}`, category: "cardio", discipline });
  }
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
});

afterEach(() => vi.useRealTimers());

describe("saving step results", () => {
  it("a player run writes one completed session linked to the planned one, with one set and the results row", async () => {
    const id = await plannedWith(me, ride);
    const r = await saveStepResultsAction({ plannedSessionId: id, steps: runResults, sessionRpe: 7, source: "player", clientKey: "run-key-0001", startedAt: Date.parse(`${TODAY}T06:00:00Z`), pausedSeconds: 30 });
    expect(r.success, JSON.stringify(r)).toBe(true);
    const sessionId = r.success ? r.data.workoutSessionId : 0;
    const [s] = await db.select().from(workoutSessions).where(eq(workoutSessions.id, sessionId));
    expect(s).toMatchObject({ userId: me, plannedSessionId: id, date: TODAY, isCompleted: true, source: "app", programId: null });
    const sets = await db.select().from(workoutSets).where(eq(workoutSets.sessionId, sessionId));
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({ exerciseId: await sportExerciseId("bike"), durationSeconds: 1620, rpe: 7 });
    const [row] = await db.select().from(workoutStepResults).where(eq(workoutStepResults.workoutSessionId, sessionId));
    expect(row).toMatchObject({ userId: me, plannedSessionId: id, source: "player", clientKey: "run-key-0001", pausedSeconds: 30 });
    expect(row.steps).toEqual(runResults);
    // C5 now reads the planned session as done, linked.
    const [c] = (await sessionCompliance(me, TODAY, TODAY)).filter((x) => x.id === id);
    expect(c).toMatchObject({ state: "done", matchedBy: "link", loggedSessionId: sessionId });
  });

  it("a retry with the same client key writes nothing new", async () => {
    const id = await plannedWith(me, ride);
    const input = { plannedSessionId: id, steps: runResults, source: "player" as const, clientKey: "run-key-0002" };
    const a = await saveStepResultsAction(input);
    const b = await saveStepResultsAction(input);
    expect(a).toEqual(b);
    expect(await db.select().from(workoutStepResults).where(eq(workoutStepResults.userId, me))).toHaveLength(1);
    expect(await db.select().from(workoutSessions).where(eq(workoutSessions.userId, me))).toHaveLength(1);
  });

  it("attaches to a session already linked, and fills a missing RPE without overwriting one", async () => {
    const id = await plannedWith(me, ride);
    const bikeEx = (await sportExerciseId("bike"))!;
    const [s] = await db.insert(workoutSessions).values({ userId: me, date: TODAY, startTime: new Date(), isCompleted: true, plannedSessionId: id }).returning();
    await db.insert(workoutSets).values([
      { sessionId: s.id, exerciseId: bikeEx, setNumber: 1, actualReps: 0, weightKg: "0", restTimeSeconds: 0, durationSeconds: 1800, rpe: null },
      { sessionId: s.id, exerciseId: bikeEx, setNumber: 2, actualReps: 0, weightKg: "0", restTimeSeconds: 0, durationSeconds: 600, rpe: 9 },
    ]);
    const r = await saveStepResults(me, { plannedSessionId: id, steps: runResults, sessionRpe: 6 }, "manual");
    expect(r).toMatchObject({ workoutSessionId: s.id, created: "attached" });
    const sets = await db.select({ rpe: workoutSets.rpe }).from(workoutSets).where(eq(workoutSets.sessionId, s.id)).orderBy(workoutSets.setNumber);
    expect(sets.map((x) => x.rpe)).toEqual([6, 9]);
    // Saving again replaces the results of that session.
    await saveStepResults(me, { plannedSessionId: id, steps: [{ key: "s1", status: "done", activeSeconds: 500 }] }, "manual");
    const rows = await db.select().from(workoutStepResults).where(eq(workoutStepResults.workoutSessionId, s.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].steps).toEqual([{ key: "s1", status: "done", activeSeconds: 500 }]);
  });

  it("refuses another user's session, a program session, results that do not fit, and the switch off", async () => {
    const mine = await plannedWith(me, ride);
    const theirs = await plannedWith(other, ride);
    const program = await plannedWith(me, null);
    expect(await saveStepResultsAction({ plannedSessionId: theirs, steps: runResults, source: "manual" })).toEqual({ success: false, error: "Planned session not found" });
    expect(await saveStepResultsAction({ plannedSessionId: program, steps: runResults, source: "manual" })).toEqual({ success: false, error: "That session has no structured workout" });
    const bad = await saveStepResultsAction({ plannedSessionId: mine, steps: [{ key: "s9", status: "done" }], source: "manual" });
    expect(bad).toEqual({ success: false, error: 'Step results refused: 0.key: no step "s9" in this workout' });
    await db.update(users).set({ enduranceEnabled: false }).where(eq(users.id, me));
    expect(await saveStepResultsAction({ plannedSessionId: mine, steps: runResults, source: "manual" })).toEqual({ success: false, error: "Endurance features are not on for this account" });
    expect(await db.select().from(workoutSessions).where(eq(workoutSessions.userId, me))).toHaveLength(0);
  });

  it("a hand entry for a future session is dated today, never in the future", async () => {
    const id = await plannedWith(me, ride, "2026-11-07");
    const r = await saveStepResults(me, { plannedSessionId: id, steps: runResults }, "manual");
    const [s] = await db.select().from(workoutSessions).where(eq(workoutSessions.id, r.workoutSessionId));
    expect(s.date).toBe(TODAY);
  });
});

describe("load from the app", () => {
  async function logged(date: string, sets: { exerciseId: number; durationSeconds: number; distanceMeters?: number; rpe?: number | null }[], source: "app" | "assistant" | "auto" = "app") {
    const [s] = await db
      .insert(workoutSessions)
      .values({ userId: me, date, startTime: new Date(`${date}T07:00:00Z`), endTime: new Date(`${date}T08:00:00Z`), isCompleted: true, source })
      .returning();
    await db.insert(workoutSets).values(sets.map((x, i) => ({ sessionId: s.id, exerciseId: x.exerciseId, setNumber: i + 1, actualReps: 0, weightKg: "0", restTimeSeconds: 0, durationSeconds: x.durationSeconds, distanceMeters: x.distanceMeters ?? null, rpe: x.rpe ?? null })));
    return s.id;
  }

  it("uses run pace with a threshold pace, sRPE otherwise, counts assistant sessions, skips auto rows and lists sessions with no load", async () => {
    const runEx = (await sportExerciseId("run"))!;
    const bikeEx = (await sportExerciseId("bike"))!;
    await db.insert(athleteThresholds).values({ userId: me, kind: "run_threshold_pace", value: 1000 / 240, measuredOn: "2026-10-01", source: "manual" });
    const run = await logged("2026-11-03", [{ exerciseId: runEx, durationSeconds: 3600, distanceMeters: 12000, rpe: 5 }]);
    const rideA = await logged("2026-11-04", [{ exerciseId: bikeEx, durationSeconds: 3600, rpe: 6 }], "assistant");
    const noRpe = await logged("2026-11-04", [{ exerciseId: bikeEx, durationSeconds: 1800 }]);
    await logged("2026-11-04", [{ exerciseId: bikeEx, durationSeconds: 1800, rpe: 9 }], "auto");
    const rows = await appSessionLoads(me, null, TODAY);
    expect(rows.map((r) => [r.id, r.method, r.load === null ? null : Math.round(r.load)])).toEqual([
      [run, "run_pace", 64],
      [rideA, "srpe", 79],
      [noRpe, "none", null],
    ]);
    const load = await getTrainingLoad(me, 7);
    expect(load.source).toBe("app");
    expect(load.days.at(-1)!.date).toBe(TODAY);
    expect(load.noLoad).toEqual([{ id: noRpe, date: "2026-11-04", sport: "bike", reason: "needs_rpe" }]);
    expect(load.methods).toEqual({ run_pace: 1, srpe: 1, none: 1 });
    expect(load.days.find((d) => d.date === "2026-11-03")!.tracks.run.load).toBeCloseTo(64, 3);
  });

  it("a Garmin user with Garmin days reads the Garmin series only, never the app one added to it", async () => {
    const bikeEx = (await sportExerciseId("bike"))!;
    await logged(TODAY, [{ exerciseId: bikeEx, durationSeconds: 3600, rpe: 8 }]);
    garminAllowed = true;
    const point = { ctl: 40, atl: 50, tsb: -10, load: 77 };
    const tracks = { total: point, swim: { ...point, load: 0 }, bike: point, run: { ...point, load: 0 }, strength: { ...point, load: 0 }, other: { ...point, load: 0 } };
    await db.insert(garminDailyMetrics).values({ userId: me, day: TODAY, modelVersion: 3, metrics: { pmc: tracks, calibrating: false } });
    const load = await getTrainingLoad(me, 7);
    expect(load.source).toBe("garmin");
    expect(load.days).toHaveLength(1);
    expect(load.days[0].tracks.total.load).toBe(77);
    expect(load.noLoad).toEqual([]);
  });
});

describe("MCP tools", () => {
  const tools = (userId = me) => mcpTools((s, u) => registerEnduranceAppTools(s, u), userId);

  it("log_step_results writes like the app, and get_step_results reads it back with planned values and bands", async () => {
    await db.insert(athleteThresholds).values({ userId: me, kind: "ftp", value: 250, measuredOn: "2026-10-01", source: "manual" });
    const id = await plannedWith(me, ride);
    const w = await tools()("log_step_results", { plannedSessionId: id, steps: runResults, sessionRpe: 7, reason: "The athlete told me" });
    expect(w.isError, w.raw).toBe(false);
    const [s] = await db.select().from(workoutSessions).where(eq(workoutSessions.id, w.data.workoutSessionId));
    expect(s.source).toBe("assistant");
    const r = await tools()("get_step_results", { plannedSessionId: id });
    expect(r.isError, r.raw).toBe(false);
    expect(r.data).toMatchObject({ source: "assistant", sport: "bike", sessionRpe: 7, load: { method: "srpe" } });
    expect(r.data.steps[1]).toMatchObject({ key: "s3#1", band: "green", targetHit: "in", planned: { seconds: 600, target: { low: 220, high: 232.5, unit: "W" } } });
    expect(r.data.steps[2]).toMatchObject({ key: "s3#2", band: "red" });
    expect(r.data.plannedLoad.partial).toBe(true);
  });

  it("refuses another user's ids, and reads nothing for them", async () => {
    const theirs = await plannedWith(other, ride);
    const w = await tools()("log_step_results", { plannedSessionId: theirs, steps: runResults, reason: "x" });
    expect(w).toMatchObject({ isError: true, raw: "Error: Planned session not found" });
    await saveStepResults(other, { plannedSessionId: theirs, steps: runResults }, "manual");
    expect((await tools()("get_step_results", { plannedSessionId: theirs })).data).toEqual({ results: null });
  });

  it("get_training_load gives the source, the days and the evidence labels", async () => {
    const r = await tools()("get_training_load", { days: 7 });
    expect(r.isError, r.raw).toBe(false);
    expect(r.data.source).toBe("app");
    expect(r.data.days).toHaveLength(7);
    expect(r.data.evidence.map((e: { label: string }) => e.label)).toContain("Inference");
  });

  it("a read-only connection can read but not write step results", async () => {
    const id = await plannedWith(me, ride);
    const handlers = new Map<string, (a: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>>();
    const base = { registerTool: (name: string, _c: unknown, h: (a: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>) => handlers.set(name, h) } as unknown as McpServer;
    registerEnduranceAppTools(scopedServer(base, "read"), me);
    const w = await handlers.get("log_step_results")!({ plannedSessionId: id, steps: runResults, reason: "x" });
    expect(w.isError).toBe(true);
    expect(await db.select().from(workoutStepResults).where(eq(workoutStepResults.userId, me))).toHaveLength(0);
    const r = await handlers.get("get_training_load")!({});
    expect(r.isError ?? false).toBe(false);
  });

  it("list_planned_sessions and get_workout carry the planned load, and a done session its load", async () => {
    await db.insert(athleteThresholds).values({ userId: me, kind: "ftp", value: 250, measuredOn: "2026-10-01", source: "manual" });
    const id = await plannedWith(me, ride);
    await saveStepResults(me, { plannedSessionId: id, steps: runResults, sessionRpe: 6 }, "manual");
    const list = await mcpTools(registerPlannedSessionTools, me)("list_planned_sessions", { from: TODAY, to: TODAY });
    expect(list.isError, list.raw).toBe(false);
    const entry = list.data.sessions.find((x: { id: number }) => x.id === id);
    expect(entry.plannedLoad).toMatchObject({ partial: true });
    expect(entry.plannedLoad.value).toBeGreaterThan(0);
    expect(entry.load).toMatchObject({ method: "srpe", value: Math.round((1620 / 60) * 6 * 0.22) });
    const got = await mcpTools((s, u) => registerWorkoutLibraryTools(s, u), me)("get_workout", { plannedSessionId: id });
    expect(got.data.plannedLoad).toEqual(entry.plannedLoad);
  });
});

describe("migration, export and delete", () => {
  it("has the table with its unique indexes and cascades", async () => {
    const idx = await db.execute(sql`SELECT indexname FROM pg_indexes WHERE tablename = 'workout_step_results' ORDER BY indexname`);
    expect((idx.rows as { indexname: string }[]).map((r) => r.indexname)).toEqual(["idx_wsr_user_planned", "uniq_wsr_client_key", "uniq_wsr_session", "workout_step_results_pkey"]);
    const id = await plannedWith(me, ride);
    const r = await saveStepResults(me, { plannedSessionId: id, steps: runResults }, "manual");
    // Deleting the planned session keeps the results (set null); deleting the logged session removes them.
    await db.delete(plannedSessions).where(eq(plannedSessions.id, id));
    const [kept] = await db.select().from(workoutStepResults).where(eq(workoutStepResults.workoutSessionId, r.workoutSessionId));
    expect(kept.plannedSessionId).toBeNull();
    await db.delete(workoutSessions).where(eq(workoutSessions.id, r.workoutSessionId));
    expect(await db.select().from(workoutStepResults).where(eq(workoutStepResults.userId, me))).toHaveLength(0);
  });

  it("is in the export, and goes with the account", async () => {
    const id = await plannedWith(me, ride);
    await saveStepResults(me, { plannedSessionId: id, steps: runResults }, "manual");
    const data = await collectUserData(me);
    expect(data.workout_step_results).toHaveLength(1);
    await db.delete(users).where(eq(users.id, me));
    expect(await db.select().from(workoutStepResults).where(and(eq(workoutStepResults.userId, me)))).toHaveLength(0);
  });
});
