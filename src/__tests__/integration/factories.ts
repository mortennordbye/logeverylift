import { db } from "@/db";
import {
  exercises,
  oauthAccessTokens,
  oauthClients,
  oauthConsents,
  oauthRefreshTokens,
  programExercises,
  programSets,
  programs,
  users,
  workoutSessions,
} from "@/db/schema";

/**
 * Rows for integration tests. Each helper inserts the minimum a real flow
 * needs and returns the ids. Defaults are plain strength-training values; pass
 * overrides for anything a test asserts on, so the test reads on its own.
 */

let counter = 0;
const next = () => ++counter;

export async function createUser(overrides: Partial<typeof users.$inferInsert> = {}) {
  const n = next();
  const now = new Date();
  const [row] = await db
    .insert(users)
    .values({
      id: `user-${n}`,
      name: `User ${n}`,
      email: `user-${n}@test.local`,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .returning();
  return row;
}

export async function createExercise(overrides: Partial<typeof exercises.$inferInsert> = {}) {
  const [row] = await db
    .insert(exercises)
    .values({ name: `Exercise ${next()}`, category: "strength", ...overrides })
    .returning();
  return row;
}

type SetSpec = Partial<Omit<typeof programSets.$inferInsert, "programExerciseId" | "setNumber">>;

/**
 * A program with one or more exercises, each with its sets in order. Returns
 * the program and, per exercise, its program_exercise id and set ids in
 * position order.
 */
export async function createProgram(
  userId: string,
  exerciseSpecs: { exerciseId: number; sets: SetSpec[] }[],
) {
  const [program] = await db.insert(programs).values({ userId, name: `Program ${next()}` }).returning();
  const slots: { programExerciseId: number; exerciseId: number; setIds: number[] }[] = [];
  for (const [orderIndex, spec] of exerciseSpecs.entries()) {
    const [pe] = await db
      .insert(programExercises)
      .values({ programId: program.id, exerciseId: spec.exerciseId, orderIndex })
      .returning();
    const sets = await db
      .insert(programSets)
      .values(
        spec.sets.map((s, i) => ({
          programExerciseId: pe.id,
          setNumber: i + 1,
          targetReps: 8,
          weightKg: "80",
          restTimeSeconds: 90,
          ...s,
        })),
      )
      .returning({ id: programSets.id });
    slots.push({ programExerciseId: pe.id, exerciseId: spec.exerciseId, setIds: sets.map((s) => s.id) });
  }
  return { program, slots };
}

export async function createSession(
  userId: string,
  programId: number | null,
  overrides: Partial<typeof workoutSessions.$inferInsert> = {},
) {
  const now = new Date();
  const [row] = await db
    .insert(workoutSessions)
    .values({
      userId,
      programId,
      date: now.toISOString().slice(0, 10),
      startTime: now,
      isCompleted: false,
      ...overrides,
    })
    .returning();
  return row;
}

/** A registered MCP client, as dynamic registration leaves it (no owner). */
export async function createOAuthClient(overrides: Partial<typeof oauthClients.$inferInsert> = {}) {
  const n = next();
  const [row] = await db
    .insert(oauthClients)
    .values({
      id: `oc-${n}`,
      clientId: `client-${n}`,
      name: `Assistant ${n}`,
      redirectUris: ["http://127.0.0.1/cb"],
      scopes: ["openid", "profile", "email", "offline_access", "mcp:read", "mcp:write"],
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    })
    .returning();
  return row;
}

/**
 * A user's connection to a client: the consent plus a refresh token and an
 * opaque access token with the same scopes.
 */
export async function createOAuthConnection(userId: string, clientId: string, scopes: string[]) {
  const n = next();
  const now = new Date();
  const later = new Date(now.getTime() + 3_600_000);
  const [consent] = await db
    .insert(oauthConsents)
    .values({ id: `consent-${n}`, clientId, userId, scopes, createdAt: now, updatedAt: now })
    .returning();
  const [refresh] = await db
    .insert(oauthRefreshTokens)
    .values({ id: `rt-${n}`, token: `rt-token-${n}`, clientId, userId, scopes, createdAt: now, expiresAt: later })
    .returning();
  const [access] = await db
    .insert(oauthAccessTokens)
    .values({ id: `at-${n}`, token: `at-token-${n}`, clientId, userId, scopes, createdAt: now, expiresAt: later, refreshId: refresh.id })
    .returning();
  return { consent, refresh, access };
}
