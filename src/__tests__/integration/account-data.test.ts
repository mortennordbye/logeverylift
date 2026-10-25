import { db } from "@/db";
import { accounts, exercises, gyms, sessions, users, workoutSets } from "@/db/schema";
import { exportMyData } from "@/lib/actions/account";
import { collectUserData, handOverSharedCustomExercises, purgeExpiredSessions } from "@/lib/account-data";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createExercise, createSession, createUser } from "./factories";
import { asUser } from "./setup";

let meId: string;
let otherId: string;

beforeEach(async () => {
  meId = (await createUser({ name: "Me", weightKg: 81 })).id;
  otherId = (await createUser({ name: "Other", weightKg: 64 })).id;
});

async function logSet(userId: string, exerciseId: number) {
  const session = await createSession(userId, null);
  const [set] = await db
    .insert(workoutSets)
    .values({ sessionId: session.id, exerciseId, setNumber: 1, actualReps: 5, weightKg: "100", restTimeSeconds: 90 })
    .returning();
  return { session, set };
}

describe("collectUserData", () => {
  it("covers every table that holds rows belonging to a user", async () => {
    // Tables with a foreign key to "user", plus tables that hang off those.
    const { rows } = await db.execute<{ table: string }>(sql`
      WITH RECURSIVE owned(rel) AS (
        SELECT '"user"'::regclass
        UNION
        SELECT c.conrelid FROM pg_constraint c JOIN owned o ON c.confrelid = o.rel
        WHERE c.contype = 'f' AND c.conrelid <> c.confrelid
      )
      SELECT relname AS table FROM owned JOIN pg_class ON pg_class.oid = owned.rel
    `);
    const exported = Object.keys(await collectUserData(meId));
    const missing = rows.map((r) => r.table).filter((t) => t !== "user" && !exported.includes(t));
    expect(missing).toEqual([]);
  });

  it("returns only this user's rows and leaves out credentials", async () => {
    const exercise = await createExercise();
    const mine = await logSet(meId, exercise.id);
    await logSet(otherId, exercise.id);
    const now = new Date();
    await db.insert(accounts).values({
      id: "acc-1", accountId: meId, providerId: "credential", userId: meId,
      password: "hash-secret", createdAt: now, updatedAt: now,
    });
    await db.insert(sessions).values({
      id: "ses-1", token: "token-secret", userId: meId, ipAddress: "10.0.0.1",
      expiresAt: now, createdAt: now, updatedAt: now,
    });

    const data = await collectUserData(meId);
    expect(data.user.weightKg).toBe(81);
    expect(data.workout_sessions.map((s) => s.id)).toEqual([mine.session.id]);
    expect(data.workout_sets.map((s) => s.id)).toEqual([mine.set.id]);
    expect(data.session[0].ipAddress).toBe("10.0.0.1");

    const json = JSON.stringify(data);
    expect(json).not.toContain("hash-secret");
    expect(json).not.toContain("token-secret");
    expect(json).not.toContain(otherId);
  });
});

describe("exportMyData", () => {
  it("names the primary gym, not just its id", async () => {
    const [gym] = await db
      .insert(gyms)
      .values({ osmRef: "node/77", name: "SATS Majorstuen", lat: 59.93, lng: 10.71, address: "Kirkeveien 12" })
      .returning();
    await db.update(users).set({ primaryGymId: gym.id }).where(eq(users.id, meId));
    const data = await collectUserData(meId);
    expect(data.primaryGym).toEqual({ name: "SATS Majorstuen", address: "Kirkeveien 12", osmRef: "node/77" });
  });

  it("exports the caller's data", async () => {
    asUser(meId);
    const result = await exportMyData();
    if (!result.success) throw new Error(result.error);
    expect(JSON.parse(result.data).user.id).toBe(meId);
  });
});

describe("handOverSharedCustomExercises", () => {
  it("keeps another user's logged sets when the exercise's owner is deleted", async () => {
    const custom = await createExercise({ name: "My Press", isCustom: true, userId: meId });
    const onlyMine = await createExercise({ name: "My Curl", isCustom: true, userId: meId });
    const theirs = await logSet(otherId, custom.id);
    await logSet(meId, onlyMine.id);

    await handOverSharedCustomExercises(meId);
    await db.delete(users).where(eq(users.id, meId));

    const [set] = await db.select().from(workoutSets).where(eq(workoutSets.id, theirs.set.id));
    expect(set?.exerciseId).toBe(custom.id);
    const [moved] = await db.select().from(exercises).where(eq(exercises.id, custom.id));
    expect(moved.userId).toBe(otherId);
    expect(await db.select().from(exercises).where(eq(exercises.id, onlyMine.id))).toEqual([]);
  });
});

describe("purgeExpiredSessions", () => {
  it("deletes expired sessions and keeps live ones", async () => {
    const now = Date.now();
    for (const [id, expiresAt] of [["old", now - 1000], ["live", now + 60_000]] as const) {
      await db.insert(sessions).values({
        id, token: `t-${id}`, userId: meId, expiresAt: new Date(expiresAt),
        createdAt: new Date(now), updatedAt: new Date(now),
      });
    }
    await purgeExpiredSessions();
    expect((await db.select({ id: sessions.id }).from(sessions)).map((s) => s.id)).toEqual(["live"]);
  });
});
