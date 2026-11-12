import { db, pool } from "@/db";
import { workoutSessions, workoutSets } from "@/db/schema";
import { deleteGhostSessions, findGhostSessions } from "@/lib/ghost-sessions";
import { eq } from "drizzle-orm";
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

  it("leaves empty sessions from the last week, whose sets may still be queued on a phone", async () => {
    const recent = new Date(Date.now() - 2 * 86_400_000);
    const young = await done({ startTime: recent, endTime: recent });
    expect(await findGhostSessions()).toEqual([]);
    expect(await deleteGhostSessions()).toEqual([]);
    expect(await remainingIds()).toEqual([young.id]);
  });

  it("keeps a session whose first set commits while the delete runs", async () => {
    const ghost = await done();
    const other = await pool.connect();
    try {
      // A set is being written, not yet committed, as the cleanup starts.
      await other.query("BEGIN");
      await other.query(
        `INSERT INTO workout_sets (session_id, exercise_id, set_number, actual_reps, weight_kg, rest_time_seconds)
         VALUES ($1, $2, 1, 5, 100, 90)`,
        [ghost.id, exerciseId],
      );
      const cleanup = deleteGhostSessions();
      // The cleanup waits for the set's lock on the session row.
      await expect
        .poll(async () => {
          const { rows } = await pool.query(
            "SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query ILIKE '%workout_sessions%'",
          );
          return rows[0].n;
        })
        .toBeGreaterThan(0);
      await other.query("COMMIT");

      expect(await cleanup).toEqual([]);
      expect(await remainingIds()).toEqual([ghost.id]);
      expect(await db.select().from(workoutSets).where(eq(workoutSets.sessionId, ghost.id))).toHaveLength(1);
    } finally {
      other.release();
    }
  });
});
