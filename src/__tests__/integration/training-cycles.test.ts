import { db } from "@/db";
import { programSets, trainingCycleSlots, trainingCycles } from "@/db/schema";
import { updateProgramSet } from "@/lib/actions/programs";
import { registerProgramTools } from "@/lib/mcp/tools/programs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  getCyclePeriodization,
  syncActiveCyclePeriodization,
} from "@/lib/actions/training-cycles";
import { scaledDistance } from "@/lib/utils/periodization";
import { toDateStr } from "@/lib/utils/cycle-position";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createExercise, createProgram, createUser } from "./factories";
import { asUser } from "./setup";

/**
 * The weekly periodization sync (PZ-29) and the summary that reports it
 * (PZ-40), against a real database. A "maintain" cycle in week 1 keeps the
 * numbers fixed: the curve is flat at 1 and the adaptation nudge is neutral.
 */

let userId: string;
let cycleId: number;
let setId: number;
let exerciseId: number;
let slotId: number;

beforeEach(async () => {
  userId = (await createUser()).id;
  asUser(userId);
  exerciseId = (await createExercise({ name: "Running", category: "cardio" })).id;
  const { program, slots } = await createProgram(userId, [
    {
      exerciseId,
      sets: [{ targetReps: null, weightKg: "0", distanceMeters: 3000, peakDistanceMeters: 5000 }],
    },
  ]);
  setId = slots[0].setIds[0];
  slotId = slots[0].programExerciseId;
  const [cycle] = await db
    .insert(trainingCycles)
    .values({
      userId,
      name: "Block",
      durationWeeks: 8,
      scheduleType: "rotation",
      goal: "maintain",
      status: "active",
      startDate: toDateStr(new Date()),
      // Last week's adaptation, left behind by the previous sync.
      adaptationPct: 80,
    })
    .returning();
  cycleId = cycle.id;
  await db.insert(trainingCycleSlots).values({ trainingCycleId: cycleId, programId: program.id, orderIndex: 0 });
});

const distance = async () =>
  (await db.select({ d: programSets.distanceMeters }).from(programSets).where(eq(programSets.id, setId)))[0].d;
const cycle = async () =>
  (await db.select().from(trainingCycles).where(eq(trainingCycles.id, cycleId)))[0];

describe("syncActiveCyclePeriodization", () => {
  it("writes this week's targets and marks the week synced", async () => {
    expect(await syncActiveCyclePeriodization()).toEqual({ success: true, data: null });
    expect(await distance()).toBe(5000);
    expect((await cycle()).lastSyncedWeek).toBe(1);
  });

  it("leaves a week that is already synced alone", async () => {
    await db.update(trainingCycles).set({ lastSyncedWeek: 1 }).where(eq(trainingCycles.id, cycleId));
    await syncActiveCyclePeriodization();
    expect(await distance()).toBe(3000);
  });

  it("does nothing for another user's cycle", async () => {
    asUser((await createUser()).id);
    await syncActiveCyclePeriodization();
    expect(await distance()).toBe(3000);
    expect((await cycle()).lastSyncedWeek).toBeNull();
  });
});

describe("getCyclePeriodization", () => {
  it("syncs a new week first, so it never reports last week's adaptation", async () => {
    const r = await getCyclePeriodization(cycleId);
    if (!r.success) throw new Error(r.error);
    // 80% was last week's nudge; week 1 is neutral, so the effective volume is the full curve.
    expect(r.data?.multiplier).toBe(1);
    expect(await distance()).toBe(5000);
    expect((await cycle()).lastSyncedWeek).toBe(1);
  });
});

describe("editing a periodized set right after a week rollover", () => {
  it("syncs the new week before dividing, so the edit survives the sync", async () => {
    // Not yet synced this week: adaptationPct is last week's 80. Week 1's own
    // nudge is neutral, so the share is 1 and the typed value is the peak.
    await updateProgramSet({ id: setId, distanceMeters: 3200, anchor: "distance" });
    const [ps] = await db.select().from(programSets).where(eq(programSets.id, setId));
    expect(ps.peakDistanceMeters).toBe(3200);
    expect(ps.distanceMeters).toBe(3200);
    expect((await cycle()).lastSyncedWeek).toBe(1);
  });

  it("compares an untouched value with the new week's, not last week's", async () => {
    // A build block's week 1 is 60% of peak: 5150 m syncs to 3100 m (rounded).
    // The page synced before it rendered, so it shows 3100; only the rest time
    // changed. Compared with the pre-sync 3000 it reads as an edit, and dividing
    // the rounded 3100 back out moves the peak to 5167.
    await db.update(trainingCycles).set({ goal: "build" }).where(eq(trainingCycles.id, cycleId));
    await db.update(programSets).set({ peakDistanceMeters: 5150 }).where(eq(programSets.id, setId));
    await updateProgramSet({ id: setId, distanceMeters: 3100, restTimeSeconds: 120, anchor: "distance" });
    const [ps] = await db.select().from(programSets).where(eq(programSets.id, setId));
    expect(ps.peakDistanceMeters).toBe(5150);
    expect(ps.distanceMeters).toBe(3100);
  });
});

