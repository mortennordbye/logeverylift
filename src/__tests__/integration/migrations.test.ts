import { db } from "@/db";
import {
  exercisePrs,
  oauthClients,
  oauthConsents,
  oauthRefreshTokens,
  planRevisions,
  seasonRaces,
  seasons,
  trainingCycles,
  users,
  workoutSets,
} from "@/db/schema";
import { asc, eq, sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createExercise,
  createOAuthClient,
  createOAuthConnection,
  createProgram,
  createSession,
  createUser,
} from "./factories";

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

describe("0067: create workout_reactions where 0022 was skipped", () => {
  const file = "0067_restore_workout_reactions.sql";
  const run = async () => {
    for (const s of readFileSync(path.resolve(__dirname, "../../../drizzle", file), "utf8").split("--> statement-breakpoint")) {
      await db.execute(sql.raw(s));
    }
  };
  const constraints = async () =>
    (
      await db.execute<{ conname: string }>(
        sql`SELECT conname FROM pg_constraint WHERE conrelid = 'workout_reactions'::regclass ORDER BY conname`,
      )
    ).rows.map((r) => r.conname);

  it("rebuilds the table on a database that never got it, and is a no-op where it exists", async () => {
    const before = await constraints();
    await db.execute(sql`DROP TABLE "workout_reactions"`);
    try {
      await run();
      expect(await constraints()).toEqual(before);
      await run();
      expect(await constraints()).toEqual(before);
    } finally {
      await db.execute(sql.raw(statement(file, 'CREATE TABLE IF NOT EXISTS "workout_reactions"')));
    }
  });
});

describe("0080: MCP scopes", () => {
  const file = "0080_mcp_scopes.sql";
  const run = async () => {
    for (const s of readFileSync(path.resolve(__dirname, "../../../drizzle", file), "utf8").split("--> statement-breakpoint")) {
      await db.execute(sql.raw(s));
    }
  };
  const OLD = ["openid", "profile", "email", "offline_access"];

  it("lets old clients ask for the scopes, ends old connections, keeps new ones, and is idempotent", async () => {
    const me = (await createUser()).id;
    const oldClient = await createOAuthClient({ scopes: OLD });
    const newClient = await createOAuthClient();
    const unscoped = await createOAuthClient({ scopes: null });
    const old = await createOAuthConnection(me, oldClient.clientId, ["openid", "offline_access"]);
    const kept = await createOAuthConnection(me, newClient.clientId, ["openid", "mcp:read"]);

    await run();
    const scopesOf = async (clientId: string) =>
      (await db.select({ scopes: oauthClients.scopes }).from(oauthClients).where(eq(oauthClients.clientId, clientId)))[0].scopes;
    expect(await scopesOf(oldClient.clientId)).toEqual([...OLD, "mcp:read", "mcp:write"]);
    expect(await scopesOf(newClient.clientId)).toEqual([...OLD, "mcp:read", "mcp:write"]);
    expect(await scopesOf(unscoped.clientId)).toBeNull();

    expect(await db.select().from(oauthConsents).where(eq(oauthConsents.id, old.consent.id))).toEqual([]);
    expect(await db.select().from(oauthConsents).where(eq(oauthConsents.id, kept.consent.id))).toHaveLength(1);
    const revokedOf = async (id: string) =>
      (await db.select({ revoked: oauthRefreshTokens.revoked }).from(oauthRefreshTokens).where(eq(oauthRefreshTokens.id, id)))[0].revoked;
    const revokedAt = await revokedOf(old.refresh.id);
    expect(revokedAt).not.toBeNull();
    expect(await revokedOf(kept.refresh.id)).toBeNull();

    await run();
    expect(await scopesOf(oldClient.clientId)).toEqual([...OLD, "mcp:read", "mcp:write"]);
    expect(await revokedOf(old.refresh.id)).toEqual(revokedAt);
  });
});

describe("0081: the endurance switch starts on for those who use it", () => {
  it("turns it on for admins and triathlon-generator users only", async () => {
    const admin = await createUser({ role: "admin" });
    const triathlete = await createUser();
    const lifter = await createUser();
    await db.insert(trainingCycles).values([
      { userId: triathlete.id, name: "Triathlon", durationWeeks: 12, athleteLevel: "intermediate" },
      { userId: lifter.id, name: "Strength", durationWeeks: 8 },
    ]);

    await db.execute(sql.raw(statement("0081_user_settings_endurance.sql", 'UPDATE "user"')));

    const rows = await db.select({ id: users.id, on: users.enduranceEnabled }).from(users);
    const on = new Map(rows.map((r) => [r.id, r.on]));
    expect(on.get(admin.id)).toBe(true);
    expect(on.get(triathlete.id)).toBe(true);
    expect(on.get(lifter.id)).toBe(false);
  });
});

describe("0083: custom exercise names are unique per user", () => {
  it("lets two users share a custom name, and keeps system names and each user's names unique", async () => {
    const a = await createUser();
    const b = await createUser();
    await createExercise({ name: "Back Squat" });
    await createExercise({ name: "Trail run", category: "cardio", userId: a.id, isCustom: true });
    await createExercise({ name: "Trail run", category: "cardio", userId: b.id, isCustom: true });

    await expect(createExercise({ name: "Back Squat" })).rejects.toThrow();
    await expect(createExercise({ name: "Trail run", category: "cardio", userId: a.id, isCustom: true })).rejects.toThrow();
  });
});

