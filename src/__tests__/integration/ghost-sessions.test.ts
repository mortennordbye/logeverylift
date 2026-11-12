import { db } from "@/db";
import { workoutSessions, workoutSets } from "@/db/schema";
import { deleteGhostSessions, findGhostSessions } from "@/lib/ghost-sessions";
import { beforeEach, describe, expect, it } from "vitest";
import { createExercise, createSession, createUser } from "./factories";

let userId: string;
let exerciseId: number;

beforeEach(async () => {
  userId = (await createUser()).id;
  exerciseId = (await createExercise()).id;
});

const start = new Date("2026-10-01T08:00:00Z");
const done = (overrides: Parameters<typeof createSession>[2] = {}) =>
  createSession(userId, null, {
    isCompleted: true,
    startTime: start,
    endTime: new Date(start.getTime() + 14 * 3_600_000),
    date: "2026-10-01",
    ...overrides,
  });

async function remainingIds() {
  return (await db.select({ id: workoutSessions.id }).from(workoutSessions)).map((r) => r.id).sort();
}

describe("the ghost-session cleanup", () => {
  it("lists only completed app sessions with no sets, notes or feeling, and deletes nothing", async () => {
    const ghost = await done();
    const withSet = await done();
    await db.insert(workoutSets).values({
      sessionId: withSet.id,
      exerciseId,
      setNumber: 1,
      actualReps: 5,
      weightKg: "100",
      restTimeSeconds: 90,
    });
    const withNote = await done({ notes: "Felt off, stopped" });
    const withFeeling = await done({ feeling: "Tired" });
    const auto = await done({ source: "auto" });
    const open = await createSession(userId, null);

    const ghosts = await findGhostSessions();

    expect(ghosts).toEqual([{ id: ghost.id, userId, date: "2026-10-01", hours: 14 }]);
    expect(await remainingIds()).toEqual(
      [ghost.id, withSet.id, withNote.id, withFeeling.id, auto.id, open.id].sort(),
    );
  });

  it("deletes the ghosts and keeps everything else", async () => {
    const ghost = await done();
    const blankNote = await done({ notes: "  " });
    const withNote = await done({ notes: "Kept" });
    const auto = await done({ source: "auto" });

    const deleted = await deleteGhostSessions();

    expect(deleted.sort()).toEqual([ghost.id, blankNote.id].sort());
    expect(await remainingIds()).toEqual([withNote.id, auto.id].sort());
  });
});