describe("editing a periodized set re-anchors it (PZ-36)", () => {
  // This week is already synced at 80% of peak (as a later week with a
  // missed-session nudge would be), so the typed number is 80%.
  beforeEach(async () => {
    await db.update(trainingCycles).set({ lastSyncedWeek: 1 }).where(eq(trainingCycles.id, cycleId));
  });
  const row = async () =>
    (await db.select().from(programSets).where(eq(programSets.id, setId)))[0];

  it("treats a typed distance as this week's and scales the peak to match", async () => {
    const r = await updateProgramSet({ id: setId, distanceMeters: 3200, anchor: "distance" });
    expect(r.success).toBe(true);
    const ps = await row();
    expect(ps.distanceMeters).toBe(3200);
    expect(ps.peakDistanceMeters).toBe(4000);
    // So the curve gives the typed number back rather than reverting it.
    expect(scaledDistance(ps.peakDistanceMeters!, 0.8)).toBe(3200);
  });

  it("re-anchors a switch to time on the time peak and drops the distance one", async () => {
    await updateProgramSet({ id: setId, distanceMeters: null, durationSeconds: 1200, anchor: "duration" });
    const ps = await row();
    expect(ps.peakDurationSeconds).toBe(1500);
    expect(ps.peakDistanceMeters).toBeNull();
  });

  it("keeps the peak when the save did not change the distance", async () => {
    // 3000 is not 80% of 5000; re-deriving would move the peak to 3750.
    await updateProgramSet({ id: setId, distanceMeters: 3000, restTimeSeconds: 120, anchor: "distance" });
    expect((await row()).peakDistanceMeters).toBe(5000);
  });

  it("takes the typed value as the peak when the program is in no active cycle", async () => {
    await db.update(trainingCycles).set({ status: "completed" }).where(eq(trainingCycles.id, cycleId));
    await updateProgramSet({ id: setId, distanceMeters: 3200, anchor: "distance" });
    expect((await row()).peakDistanceMeters).toBe(3200);
  });

  it("never anchors a set that was not periodized", async () => {
    const { slots } = await createProgram(userId, [
      { exerciseId, sets: [{ targetReps: null, weightKg: "0", distanceMeters: 3000 }] },
    ]);
    const plain = slots[0].setIds[0];
    await updateProgramSet({ id: plain, distanceMeters: 4000, anchor: "distance" });
    const [ps] = await db.select().from(programSets).where(eq(programSets.id, plain));
    expect(ps.peakDistanceMeters).toBeNull();
  });
});

describe("MCP edit_program_exercise keeps a periodized set in the block", () => {
  type Handler = (args: Record<string, unknown>) => Promise<unknown>;
  function editTool(): Handler {
    let handler: Handler | undefined;
    const server = {
      registerTool(name: string, _def: unknown, fn: Handler) {
        if (name === "edit_program_exercise") handler = fn;
      },
    } as unknown as McpServer;
    registerProgramTools(server, userId);
    return handler!;
  }
  const anchors = async () =>
    (
      await db
        .select({ peak: programSets.peakDistanceMeters, d: programSets.distanceMeters })
        .from(programSets)
        .where(eq(programSets.programExerciseId, slotId))
    )[0];

  beforeEach(async () => {
    await db.update(trainingCycles).set({ lastSyncedWeek: 1 }).where(eq(trainingCycles.id, cycleId));
  });

  it("carries the anchor across a set replace that leaves the distance alone", async () => {
    await editTool()({ operation: "update", programExerciseId: slotId, sets: [{ setNumber: 1, distanceMeters: 3000 }] });
    expect(await anchors()).toEqual({ peak: 5000, d: 3000 });
  });

  it("re-anchors a changed distance as this week's", async () => {
    await editTool()({ operation: "update", programExerciseId: slotId, sets: [{ setNumber: 1, distanceMeters: 3200 }] });
    expect(await anchors()).toEqual({ peak: 4000, d: 3200 });
  });
});