describe("0085: triathlon cycles move into a season", () => {
  it("makes a season per cycle with a race or from the generator, and leaves the rest alone", async () => {
    const tri = await createUser();
    const lifter = await createUser();
    const [withRace, generated, strength, deleted] = await db
      .insert(trainingCycles)
      .values([
        { userId: tri.id, name: "Half build", durationWeeks: 16, athleteLevel: "novice", startDate: "2027-04-19", raceDate: "2027-08-22", raceDistance: "half", status: "active", version: 3 },
        { userId: tri.id, name: "Old base", durationWeeks: 8, athleteLevel: "intermediate", status: "completed", startDate: "2026-01-05" },
        { userId: lifter.id, name: "Strength", durationWeeks: 8 },
        { userId: tri.id, name: "Gone", durationWeeks: 8, raceDate: "2027-01-01", deletedAt: new Date() },
      ])
      .returning();

    await db.execute(sql.raw(statement("0085_seasons.sql", "DO $$")));

    const all = await db.select().from(seasons).orderBy(asc(seasons.id));
    expect(all.map((s) => [s.userId, s.name, s.startDate, s.endDate])).toEqual([
      [tri.id, "Half build", "2027-04-19", "2027-08-22"],
      [tri.id, "Old base", "2026-01-05", "2026-03-01"],
    ]);
    expect(await db.select().from(seasonRaces)).toEqual([
      expect.objectContaining({ seasonId: all[0].id, userId: tri.id, raceDate: "2027-08-22", discipline: "triathlon", distance: "half", priority: "A" }),
    ]);
    const rows = new Map((await db.select().from(trainingCycles)).map((c) => [c.id, c]));
    expect(rows.get(withRace.id)).toMatchObject({
      seasonId: all[0].id,
      phaseOrder: 1,
      phaseType: null,
      raceDate: null,
      raceDistance: null,
      version: 4,
      status: "active",
    });
    expect(rows.get(generated.id)).toMatchObject({ seasonId: all[1].id, phaseOrder: 1, version: 2 });
    expect(rows.get(strength.id)).toMatchObject({ seasonId: null, version: 1 });
    expect(rows.get(deleted.id)).toMatchObject({ seasonId: null, raceDate: "2027-01-01" });
  });

  it("keeps a distance with no date as a race on the season's last day, flagged to check", async () => {
    const tri = await createUser();
    const [c] = await db
      .insert(trainingCycles)
      .values({ userId: tri.id, name: "Half build", durationWeeks: 4, athleteLevel: "novice", startDate: "2027-04-19", raceDistance: "half" })
      .returning();
    await db.execute(sql.raw(statement("0085_seasons.sql", "DO $$")));
    const [s] = await db.select().from(seasons);
    expect(s).toMatchObject({ endDate: "2027-05-16", replanReason: expect.stringContaining("date") });
    expect(s.replanFlaggedAt).not.toBeNull();
    expect(await db.select({ raceDate: seasonRaces.raceDate, distance: seasonRaces.distance, priority: seasonRaces.priority }).from(seasonRaces)).toEqual([
      { raceDate: "2027-05-16", distance: "half", priority: "A" },
    ]);
    expect((await db.select().from(trainingCycles).where(eq(trainingCycles.id, c.id)))[0]).toMatchObject({ raceDistance: null, seasonId: s.id });
  });

  it("writes a baseline of the moved state, so the history does not blame the next writer", async () => {
    const tri = await createUser();
    const [c] = await db
      .insert(trainingCycles)
      .values({ userId: tri.id, name: "Half build", durationWeeks: 8, athleteLevel: "novice", raceDate: "2027-08-22", raceDistance: "half" })
      .returning();
    await db.insert(planRevisions).values({
      userId: tri.id,
      objectType: "cycle",
      objectId: c.id,
      version: 1,
      action: "baseline",
      writer: "user",
      snapshot: { v: 1, cycle: { id: c.id, name: "Half build", raceDate: "2027-08-22" }, slots: [] },
    });
    await db.execute(sql.raw(statement("0085_seasons.sql", "DO $$")));
    const [s] = await db.select().from(seasons);
    const cycleRevs = await db.select().from(planRevisions).where(eq(planRevisions.objectType, "cycle")).orderBy(asc(planRevisions.id));
    expect(cycleRevs).toHaveLength(2);
    expect(cycleRevs[1]).toMatchObject({ action: "baseline", writer: "sync", reason: "Moved into a season", version: 2 });
    expect((cycleRevs[1].snapshot as { cycle: Record<string, unknown> }).cycle).toMatchObject({ seasonId: s.id, raceDate: null, phaseOrder: 1 });
    const seasonRevs = await db.select().from(planRevisions).where(eq(planRevisions.objectType, "season"));
    expect(seasonRevs).toEqual([expect.objectContaining({ objectId: s.id, action: "baseline", writer: "sync", reason: "Moved into a season", version: 1 })]);
    expect((seasonRevs[0].snapshot as { races: unknown[]; phases: unknown[] }).races).toHaveLength(1);
    expect((seasonRevs[0].snapshot as { phases: unknown[] }).phases).toEqual([{ cycleId: c.id, name: "Half build", phaseOrder: 1, phaseType: null }]);
  });
});
