/**
 * Local demo accounts for the AI coach hub (docs/plans/ai-coach-hub.md).
 *
 *   coach-new@demo.local    no plan, no notes, no assistant (first open)
 *   coach-plan@demo.local   a weekday plan built in the builder, its one-week check-in due, two notes
 *   coach-power@demo.local  the same plan, Claude connected (read and change) and a second
 *                           assistant with a long name (read only), assistant changes and notes
 *
 * Dates are relative to the run day. Each run deletes the demo accounts (and
 * with them all their data) and makes them again. No other account is touched.
 * Plan writes go through planWrite, activateCycle and addCoachMemory, so
 * versions and revisions match what the app and the MCP tools write.
 *
 * Local databases only:
 *   docker exec logeverylift-app pnpm db:seed-coach-demo
 */

import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";

const DEMO_PASSWORD = "coach-demo-password";
const NEW = "coach-new@demo.local";
const PLAN = "coach-plan@demo.local";
const POWER = "coach-power@demo.local";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "postgres"]);
const DEMO_TZ = "Europe/Oslo";

function assertLocal() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to run with NODE_ENV=production");
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is not set");
  const host = new URL(raw).hostname;
  if (!LOCAL_HOSTS.has(host)) throw new Error(`Refusing to run against database host "${host}": local hosts only`);
}

// Checked before the app modules load: src/db opens its pool on import.
assertLocal();

