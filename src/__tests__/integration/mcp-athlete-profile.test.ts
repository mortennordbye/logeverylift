import { db } from "@/db";
import { athleteInjuries, athleteProfiles, athleteThresholds, coachMemory, planRevisions, trainingCycles } from "@/db/schema";
import { addCoachMemory } from "@/lib/coach-memory";
import { registerAthletePrompts, registerAthleteProfileTools } from "@/lib/mcp/tools/athlete-profile";
import { registerCoachMemoryTools } from "@/lib/mcp/tools/coach-memory";
import { registerRevisionTools } from "@/lib/mcp/revisions";
import { toDateStr } from "@/lib/utils/cycle-position";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createUser } from "./factories";
import { mcpTools } from "./mcp-call";

/** The athlete profile tools over MCP (docs/plans/athlete-profile.md, 2.8). */

let me: string;
let other: string;
let lifter: string;
const CLIENT = "client-athlete";

beforeEach(async () => {
  me = (await createUser({ enduranceEnabled: true })).id;
  other = (await createUser({ enduranceEnabled: true })).id;
  lifter = (await createUser()).id;
});

const tools = (userId: string, endurance = true) =>
  mcpTools((s, u) => registerAthleteProfileTools(s, u, CLIENT, { endurance }), userId);

const revs = (type: "athlete" | "threshold" | "injury", id: number) =>
  db
    .select()
    .from(planRevisions)
    .where(and(eq(planRevisions.objectType, type), eq(planRevisions.objectId, id)))
    .orderBy(asc(planRevisions.id));

describe("thresholds", () => {
  it("add, read, update and delete, each a revision by the assistant in its change set", async () => {
    const call = tools(me);
    const added = await call("manage_thresholds", { operation: "add", kind: "run_threshold_pace", paceSecondsPerKm: 270, source: "manual", measuredOn: "2026-11-01", reason: "From the user's race" });
    expect(added.isError, added.raw).toBe(false);
    expect(added.data.value).toBeCloseTo(1000 / 270, 5);
    const read = await call("get_athlete_profile");
    expect(read.data.thresholds.run_threshold_pace).toMatchObject({ id: added.data.id, paceSecondsPerKm: 270, pace: "4:30 /km", source: "manual", version: 1 });
    expect(read.data.thresholds.ftp).toBeNull();

    const up = await call("manage_thresholds", { operation: "update", id: added.data.id, paceSecondsPerKm: 265, reason: "Retest", expectedVersion: 1 });
    expect(up.isError, up.raw).toBe(false);
    expect(up.data.version).toBe(2);
    const stale = await call("manage_thresholds", { operation: "update", id: added.data.id, paceSecondsPerKm: 260, reason: "x", expectedVersion: 1 });
    expect(stale.isError).toBe(true);
    expect(stale.raw).toContain("Conflict");
    const del = await call("manage_thresholds", { operation: "delete", id: added.data.id, reason: "Wrong", expectedVersion: 2 });
    expect(del.isError, del.raw).toBe(false);

    const r = await revs("threshold", added.data.id);
    expect(r.map((x) => [x.action, x.writer, x.clientId])).toEqual([
      ["create", "assistant", CLIENT],
      ["update", "assistant", CLIENT],
      ["delete", "assistant", CLIENT],
    ]);
    expect(new Set(r.map((x) => x.changeSetId)).size).toBe(1);
    expect(r[1].reason).toBe("Retest");
  });

  it("computes a field test and refuses a value that disagrees with it", async () => {
    const call = tools(me);
    const css = await call("manage_thresholds", { operation: "add", kind: "swim_css", source: "test", protocol: "css_400_200", testData: { t400Seconds: 400, t200Seconds: 190 }, reason: "Pool test" });
    expect(css.isError, css.raw).toBe(false);
    expect((await call("get_athlete_profile")).data.thresholds.swim_css.paceSecondsPer100m).toBe(105);
    const bad = await call("manage_thresholds", { operation: "add", kind: "ftp", watts: 300, source: "test", protocol: "bike_30min", testData: { avgPowerBest20: 260 }, reason: "x" });
    expect(bad.isError).toBe(true);
    expect(bad.raw).toContain("does not match");
  });

  it("refuses the wrong value field for a kind, and out of range", async () => {
    const call = tools(me);
    const wrong = await call("manage_thresholds", { operation: "add", kind: "ftp", bpm: 250, source: "manual", reason: "x" });
    expect(wrong.raw).toContain("ftp takes watts");
    const range = await call("manage_thresholds", { operation: "add", kind: "max_hr", bpm: 260, source: "manual", reason: "x" });
    expect(range.isError).toBe(true);
    expect(await db.select().from(athleteThresholds)).toHaveLength(0);
  });

  it("are for every user: a lifter with the switch off adds one, and sees no profile part", async () => {
    const call = tools(lifter, false);
    expect((await call("manage_thresholds", { operation: "add", kind: "max_hr", bpm: 190, source: "manual", reason: "x" })).isError).toBe(false);
    const read = await call("get_athlete_profile");
    expect(read.data.endurance).toBe(false);
    expect(read.data.profile).toBeUndefined();
    expect(read.data.thresholds.max_hr.value).toBe(190);
  });

  it("never touches another user's value", async () => {
    const theirs = await tools(other)("manage_thresholds", { operation: "add", kind: "ftp", watts: 250, source: "manual", reason: "x" });
    const call = tools(me);
    expect((await call("manage_thresholds", { operation: "update", id: theirs.data.id, watts: 300, reason: "x", expectedVersion: 1 })).isError).toBe(true);
    expect((await call("manage_thresholds", { operation: "delete", id: theirs.data.id, reason: "x", expectedVersion: 1 })).isError).toBe(true);
    expect((await call("get_athlete_profile", { history: true })).data.history).toEqual([]);
    const [row] = await db.select().from(athleteThresholds).where(eq(athleteThresholds.id, theirs.data.id));
    expect(row).toMatchObject({ value: 250, deletedAt: null });
  });
});

