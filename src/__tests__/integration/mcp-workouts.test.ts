import { db } from "@/db";
import { exerciseNotes, exercisePrs, workoutSets } from "@/db/schema";
import { registerWorkoutTools } from "@/lib/mcp/tools/workouts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beforeEach, describe, expect, it } from "vitest";
import { createExercise, createSession, createUser } from "./factories";

type Handler = (args: Record<string, unknown>) => Promise<{
  content: { text: string }[];
  isError?: boolean;
}>;

/** The tools as one token's holder would reach them, called with real queries. */
function toolsFor(userId: string) {
  const tools = new Map<string, Handler>();
  registerWorkoutTools(
    {
      registerTool: (name: string, _config: unknown, handler: Handler) => tools.set(name, handler),
    } as unknown as McpServer,
    userId,
  );
  return async (name: string, args: Record<string, unknown> = {}) => {
    const result = await tools.get(name)!(args);
    const raw = result.content[0].text;
    return { ...result, raw, data: result.isError ? null : JSON.parse(raw) };
  };
}

async function logSession(
  userId: string,
  exerciseId: number,
  sets: { reps: number; weightKg: string; notes?: string }[],
  overrides: Parameters<typeof createSession>[2] = {},
) {
  const session = await createSession(userId, null, {
    isCompleted: true,
    endTime: new Date(Date.now() + 45 * 60_000),
    ...overrides,
  });
  for (const [i, set] of sets.entries()) {
    await db.insert(workoutSets).values({
      sessionId: session.id,
      exerciseId,
      setNumber: i + 1,
      actualReps: set.reps,
      weightKg: set.weightKg,
      notes: set.notes,
      restTimeSeconds: 90,
    });
  }
  return session;
}

let me: string;
let other: string;
let bench: { id: number; name: string };

beforeEach(async () => {
  me = (await createUser()).id;
  other = (await createUser()).id;
  bench = await createExercise({ name: "Bench Press" });
});

describe("the workout history tools", () => {
  it("answers what was lifted, with sets under their exercise", async () => {
    await logSession(me, bench.id, [
      { reps: 8, weightKg: "80.00" },
      { reps: 6, weightKg: "85.00" },
    ]);

    const { data } = await toolsFor(me)("recent_workouts", { days: 7 });

    expect(data.workouts).toHaveLength(1);
    expect(data.workouts[0].durationMinutes).toBe(45);
    expect(data.workouts[0].exercises[0].exercise).toBe("Bench Press");
    expect(
      data.workouts[0].exercises[0].sets.map((s: { reps: number; weightKg: number }) => [
        s.reps,
        s.weightKg,
      ]),
    ).toEqual([
      [8, 80],
      [6, 85],
    ]);
  });

  it("never returns another user's workouts, whichever tool is asked", async () => {
    await logSession(other, bench.id, [{ reps: 5, weightKg: "100.00" }]);
    await db.insert(exercisePrs).values({
      userId: other,
      exerciseId: bench.id,
      prType: "weight",
      value: "100.00",
      achievedAt: new Date(),
    });
    const call = toolsFor(me);

    expect((await call("recent_workouts", { days: 90 })).data.workouts).toEqual([]);
    expect((await call("personal_records", { limit: 100 })).data.records).toEqual([]);
    expect((await call("weekly_volume", { weeks: 52 })).data.weeks).toEqual([]);
    expect((await call("summary_stats")).data.totalSessions).toBe(0);
    const history = await call("exercise_history", { exercise: "Bench", sessions: 10 });
    expect(history.isError).toBe(true);
    expect(history.raw).toContain("No logged exercise matches");
  });

  it("returns session, set and exercise notes (decision D6), never another user's", async () => {
    await logSession(me, bench.id, [{ reps: 8, weightKg: "80.00", notes: "shoulder-pain-note" }], {
      notes: "bad-sleep-note",
    });
    await db.insert(exerciseNotes).values([
      { userId: me, exerciseId: bench.id, note: "elbows-in-note" },
      { userId: other, exerciseId: bench.id, note: "others-note" },
    ]);
    const call = toolsFor(me);

    const recent = (await call("recent_workouts", { days: 7 })).data;
    expect(recent.workouts[0].notes).toBe("bad-sleep-note");
    expect(recent.workouts[0].exercises[0].sets[0].notes).toBe("shoulder-pain-note");

    const history = await call("exercise_history", { exercise: "Bench", sessions: 5 });
    expect(history.data.note).toBe("elbows-in-note");
    expect(history.data.sessions[0].notes).toBe("bad-sleep-note");
    expect(history.data.sessions[0].sets[0].notes).toBe("shoulder-pain-note");
    expect(history.raw).not.toContain("others-note");
  });

  it("leaves unfinished workouts out", async () => {
    await logSession(me, bench.id, [{ reps: 8, weightKg: "80.00" }], { isCompleted: false });

    expect((await toolsFor(me)("recent_workouts", { days: 7 })).data.workouts).toEqual([]);
  });

  it("finds an exercise by part of its name, and asks when several match", async () => {
    const incline = await createExercise({ name: "Incline Bench Press" });
    await logSession(me, bench.id, [{ reps: 8, weightKg: "80.00" }]);
    await logSession(me, incline.id, [{ reps: 8, weightKg: "60.00" }]);
    const call = toolsFor(me);

    const several = await call("exercise_history", { exercise: "bench", sessions: 5 });
    expect(several.data.candidates.sort()).toEqual(["Bench Press", "Incline Bench Press"]);

    const exact = await call("exercise_history", { exercise: "bench press", sessions: 5 });
    expect(exact.data.exercise).toBe("Bench Press");
    expect(exact.data.sessions[0].sets[0].weightKg).toBe(80);
  });

  it("treats a wildcard in the name as a literal character", async () => {
    await logSession(me, bench.id, [{ reps: 8, weightKg: "80.00" }]);

    const res = await toolsFor(me)("exercise_history", { exercise: "%", sessions: 5 });

    expect(res.isError).toBe(true);
  });

  it("adds up volume and sessions per week", async () => {
    await logSession(me, bench.id, [
      { reps: 10, weightKg: "50.00" },
      { reps: 10, weightKg: "50.00" },
    ]);

    const { weeks } = (await toolsFor(me)("weekly_volume", { weeks: 4 })).data;

    expect(weeks).toHaveLength(1);
    expect(weeks[0]).toMatchObject({ sessions: 1, volumeKg: 1000 });
    const stats = (await toolsFor(me)("summary_stats")).data;
    expect(stats).toMatchObject({ totalSessions: 1, lifetimeVolumeKg: 1000, currentStreakWeeks: 1 });
  });
});
