/**
 * One local demo account with realistic data, for the README and landing
 * page screenshots.
 *
 *   showcase@demo.local   about 20 weeks of upper/lower training with slow
 *                         progress and a deload every fourth week, a few
 *                         missed days, two past cycles, a goal season in its
 *                         first phase, body weight, a home layout with
 *                         widgets, and Claude connected with coach notes.
 *
 * Dates are relative to the run day. Each run deletes the account (and with it
 * all its data) and makes it again. No other account is touched. The random
 * draws are seeded, so two runs on the same day give the same data.
 *
 * Local databases only:
 *   docker exec logeverylift-app pnpm db:seed-showcase-demo
 */

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

const DEMO_PASSWORD = "showcase-demo-password";
const EMAIL = "showcase@demo.local";
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

/** mulberry32: a small seeded random, so the data is the same on every run. */
function seeded(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  const { auth } = await import("../src/lib/auth");
  const { db } = await import("../src/db");
  const s = await import("../src/db/schema");
  const { LEGAL_VERSION } = await import("../src/lib/constants/legal");
  const rev = await import("../src/lib/plan-revisions");
  const seasonsLib = await import("../src/lib/seasons");
  const sessionsLib = await import("../src/lib/planned-sessions");
  const { addCoachMemory } = await import("../src/lib/coach-memory");
  const { writeLoggedSession } = await import("../src/lib/logged-sessions");
  const { MCP_READ_SCOPE, MCP_WRITE_SCOPE } = await import("../src/lib/mcp/scopes");
  const { userToday } = await import("../src/lib/user-settings");
  const { instantInZone } = await import("../src/lib/utils/user-date");
  const { toDateStr } = await import("../src/lib/utils/cycle-position");
  const { addDaysStr } = await import("../src/lib/utils/seasons");
  const { mondayOf } = await import("../src/lib/utils/session-compliance");
  const { isNull } = await import("drizzle-orm");

  type Ctx = { userId: string; writer: "user" };
  /** kg is the load today; history climbs to it. step is the plate step for rounding. */
  type Lift = { name: string; sets: number; reps: number; kg: number; step: number };

  const random = seeded(20261116);

  // ── Account ───────────────────────────────────────────────────────────────

  const [old] = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.email, EMAIL));
  if (old) {
    // Plan revisions have no FK to the user's plans; the rest cascades from the user.
    await db.delete(s.planRevisions).where(eq(s.planRevisions.userId, old.id));
    await db.delete(s.users).where(eq(s.users.id, old.id));
    console.log("Deleted the old showcase account");
  }
  await db.delete(s.oauthClients).where(eq(s.oauthClients.clientId, "showcase-demo-claude"));

  const res = await auth.api.createUser({ body: { name: "Alex", email: EMAIL, password: DEMO_PASSWORD } });
  const userId = res.user.id;
  const ctx: Ctx = { userId, writer: "user" };
  const nowIso = new Date().toISOString();
  await db
    .update(s.users)
    .set({
      tutorialDismissedAt: new Date(),
      termsVersion: LEGAL_VERSION,
      policySeenVersion: LEGAL_VERSION,
      termsAcceptedAt: new Date(),
      healthConsentAt: new Date(),
      timeZone: DEMO_TZ,
      goals: '["strength","muscle_gain"]',
      experienceLevel: "intermediate",
      homeLayout: {
        v: 1,
        updatedAt: nowIso,
        items: [
          { id: "title", size: "m", hidden: false },
          { id: "today", size: "l", hidden: false },
          { id: "week", size: "l", hidden: false },
          { id: "streak", size: "s", hidden: false },
          { id: "weeklyGoal", size: "s", hidden: false },
          { id: "recentPrs", size: "m", hidden: false },
          { id: "weeklySets", size: "s", hidden: false },
          { id: "bodyWeight", size: "s", hidden: false },
          { id: "cycle", size: "m", hidden: false },
        ],
      },
    })
    .where(eq(s.users.id, userId));

  const exerciseIds = new Map(
    (await db.select({ id: s.exercises.id, name: s.exercises.name }).from(s.exercises).where(isNull(s.exercises.userId))).map((e) => [e.name, e.id]),
  );
  const exerciseId = (name: string) => {
    const id = exerciseIds.get(name);
    if (id == null) throw new Error(`Exercise "${name}" is not in the library. Run pnpm db:seed first.`);
    return id;
  };

  // ── Programs ──────────────────────────────────────────────────────────────

  const UPPER_A: Lift[] = [
    { name: "Bench Press", sets: 4, reps: 6, kg: 97.5, step: 2.5 },
    { name: "Barbell Row", sets: 4, reps: 8, kg: 80, step: 2.5 },
    { name: "Overhead Press", sets: 3, reps: 8, kg: 52.5, step: 2.5 },
    { name: "Lat Pulldown", sets: 3, reps: 10, kg: 65, step: 2.5 },
    { name: "Dumbbell Curl", sets: 3, reps: 12, kg: 16, step: 2 },
  ];
  const LOWER_A: Lift[] = [
    { name: "Squat", sets: 4, reps: 5, kg: 125, step: 2.5 },
    { name: "Romanian Deadlift", sets: 3, reps: 8, kg: 100, step: 2.5 },
    { name: "Leg Press", sets: 3, reps: 10, kg: 180, step: 5 },
    { name: "Lying Leg Curl", sets: 3, reps: 12, kg: 45, step: 2.5 },
    { name: "Calf Raise", sets: 3, reps: 15, kg: 70, step: 5 },
  ];
  const UPPER_B: Lift[] = [
    { name: "Incline Bench Press", sets: 4, reps: 8, kg: 77.5, step: 2.5 },
    { name: "Pull-up", sets: 4, reps: 8, kg: 0, step: 0 },
    { name: "Dumbbell Shoulder Press", sets: 3, reps: 10, kg: 26, step: 2 },
    { name: "Seated Cable Row", sets: 3, reps: 10, kg: 70, step: 2.5 },
    { name: "Tricep Pushdown", sets: 3, reps: 12, kg: 32.5, step: 2.5 },
  ];
  const LOWER_B: Lift[] = [
    { name: "Deadlift", sets: 3, reps: 5, kg: 160, step: 2.5 },
    { name: "Front Squat", sets: 3, reps: 6, kg: 90, step: 2.5 },
    { name: "Bulgarian Split Squat", sets: 3, reps: 10, kg: 24, step: 2 },
    { name: "Leg Extension", sets: 3, reps: 12, kg: 55, step: 2.5 },
    { name: "Hanging Leg Raise", sets: 3, reps: 12, kg: 0, step: 0 },
  ];

  async function makeProgram(name: string, lifts: Lift[]): Promise<number> {
    const { result } = await rev.planWrite(ctx, async (w) => {
      const [p] = await w.tx.insert(s.programs).values({ userId, name }).returning({ id: s.programs.id });
      w.create({ type: "program", id: p.id });
      for (const [i, l] of lifts.entries()) {
        const [pe] = await w.tx
          .insert(s.programExercises)
          .values({ programId: p.id, exerciseId: exerciseId(l.name), orderIndex: i, progressionAdvance: "load" })
          .returning({ id: s.programExercises.id });
        await w.tx.insert(s.programSets).values(
          Array.from({ length: l.sets }, (_, n) => ({
            programExerciseId: pe.id,
            setNumber: n + 1,
            targetReps: l.reps,
            weightKg: String(l.kg),
            targetRir: 2,
            restTimeSeconds: l.kg >= 90 ? 180 : 120,
          })),
        );
      }
      return p.id;
    });
    return result;
  }

  const ua = await makeProgram("Upper A", UPPER_A);
  const la = await makeProgram("Lower A", LOWER_A);
  const ub = await makeProgram("Upper B", UPPER_B);
  const lb = await makeProgram("Lower B", LOWER_B);
  const byDay = new Map<number, { programId: number; lifts: Lift[] }>([
    [1, { programId: ua, lifts: UPPER_A }],
    [2, { programId: la, lifts: LOWER_A }],
    [4, { programId: ub, lifts: UPPER_B }],
    [5, { programId: lb, lifts: LOWER_B }],
  ]);

  async function addWeekdaySlots(cycleId: number) {
    await rev.planWrite(ctx, async (w) => {
      await w.touch({ type: "cycle", id: cycleId });
      for (const [day, programId, label] of [
        [1, ua, null], [2, la, null], [3, null, "Rest"], [4, ub, null], [5, lb, null], [6, null, "Rest"], [7, null, "Rest"],
      ] as const) {
        await sessionsLib.upsertSlotInTx(w.tx, cycleId, { dayOfWeek: day, orderIndex: null }, { programId, label });
      }
    });
  }

  async function makeCycle(name: string, weeks: number): Promise<number> {
    const { result: id } = await rev.planWrite(ctx, async (w) => {
      const [row] = await w.tx
        .insert(s.trainingCycles)
        .values({ userId, name, durationWeeks: weeks, scheduleType: "day_of_week", endAction: "none" })
        .returning({ id: s.trainingCycles.id });
      w.create({ type: "cycle", id: row.id });
      return row.id;
    });
    await addWeekdaySlots(id);
    return id;
  }

  // ── Plan: two past cycles, then a goal season in its first phase ─────────

  const today = toDateStr(await userToday(userId));
  const thisMonday = mondayOf(today);
  const seasonStart = addDaysStr(thisMonday, -3 * 7); // week 4 of the first phase
  const fiveStart = addDaysStr(seasonStart, -8 * 7);
  const baseStart = addDaysStr(fiveStart, -8 * 7 - 7); // one week off between blocks
  const totalWeeks = Math.round((Date.parse(today) - Date.parse(baseStart)) / (7 * 86_400_000));

  const base = await makeCycle("Hypertrophy base", 8);
  const five = await makeCycle("Strength 5×5", 8);
  await rev.activateCycle(ctx, base, undefined, baseStart);
  await rev.activateCycle(ctx, five, undefined, fiveStart);

  const { season } = await seasonsLib.createSeason(ctx, {
    name: "Stronger by spring",
    goal: "Bench 110 kg, squat 140 kg, deadlift 180 kg",
    startDate: seasonStart,
    endDate: addDaysStr(seasonStart, 14 * 7 - 1),
    nextGoal: "Hold the numbers through the summer",
  });
  const ph1 = await seasonsLib.addPhase(ctx, season.id, { name: "Volume", scheduleType: "day_of_week", durationWeeks: 6, takeStart: true });
  await addWeekdaySlots(ph1.cycleId);
  const ph2 = await seasonsLib.addPhase(ctx, season.id, { name: "Strength", scheduleType: "day_of_week", durationWeeks: 5 });
  await addWeekdaySlots(ph2.cycleId);
  const ph3 = await seasonsLib.addPhase(ctx, season.id, { name: "Peak and test", scheduleType: "day_of_week", durationWeeks: 3 });
  await addWeekdaySlots(ph3.cycleId);
  await rev.activateCycle(ctx, ph1.cycleId, undefined, seasonStart);

  // ── History ───────────────────────────────────────────────────────────────

  /** Load in week `week` (0 = first): about 80% of today, up by today, 10% off on deload weeks. */
  function loadFor(l: Lift, week: number, deload: boolean): number {
    if (l.step === 0) return 0;
    const progress = Math.min(1, week / Math.max(1, totalWeeks - 1));
    const raw = l.kg * (0.8 + 0.2 * progress) * (deload ? 0.9 : 1);
    return Math.round(raw / l.step) * l.step;
  }

  const FEELINGS = ["Good", "Good", "Awesome", "OK", "Good", "Tired"] as const;
  let logged = 0;
  for (let day = 0; addDaysStr(baseStart, day) < today; day++) {
    const date = addDaysStr(baseStart, day);
    const dow = ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
    const plan = byDay.get(dow);
    if (!plan) continue;
    // The week off between the two past blocks.
    if (date >= addDaysStr(fiveStart, -7) && date < fiveStart) continue;
    // About one session in twelve is missed, never in the last week.
    if (date < addDaysStr(today, -7) && random() < 0.08) continue;

    const week = Math.floor(day / 7);
    const deload = week % 4 === 3;
    const sets = plan.lifts.flatMap((l) => {
      const kg = loadFor(l, week, deload);
      return Array.from({ length: l.sets }, (_, n) => {
        // Body weight lifts grow in reps; the last set sometimes falls one short.
        const extra = l.step === 0 ? Math.floor((week / totalWeeks) * 3) - 2 : 0;
        const short = n === l.sets - 1 && !deload && random() < 0.3 ? 1 : 0;
        const rir = deload ? 3 : n === l.sets - 1 ? 1 : 2;
        return { exerciseId: exerciseId(l.name), setNumber: n + 1, reps: l.reps + extra - short, weightKg: kg, rir: random() < 0.75 ? rir : undefined };
      });
    });
    const hour = random() < 0.7 ? 6 : 17;
    await writeLoggedSession(userId, {
      date,
      start: instantInZone(date, hour, Math.floor(random() * 4) * 15, DEMO_TZ),
      programId: plan.programId,
      plannedSessionId: null,
      durationMinutes: 52 + Math.floor(random() * 20),
      feeling: FEELINGS[Math.floor(random() * FEELINGS.length)],
      source: "app",
      sets,
    });
    logged++;
  }

  // ── Body weight: a slow cut from 84 kg ────────────────────────────────────

  const weights = [];
  for (let w = totalWeeks; w >= 0; w--) {
    const date = addDaysStr(today, -w * 7 - 1);
    const kg = 84 - (totalWeeks - w) * 0.12 + (random() - 0.5) * 0.6;
    weights.push({ id: randomUUID(), userId, weightKg: Math.round(kg * 10) / 10, recordedAt: instantInZone(date, 7, 0, DEMO_TZ) });
  }
  await db.insert(s.userWeightEntries).values(weights);

  // ── AI coach: Claude connected, one change and some notes ─────────────────

  const now = new Date();
  await db.insert(s.oauthClients).values({ id: randomUUID(), clientId: "showcase-demo-claude", name: "Claude", redirectUris: [], createdAt: now, updatedAt: now });
  await db.insert(s.oauthConsents).values({
    id: randomUUID(),
    clientId: "showcase-demo-claude",
    userId,
    scopes: ["openid", MCP_READ_SCOPE, MCP_WRITE_SCOPE],
    createdAt: new Date(now.getTime() - 40 * 86_400_000),
    updatedAt: now,
  });
  const claude = (reason: string) => ({ userId, writer: "assistant" as const, reason, changeSetId: randomUUID(), clientId: "showcase-demo-claude" });
  await addCoachMemory(ctx, { kind: "preference", text: "Trains before work, 60 minutes at most" });
  await addCoachMemory(ctx, { kind: "preference", text: "Barbell before machines" });
  await addCoachMemory(claude("Noted after the talk about the shoulder"), { kind: "observation", text: "Right shoulder feels tight on overhead press above 50 kg, warm up with band work" });
  await addCoachMemory(claude("Agreed plan rule"), { kind: "decision", text: "Deload every fourth week, cut sets by a third" });

  console.log(`${EMAIL}: ${logged} workouts over ${totalWeeks} weeks from ${baseStart}, season from ${seasonStart}`);
  console.log(`Password: ${DEMO_PASSWORD}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
