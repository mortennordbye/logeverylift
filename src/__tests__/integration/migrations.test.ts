import { db } from "@/db";
import { exercisePrs, workoutSets } from "@/db/schema";
import { asc, sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createExercise, createProgram, createSession, createUser } from "./factories";

/**
 * Data steps in migrations, run against rows shaped like the production data
 * they were written for. The schema half is covered by global-setup applying
 * every migration; these check what a migration does to existing rows.
 */

/** One statement from a migration file, by a fragment it starts with. */
function statement(file: string, startsWith: string): string {
  const text = readFileSync(path.resolve(__dirname, "../../../drizzle", file), "utf8");
  const found = text
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .find((s) => s.replace(/^(--.*\n)+/, "").startsWith(startsWith));
  if (!found) throw new Error(`no statement starting "${startsWith}" in ${file}`);
  return found;
}

describe("0059: link superseded records to the PR that beat them", () => {
  let userId: string;
  let exerciseId: number;

  beforeEach(async () => {
    userId = (await createUser()).id;
    exerciseId = (await createExercise()).id;
  });

  async function legacy(row: Partial<typeof exercisePrs.$inferInsert> & { prType: string; value: string }) {
    const [r] = await db
      .insert(exercisePrs)
      .values({ userId, exerciseId, ...row })
      .returning({ id: exercisePrs.id });
    return r.id;
  }

  it("links each chain in order and keeps loads and brackets apart", async () => {
    const t = (s: number) => new Date(Date.UTC(2026, 0, 1, 7, 0, s));
    // Weight: 80 beaten by 85, beaten by 90 (current).
    const w80 = await legacy({ prType: "weight", value: "80", achievedAt: t(0), supersededAt: t(10) });
    const w85 = await legacy({ prType: "weight", value: "85", achievedAt: t(10), supersededAt: t(20) });
    const w90 = await legacy({ prType: "weight", value: "90", achievedAt: t(20) });
    // Reps at 60 kg superseded, with an unrelated 100 kg record inserted in between.
    const r60 = await legacy({ prType: "reps_at_weight", value: "8", weightKg: "60", achievedAt: t(0), supersededAt: t(30) });
    const r100 = await legacy({ prType: "reps_at_weight", value: "5", weightKg: "100", achievedAt: t(30) });
    const r60b = await legacy({ prType: "reps_at_weight", value: "10", weightKg: "60", achievedAt: t(30) });
    // Pace in two brackets, the 5 km one superseded.
    const p5 = await legacy({ prType: "pace", value: "1500", bracket: "5 km", distanceMeters: 5000, achievedAt: t(0), supersededAt: t(40) });
    const p1 = await legacy({ prType: "pace", value: "300", bracket: "1 km", distanceMeters: 1000, achievedAt: t(40) });
    const p5b = await legacy({ prType: "pace", value: "1400", bracket: "5 km", distanceMeters: 5000, achievedAt: t(40) });

    await db.execute(sql.raw(statement("0059_pr_superseded_by.sql", 'UPDATE "exercise_prs"')));

    const rows = await db.select().from(exercisePrs).orderBy(asc(exercisePrs.id));
    const linkOf = (id: number) => rows.find((r) => r.id === id)?.supersededById ?? null;
    expect(linkOf(w80)).toBe(w85);
    expect(linkOf(w85)).toBe(w90);
    expect(linkOf(w90)).toBeNull();
    expect(linkOf(r60)).toBe(r60b);
    expect(linkOf(r100)).toBeNull();
    expect(linkOf(p5)).toBe(p5b);
    expect(linkOf(p1)).toBeNull();
  });
});

describe("0058: drop duplicate logs of one program set before keying on it", () => {
  it("keeps the latest row per (session, program set) and leaves the rest alone", async () => {
    const userId = (await createUser()).id;
    const exerciseId = (await createExercise()).id;
    const { program, slots } = await createProgram(userId, [{ exerciseId, sets: [{}, {}] }]);
    const [a, b] = slots[0].setIds;
    const session = await createSession(userId, program.id);
    const row = (programSetId: number | null, setNumber: number, weightKg: string) => ({
      sessionId: session.id,
      exerciseId,
      programExerciseId: slots[0].programExerciseId,
      programSetId,
      setNumber,
      actualReps: 8,
      weightKg,
      restTimeSeconds: 90,
    });

    // The duplicates the old position key allowed only exist without the new
    // index, so take it away for the length of the test.
    await db.execute(sql`DROP INDEX "uniq_wsets_session_program_set"`);
    try {
      await db.insert(workoutSets).values([
        row(a, 1, "80"), // superseded by the re-log below
        row(b, 2, "82.5"),
        row(a, 3, "81"), // A re-logged after a move
        row(null, 4, "70"), // unslotted rows are never duplicates of each other
        row(null, 5, "70"),
      ]);
      await db.execute(sql.raw(statement("0058_wsets_key_on_program_set.sql", 'DELETE FROM "workout_sets"')));
    } finally {
      await db.execute(sql`CREATE UNIQUE INDEX "uniq_wsets_session_program_set" ON "workout_sets" ("session_id","program_set_id")`);
    }

    const left = await db.select().from(workoutSets).orderBy(asc(workoutSets.setNumber));
    expect(left.map((r) => [r.programSetId, r.weightKg])).toEqual([
      [b, "82.50"],
      [a, "81.00"],
      [null, "70.00"],
      [null, "70.00"],
    ]);
  });
});