async function main() {
  const { auth } = await import("../src/lib/auth");
  const { db } = await import("../src/db");
  const s = await import("../src/db/schema");
  const { LEGAL_VERSION } = await import("../src/lib/constants/legal");
  const rev = await import("../src/lib/plan-revisions");
  const sessionsLib = await import("../src/lib/planned-sessions");
  const { addCoachMemory } = await import("../src/lib/coach-memory");
  const { MCP_READ_SCOPE, MCP_WRITE_SCOPE } = await import("../src/lib/mcp/scopes");
  const { userToday } = await import("../src/lib/user-settings");
  const { toDateStr } = await import("../src/lib/utils/cycle-position");
  const { addDaysStr } = await import("../src/lib/utils/seasons");
  const { and, eq, isNull } = await import("drizzle-orm");

  type Lift = { name: string; sets: number; reps: number; kg: number };
  type Ctx = { userId: string; writer: "user" };

  const emails = [NEW, PLAN, POWER];
  const old = await db.select({ id: s.users.id }).from(s.users).where(inArray(s.users.email, emails));
  if (old.length) {
    const ids = old.map((u) => u.id);
    // Plan revisions have no FK to the user's plans; the rest cascades from the user.
    await db.delete(s.planRevisions).where(inArray(s.planRevisions.userId, ids));
    await db.delete(s.users).where(inArray(s.users.id, ids));
    console.log(`Deleted ${old.length} old demo account(s)`);
  }
  await db.delete(s.oauthClients).where(inArray(s.oauthClients.clientId, ["coach-demo-claude", "coach-demo-long"]));

  async function makeUser(email: string, name: string): Promise<string> {
    const res = await auth.api.createUser({ body: { name, email, password: DEMO_PASSWORD } });
    const id = res.user.id;
    await db
      .update(s.users)
      .set({
        tutorialDismissedAt: new Date(),
        termsVersion: LEGAL_VERSION,
        policySeenVersion: LEGAL_VERSION,
        termsAcceptedAt: new Date(),
        healthConsentAt: new Date(),
        timeZone: DEMO_TZ,
        goals: '["muscle_gain"]',
        experienceLevel: "intermediate",
      })
      .where(eq(s.users.id, id));
    return id;
  }

  const exerciseIds = new Map(
    (await db.select({ id: s.exercises.id, name: s.exercises.name }).from(s.exercises).where(isNull(s.exercises.userId))).map((e) => [e.name, e.id]),
  );
  const exerciseId = (name: string) => {
    const id = exerciseIds.get(name);
    if (id == null) throw new Error(`Exercise "${name}" is not in the library. Run pnpm db:seed first.`);
    return id;
  };

  const UPPER: Lift[] = [
    { name: "Bench Press", sets: 4, reps: 8, kg: 80 },
    { name: "Barbell Row", sets: 4, reps: 8, kg: 70 },
    { name: "Overhead Press", sets: 3, reps: 10, kg: 40 },
    { name: "Lat Pulldown", sets: 3, reps: 12, kg: 55 },
  ];
  const LOWER: Lift[] = [
    { name: "Squat", sets: 4, reps: 6, kg: 100 },
    { name: "Romanian Deadlift", sets: 3, reps: 8, kg: 80 },
    { name: "Leg Press", sets: 3, reps: 12, kg: 150 },
    { name: "Calf Raise", sets: 3, reps: 15, kg: 60 },
  ];

  async function makeProgram(ctx: Ctx, name: string, lifts: Lift[]): Promise<number> {
    const { result } = await rev.planWrite(ctx, async (w) => {
      const [p] = await w.tx.insert(s.programs).values({ userId: ctx.userId, name }).returning({ id: s.programs.id });
      w.create({ type: "program", id: p.id });
      for (const [i, l] of lifts.entries()) {
        const [pe] = await w.tx
          .insert(s.programExercises)
          .values({ programId: p.id, exerciseId: exerciseId(l.name), orderIndex: i })
          .returning({ id: s.programExercises.id });
        await w.tx.insert(s.programSets).values(
          Array.from({ length: l.sets }, (_, n) => ({
            programExerciseId: pe.id,
            setNumber: n + 1,
            targetReps: l.reps,
            weightKg: String(l.kg),
            restTimeSeconds: 120,
          })),
        );
      }
      return p.id;
    });
    return result;
  }

  /** The plan the builder makes for 4 days: Upper and Lower twice, Mon Tue Thu Fri, started 9 days ago. */
  async function makePlan(userId: string) {
    const ctx: Ctx = { userId, writer: "user" };
    const today = toDateStr(await userToday(userId));
    const ua = await makeProgram(ctx, "Upper A", UPPER);
    const la = await makeProgram(ctx, "Lower A", LOWER);
    const ub = await makeProgram(ctx, "Upper B", UPPER);
    const lb = await makeProgram(ctx, "Lower B", LOWER);
    const { result: cycleId } = await rev.planWrite(ctx, async (w) => {
      const [row] = await w.tx
        .insert(s.trainingCycles)
        .values({ userId, name: "8-Week Upper/Lower", durationWeeks: 8, scheduleType: "day_of_week", endAction: "none" })
        .returning({ id: s.trainingCycles.id });
      w.create({ type: "cycle", id: row.id });
      return row.id;
    });
    await rev.planWrite(ctx, async (w) => {
      await w.touch({ type: "cycle", id: cycleId });
      for (const [day, programId] of [[1, ua], [2, la], [4, ub], [5, lb]] as const) {
        await sessionsLib.upsertSlotInTx(w.tx, cycleId, { dayOfWeek: day, orderIndex: null }, { programId, label: null });
      }
    });
    await rev.activateCycle(ctx, cycleId, undefined, addDaysStr(today, -9));
    await db.insert(s.aiSetupPlans).values({
      userId,
      cycleId,
      picks: { goal: "muscle_gain", level: "intermediate", daysPerWeek: 4, equipment: "full_gym", weeks: 8, sessionMinutes: 60, split: "auto", priorities: [], avoid: [] },
    });
    return { ua, cycleId };
  }

  // ── 1. New user ───────────────────────────────────────────────────────────
  await makeUser(NEW, "Coach New Demo");
  console.log(`${NEW}: no plan`);

  // ── 2. Normal user with a plan ────────────────────────────────────────────
  {
    const userId = await makeUser(PLAN, "Coach Plan Demo");
    await makePlan(userId);
    const ctx = { userId, writer: "user" as const };
    await addCoachMemory(ctx, { kind: "preference", text: "Trains early, 45 minutes at most on weekdays" });
    await addCoachMemory(ctx, { kind: "limit", text: "No training on Wednesdays, kids' football" });
    console.log(`${PLAN}: plan with a due check-in, 2 notes`);
  }

  // ── 3. Power user with two assistants ─────────────────────────────────────
  {
    const userId = await makeUser(POWER, "Coach Power Demo");
    const { ua } = await makePlan(userId);
    await db.update(s.aiSetupPlans).set({ checkinStatus: "fits", checkinAnsweredAt: new Date() }).where(eq(s.aiSetupPlans.userId, userId));
    const now = new Date();
    await db.insert(s.oauthClients).values([
      { id: randomUUID(), clientId: "coach-demo-claude", name: "Claude", createdAt: now, updatedAt: now },
      { id: randomUUID(), clientId: "coach-demo-long", name: "My very long named personal training assistant", createdAt: now, updatedAt: now },
    ]);
    await db.insert(s.oauthConsents).values([
      { id: randomUUID(), clientId: "coach-demo-long", userId, scopes: ["openid", MCP_READ_SCOPE], createdAt: new Date(now.getTime() - 86_400_000), updatedAt: now },
      { id: randomUUID(), clientId: "coach-demo-claude", userId, scopes: ["openid", MCP_READ_SCOPE, MCP_WRITE_SCOPE], createdAt: now, updatedAt: now },
    ]);

    // Two assistant conversations: a weight step on bench press, then a note.
    const claude = (reason: string) => ({ userId, writer: "assistant" as const, reason, changeSetId: randomUUID(), clientId: "coach-demo-claude" });
    const [bench] = await db
      .select({ id: s.programExercises.id })
      .from(s.programExercises)
      .where(and(eq(s.programExercises.programId, ua), eq(s.programExercises.exerciseId, exerciseId("Bench Press"))));
    await rev.planWrite(claude("Bench moved well for three weeks, so up one step"), async (w) => {
      await w.touch({ type: "program", id: ua });
      await w.tx.update(s.programSets).set({ weightKg: "82.5" }).where(eq(s.programSets.programExerciseId, bench.id));
    });
    await addCoachMemory(claude("Noted after the talk about the knee"), { kind: "observation", text: "Left knee sore after lunges, use step-ups instead" });
    await addCoachMemory(claude("Agreed plan rule"), { kind: "decision", text: "Deload every fourth week" });
    await addCoachMemory({ userId, writer: "user" }, { kind: "preference", text: "Barbell before machines" });
    console.log(`${POWER}: plan, Claude (read and change) and a read-only assistant, 2 change sets, 3 notes`);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
