import { db } from "@/db";
import {
  exercises,
  planRevisions,
  programExercises,
  programs,
  trainingCycleSlots,
  trainingCycles,
  userWeightEntries,
  users,
  workoutSessions,
} from "@/db/schema";
import { connectionAccess } from "@/lib/mcp/access";
import { planWrite } from "@/lib/plan-revisions";
import { READ_ONLY_REFUSAL, scopedServer, type McpAccess } from "@/lib/mcp/scopes";
import { registerCycleTools } from "@/lib/mcp/tools/cycles";
import { registerExerciseTools } from "@/lib/mcp/tools/exercises";
import { registerGarminTools } from "@/lib/mcp/tools/garmin";
import { registerProfileTools } from "@/lib/mcp/tools/profile";
import { registerProgramTools } from "@/lib/mcp/tools/programs";
import { registerSessionTools } from "@/lib/mcp/tools/sessions";
import { registerWorkoutTools } from "@/lib/mcp/tools/workouts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toDateStr } from "@/lib/utils/cycle-position";
import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createExercise, createOAuthClient, createOAuthConnection, createProgram, createUser } from "./factories";

/**
 * Scope enforcement on every MCP tool (docs/plans/mcp-access.md, 2.1), with
 * the real queries: write tools refuse under read only and change nothing,
 * and run under read and change. Plus the per-request consent check.
 */

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;

/** The tools as a connection with this access reaches them (the route's wiring). */
function toolsFor(userId: string, access: McpAccess) {
  const tools = new Map<string, Handler>();
  const base = {
    registerTool: (name: string, _config: unknown, handler: Handler) => tools.set(name, handler),
  } as unknown as McpServer;
  const server = scopedServer(base, access);
  for (const register of [registerProfileTools, registerProgramTools, registerCycleTools, registerWorkoutTools, registerGarminTools, registerExerciseTools, registerSessionTools]) {
    register(server, userId);
  }
  return tools;
}

/** Everything a write tool here could touch for this user. */
async function fingerprint(userId: string) {
  const [user] = await db.select({ name: users.name, weightKg: users.weightKg, timeZone: users.timeZone, distanceUnit: users.distanceUnit, swimUnit: users.swimUnit, enduranceEnabled: users.enduranceEnabled }).from(users).where(eq(users.id, userId));
  const progs = await db.select({ id: programs.id, name: programs.name, deletedAt: programs.deletedAt }).from(programs).where(eq(programs.userId, userId)).orderBy(asc(programs.id));
  const slots = await db.select({ id: programExercises.id }).from(programExercises).innerJoin(programs, eq(programs.id, programExercises.programId)).where(eq(programs.userId, userId));
  const cycles = await db.select({ id: trainingCycles.id, name: trainingCycles.name }).from(trainingCycles).where(eq(trainingCycles.userId, userId));
  const cycleSlots = await db.select({ id: trainingCycleSlots.id }).from(trainingCycleSlots).innerJoin(trainingCycles, eq(trainingCycles.id, trainingCycleSlots.trainingCycleId)).where(eq(trainingCycles.userId, userId));
  const weights = await db.select({ id: userWeightEntries.id }).from(userWeightEntries).where(eq(userWeightEntries.userId, userId));
  const sessions = await db.select({ id: workoutSessions.id }).from(workoutSessions).where(eq(workoutSessions.userId, userId));
  const custom = await db.select({ id: exercises.id }).from(exercises).where(eq(exercises.userId, userId));
  return JSON.stringify({ user, progs, slots: slots.length, cycles, cycleSlots: cycleSlots.length, weights: weights.length, sessions: sessions.length, custom: custom.length });
}

let me: string;
let programId: number;
let exerciseId: number;
let cycleId: number;
/** A revision of the program: its baseline, before a rename made in beforeEach. */
let baselineId: number;

beforeEach(async () => {
  me = (await createUser()).id;
  exerciseId = (await createExercise()).id;
  programId = (await createProgram(me, [{ exerciseId, sets: [{ targetReps: 8, weightKg: "60" }] }])).program.id;
  // Active since today, with the program on Wednesday, so confirm_session has a day to confirm.
  [{ id: cycleId }] = await db
    .insert(trainingCycles)
    .values({ userId: me, name: "Block", durationWeeks: 8, status: "active", startDate: toDateStr(new Date()) })
    .returning({ id: trainingCycles.id });
  await db.insert(trainingCycleSlots).values({ trainingCycleId: cycleId, dayOfWeek: 3, programId });
  // A user rename, so the program has history to restore: baseline then update.
  // The program is at version 2 after it.
  await planWrite({ userId: me, writer: "user" }, async (w) => {
    await w.touch({ type: "program", id: programId });
    await w.tx.update(programs).set({ name: "Renamed by the user" }).where(eq(programs.id, programId));
  });
  const [baseline] = await db.select({ id: planRevisions.id }).from(planRevisions).where(eq(planRevisions.action, "baseline"));
  baselineId = baseline.id;
});