describe("profile and injuries", () => {
  it("the profile and injury tools are not registered with the switch off", async () => {
    const call = tools(lifter, false);
    await expect(call("manage_athlete_profile", { strengthGoal: "minimal", reason: "x" })).rejects.toThrow("no tool");
    await expect(call("manage_injuries", { operation: "add", area: "knee", description: "x", status: "active", reason: "x" })).rejects.toThrow("no tool");
  });

  it("the module refuses a profile write for a user with the switch off, even if a tool were reached", async () => {
    const call = tools(lifter, true);
    const r = await call("manage_athlete_profile", { strengthGoal: "minimal", reason: "x" });
    expect(r.isError).toBe(true);
    expect(r.raw).toContain("Endurance features are not on");
    expect(await db.select().from(athleteProfiles)).toHaveLength(0);
  });

  it("sets the profile, then needs the version; reads the strength default for the cycle's phase", async () => {
    const call = tools(me);
    const first = await call("manage_athlete_profile", { strengthGoal: "keep_muscle", availableDays: [1, 3, 5, 6], hoursPerWeek: 8, reason: "Interview" });
    expect(first.isError, first.raw).toBe(false);
    const noVersion = await call("manage_athlete_profile", { hoursPerWeek: 9, reason: "x" });
    expect(noVersion.raw).toContain("expectedVersion is required");
    expect((await call("manage_athlete_profile", { hoursPerWeek: 9, reason: "More time", expectedVersion: 1 })).data.version).toBe(2);

    await db.insert(trainingCycles).values({ userId: me, name: "Base", durationWeeks: 12, status: "active", startDate: toDateStr(new Date()), goal: "build" });
    const read = (await call("get_athlete_profile")).data;
    expect(read.profile).toMatchObject({ strengthGoal: "keep_muscle", hoursPerWeek: 9, availableDays: [1, 3, 5, 6], version: 2 });
    expect(read.strength).toMatchObject({ goal: "keep_muscle", phase: "base", default: { sessionsPerWeek: 2 } });
    expect(read.strength.table).toHaveLength(7);
  });

  it("adds, resolves and deletes an injury; never another user's", async () => {
    const call = tools(me);
    const added = await call("manage_injuries", { operation: "add", area: "achilles", side: "right", description: "Tight after speed work", avoid: "No hill sprints", status: "active", reason: "Told me" });
    expect(added.isError, added.raw).toBe(false);
    const resolved = await call("manage_injuries", { operation: "resolve", id: added.data.id, endedOn: "2026-11-10", reason: "Healed", expectedVersion: 1 });
    expect(resolved.isError, resolved.raw).toBe(false);
    expect((await call("get_athlete_profile")).data.injuries).toEqual([]);
    expect((await call("get_athlete_profile", { includePast: true })).data.injuries[0]).toMatchObject({ status: "past", endedOn: "2026-11-10" });

    const intruder = tools(other);
    expect((await intruder("manage_injuries", { operation: "delete", id: added.data.id, reason: "x", expectedVersion: 2 })).isError).toBe(true);
    expect((await call("manage_injuries", { operation: "delete", id: added.data.id, reason: "Duplicate", expectedVersion: 2 })).isError).toBe(false);
    const r = await revs("injury", added.data.id);
    expect(r.map((x) => x.action)).toEqual(["create", "update", "delete"]);
    const [row] = await db.select().from(athleteInjuries).where(eq(athleteInjuries.id, added.data.id));
    expect(row.deletedAt).not.toBeNull();
  });
});