/** One call per write tool that changes something when it runs. */
const writeCalls = (): [string, Record<string, unknown>][] => [
  ["update_profile", { name: "Changed", timeZone: "Europe/Oslo", distanceUnit: "mi", swimUnit: "yd" }],
  ["manage_weight", { operation: "log", weightKg: 81 }],
  ["create_program", { name: "New program", reason: "Test" }],
  ["update_program", { programId, name: "Renamed", reason: "Test", expectedVersion: 2 }],
  ["delete_program", { programId, reason: "Test", expectedVersion: 2 }],
  ["edit_program_exercise", { operation: "add", programId, exerciseId, reason: "Test", expectedVersion: 2 }],
  ["restore_revision", { revisionId: baselineId, reason: "Test" }],
  ["manage_training_cycle", { operation: "create", name: "Next block", durationWeeks: 4, reason: "Test" }],
  ["edit_cycle_slot", { operation: "upsert", trainingCycleId: cycleId, dayOfWeek: 1, label: "Monday", reason: "Test", expectedVersion: 1 }],
  ["create_exercise", { name: "My trail run", category: "cardio", discipline: "run" }],
  ["log_session", { date: toDateStr(new Date()), sets: [{ exerciseId, setNumber: 1, reps: 5, weightKg: 60 }] }],
  ["confirm_session", { date: toDateStr(new Date()), programId }],
];

const readCalls: [string, Record<string, unknown>][] = [
  ["get_profile", {}],
  ["list_programs", {}],
  ["get_program", { programId: 0 }],
  ["list_training_cycles", {}],
  ["get_training_cycle", { cycleId: 0 }],
  ["recent_workouts", { limit: 5 }],
  ["exercise_history", { exercise: "Bench", sessions: 5 }],
  ["personal_records", { limit: 5 }],
  ["weekly_volume", { weeks: 4 }],
  ["summary_stats", {}],
  ["get_garmin_status", {}],
  ["get_garmin_trends", {}],
  ["list_garmin_activities", { limit: 5 }],
  ["get_garmin_activity", { id: 1 }],
  ["list_revisions", {}],
  ["search_exercises", { query: "a", limit: 5 }],
];

describe("read only", () => {
  it("covers every registered tool in these lists", () => {
    const names = [...toolsFor(me, "read").keys()].sort();
    expect(names).toEqual([...writeCalls(), ...readCalls].map(([n]) => n).sort());
  });

  it.each(writeCalls().map(([name]) => name))("%s refuses and changes nothing", async (name) => {
    const [, args] = writeCalls().find(([n]) => n === name)!;
    const before = await fingerprint(me);
    const result = await toolsFor(me, "read").get(name)!(args);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(`Error: ${READ_ONLY_REFUSAL}`);
    expect(await fingerprint(me)).toBe(before);
  });

  it.each(readCalls.map(([name]) => name))("%s still runs", async (name) => {
    const [, args] = readCalls.find(([n]) => n === name)!;
    const result = await toolsFor(me, "read").get(name)!(args);
    expect(result.content[0].text).not.toContain(READ_ONLY_REFUSAL);
  });
});

describe("read and change", () => {
  it.each(writeCalls().map(([name]) => name))("%s runs and writes", async (name) => {
    const [, args] = writeCalls().find(([n]) => n === name)!;
    const before = await fingerprint(me);
    const result = await toolsFor(me, "write").get(name)!(args);
    expect(result.isError, result.content[0].text).toBeFalsy();
    expect(await fingerprint(me)).not.toBe(before);
  });
});

describe("connectionAccess", () => {
  let clientId: string;

  beforeEach(async () => {
    clientId = (await createOAuthClient()).clientId;
  });

  it("is the token's scopes narrowed by the live consent", async () => {
    await createOAuthConnection(me, clientId, ["openid", "mcp:read"]);
    expect(await connectionAccess(me, clientId, "openid mcp:read mcp:write")).toEqual({ kind: "ok", access: "read" });
  });

  it("gives write when both grant it", async () => {
    await createOAuthConnection(me, clientId, ["mcp:read", "mcp:write"]);
    expect(await connectionAccess(me, clientId, "mcp:read mcp:write")).toEqual({ kind: "ok", access: "write" });
  });

  it("is revoked without a consent, or for another user's consent", async () => {
    expect(await connectionAccess(me, clientId, "mcp:read mcp:write")).toEqual({ kind: "revoked" });
    const other = (await createUser()).id;
    await createOAuthConnection(other, clientId, ["mcp:read", "mcp:write"]);
    expect(await connectionAccess(me, clientId, "mcp:read mcp:write")).toEqual({ kind: "revoked" });
    expect(await connectionAccess(me, undefined, "mcp:read mcp:write")).toEqual({ kind: "revoked" });
  });

  it("has no scope for a token from before the scopes existed", async () => {
    await createOAuthConnection(me, clientId, ["mcp:read", "mcp:write"]);
    expect(await connectionAccess(me, clientId, "openid offline_access")).toEqual({ kind: "no_scope" });
  });
});