describe("the interview over MCP", () => {
  it("offers limit and observation memory entries; deactivating one moves it out", async () => {
    const entry = await addCoachMemory({ userId: me, writer: "assistant", clientId: CLIENT, reason: "x" }, { kind: "limit", text: "Can train 8 h a week, never Fridays" });
    await addCoachMemory({ userId: me, writer: "user" }, { kind: "decision", text: "Kept strength at 2x" });
    const call = tools(me);
    const before = (await call("get_athlete_profile")).data.interview;
    expect(before.complete).toBe(false);
    expect(before.memoryToOffer.map((m: { id: number }) => m.id)).toEqual([entry.id]);
    expect(before.missingSteps).toEqual(["race", "experience", "availability", "strength", "thresholds"]);

    await call("manage_athlete_profile", { availableDays: [1, 2, 3, 4, 6, 7], hoursPerWeek: 8, reason: "Moved from coach memory" });
    const mem = mcpTools((s, u) => registerCoachMemoryTools(s, u, CLIENT), me);
    expect((await mem("manage_coach_memory", { operation: "deactivate", id: entry.id, reason: "Moved to the athlete profile", expectedVersion: 1 })).isError).toBe(false);
    await call("manage_athlete_profile", { completeInterview: true, reason: "Interview done", expectedVersion: 1 });
    const after = (await call("get_athlete_profile")).data.interview;
    expect(after.complete).toBe(true);
    expect(after.memoryToOffer).toEqual([]);
  });

  it("the prompt returns the steps and writes nothing", async () => {
    const prompts = new Map<string, () => Promise<{ messages: { content: { text: string } }[] }>>();
    const stub = { registerPrompt: (name: string, _c: unknown, cb: () => Promise<never>) => prompts.set(name, cb) } as unknown as McpServer;
    registerAthletePrompts(stub, me);
    const count = async () =>
      JSON.stringify(
        await Promise.all([
          db.select().from(planRevisions),
          db.select().from(athleteProfiles),
          db.select().from(athleteThresholds),
          db.select().from(athleteInjuries),
          db.select().from(coachMemory),
        ]),
      );
    const before = await count();
    const result = await prompts.get("intake_interview")!();
    expect(result.messages[0].content.text).toContain("get_athlete_profile");
    expect(result.messages[0].content.text).toContain("8. Finish");
    expect(await count()).toBe(before);

    registerAthletePrompts(stub, lifter);
    expect((await prompts.get("intake_interview")!()).messages[0].content.text).toContain("not on for this account");
  });

  it("list_revisions and restore_revision work on the new types", async () => {
    const call = tools(me);
    const t = await call("manage_thresholds", { operation: "add", kind: "lthr_bike", bpm: 160, source: "manual", reason: "x" });
    await call("manage_thresholds", { operation: "update", id: t.data.id, bpm: 165, reason: "Retest", expectedVersion: 1 });
    const rev = mcpTools((s, u) => registerRevisionTools(s, u, CLIENT), me);
    const list = await rev("list_revisions", { objectType: "threshold", objectId: t.data.id });
    expect(list.isError, list.raw).toBe(false);
    expect(list.data[0].changes[0]).toMatch(/^160 bpm on \S+ → 165 bpm on \S+$/);
    const restored = await rev("restore_revision", { revisionId: list.data[1].revisionId, reason: "Back to the test value" });
    expect(restored.isError, restored.raw).toBe(false);
    const [row] = await db.select().from(athleteThresholds).where(eq(athleteThresholds.id, t.data.id));
    expect(row.value).toBe(160);
  });
});
