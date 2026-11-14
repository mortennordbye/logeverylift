import { db } from "@/db";
import { plannedSessions, trainingCycleSlots, trainingCycles, workoutSessions } from "@/db/schema";
import { updatePlannedSession } from "@/lib/actions/planned-sessions";
import { homeEndurance } from "@/lib/session-answers";
import { and, eq } from "drizzle-orm";
import CycleDetailPage from "@/app/cycles/[id]/page";
import { CycleCompletionBanner } from "@/components/features/CycleCompletionBanner";
import { CycleWeek, RotationOrder, TemplateWeek } from "@/components/features/CycleSessionsClient";
import { StartCycleButton } from "@/components/features/CycleDetailClient";
import { isValidElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExercise, createProgram, createUser } from "./factories";
import { asUser } from "./setup";

/**
 * The cycle detail page reads what each state shows (docs/plans/plan-tab-redesign.md,
 * P2): a weekday block's dated sessions and the week of today, a rotation's
 * order from its walk, a scheduled draft's sessions from its start day, and
 * the cycle scheduled after a completed one. The clock is fixed at
 * Thu 2026-11-19 12:00 UTC; the zone is UTC.
 */

const TODAY = "2026-11-19";
let me: string;
let lift: number;
let run: number;

/** The props of the first element of `type` in a rendered tree. */
function propsOf<P>(tree: ReactNode, type: unknown): P | null {
  if (Array.isArray(tree)) {
    for (const t of tree) {
      const found = propsOf<P>(t, type);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement(tree)) return null;
  if (tree.type === type) return tree.props as P;
  return propsOf<P>((tree.props as { children?: ReactNode }).children, type);
}

const page = (id: number) => CycleDetailPage({ params: Promise.resolve({ id: String(id) }) });

beforeEach(async () => {
  me = (await createUser({ timeZone: "UTC" })).id;
  asUser(me);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
  const ex = await createExercise({ name: "Squat" });
  lift = (await createProgram(me, [{ exerciseId: ex.id, sets: [{}] }])).program.id;
  run = (await createProgram(me, [{ exerciseId: ex.id, sets: [{}] }])).program.id;
});

afterEach(() => vi.useRealTimers());

async function weekdayCycle(values: Partial<typeof trainingCycles.$inferInsert>) {
  const [c] = await db
    .insert(trainingCycles)
    .values({ userId: me, name: "Block", durationWeeks: 4, ...values })
    .returning();
  await db.insert(trainingCycleSlots).values([
    { trainingCycleId: c.id, dayOfWeek: 1, programId: lift },
    { trainingCycleId: c.id, dayOfWeek: 4, programId: run },
  ]);
  return c.id;
}

describe("cycle detail page", () => {
  it("a running weekday block: its dated sessions and the week that holds today", async () => {
    const id = await weekdayCycle({ status: "active", startDate: "2026-11-09" });
    const week = propsOf<Parameters<typeof CycleWeek>[0]>(await page(id), CycleWeek)!;
    expect(week.weeks).toHaveLength(4);
    expect(week.initialWeek).toBe(1);
    expect(week.sessions.map((s) => [s.date, s.programId])).toEqual([
      ["2026-11-09", lift],
      ["2026-11-12", run],
      ["2026-11-16", lift],
      ["2026-11-19", run],
      ["2026-11-23", lift],
      ["2026-11-26", run],
      ["2026-11-30", lift],
      ["2026-12-03", run],
    ]);
    expect(week.sessions[0]).toMatchObject({ status: "missed", exercises: "Squat", key: false, answer: null });
    // A lifter gets no workouts library (D18).
    expect(week.library).toBeUndefined();
  });

  it("a scheduled weekday draft: its sessions from the start day, and Start today instead", async () => {
    const id = await weekdayCycle({ scheduledStartDate: "2026-11-23" });
    const tree = await page(id);
    expect(propsOf<{ scheduledFor: string }>(tree, StartCycleButton)?.scheduledFor).toBe("2026-11-23");
    const week = propsOf<Parameters<typeof CycleWeek>[0]>(tree, CycleWeek)!;
    expect(week.weeks[0].from).toBe("2026-11-23");
    expect(week.sessions[0]).toMatchObject({ date: "2026-11-23", status: "planned" });
  });

  it("a weekday draft with no start day: its template week", async () => {
    const id = await weekdayCycle({});
    const tree = await page(id);
    expect(propsOf(tree, CycleWeek)).toBeNull();
    const template = propsOf<Parameters<typeof TemplateWeek>[0]>(tree, TemplateWeek)!;
    expect(template.days.map((d) => d.sessions.length)).toEqual([1, 0, 0, 1, 0, 0, 0]);
  });

  it("a running rotation: its order, the last done, and the next session", async () => {
    const [c] = await db
      .insert(trainingCycles)
      .values({ userId: me, name: "Rotation", durationWeeks: 4, status: "active", startDate: "2026-11-18", scheduleType: "rotation" })
      .returning();
    await db.insert(trainingCycleSlots).values([
      { trainingCycleId: c.id, orderIndex: 1, programId: lift },
      { trainingCycleId: c.id, orderIndex: 2, programId: run },
    ]);
    await db.insert(workoutSessions).values({ userId: me, programId: lift, date: "2026-11-18", isCompleted: true });
    const order = propsOf<Parameters<typeof RotationOrder>[0]>(await page(c.id), RotationOrder)!;
    expect(order.active).toBe(true);
    expect(order.rows.map((r) => [r.programId, r.mark, r.lastDone, r.upcoming?.rotationPosition])).toEqual([
      [lift, "done", "2026-11-18", 2],
      [run, "next", null, 1],
    ]);
  });

  it("a completed cycle: the cycle scheduled next", async () => {
    const id = await weekdayCycle({ status: "completed", startDate: "2026-10-01" });
    const next = await weekdayCycle({ name: "Peak", scheduledStartDate: "2026-11-30" });
    const banner = propsOf<Parameters<typeof CycleCompletionBanner>[0]>(await page(id), CycleCompletionBanner)!;
    expect(banner.next).toEqual({ id: next, name: "Peak", startsLabel: "Mon 30 Nov", startsTomorrow: false });
    expect(banner.endedLabel).toBe("ended 28 Oct");
    expect(banner.running).toBeNull();
  });

  it("a missed key session carries the day home suggests for it", async () => {
    me = (await createUser({ timeZone: "UTC", enduranceEnabled: true })).id;
    asUser(me);
    const runEx = await createExercise({ name: `Run ${Math.random()}`, category: "cardio", discipline: "run" });
    // 90 min: the week's long run is key.
    const longRun = (await createProgram(me, [{ exerciseId: runEx.id, sets: [{ durationSeconds: 5400, targetReps: null, weightKg: null }] }])).program.id;
    const [c] = await db.insert(trainingCycles).values({ userId: me, name: "Base", durationWeeks: 4, status: "active", startDate: "2026-11-16" }).returning();
    await db.insert(trainingCycleSlots).values({ trainingCycleId: c.id, dayOfWeek: 2, daySlot: 1, programId: longRun });
    await page(c.id); // the lazy backfill makes the dated sessions
    const [tue] = await db.select().from(plannedSessions).where(and(eq(plannedSessions.cycleId, c.id), eq(plannedSessions.date, "2026-11-17")));
    expect((await updatePlannedSession({ op: "miss", id: tue.id })).success).toBe(true);

    const home = await homeEndurance(me);
    expect(home.missedKey.map((m) => m.suggestion)).toEqual([{ date: "2026-11-19" }]);
    const week = propsOf<Parameters<typeof CycleWeek>[0]>(await page(c.id), CycleWeek)!;
    expect(week.sessions.find((s) => s.id === tue.id)?.moveTo).toEqual(home.missedKey[0].suggestion);
  });

  it("a start or a completed card knows the running cycle, its week, and the draft scheduled next", async () => {
    const runningId = await weekdayCycle({ name: "Upper / Lower hypertrophy", durationWeeks: 6, status: "active", startDate: "2026-11-02" });
    const peak = await weekdayCycle({ name: "Peak", scheduledStartDate: "2026-11-30" });
    const draft = await weekdayCycle({ name: "Later" });
    const start = propsOf<Parameters<typeof StartCycleButton>[0]>(await page(draft), StartCycleButton)!;
    expect(start.running).toEqual({ id: runningId, name: "Upper / Lower hypertrophy", week: 3, totalWeeks: 6 });
    expect(start.otherScheduled).toEqual({ id: peak, name: "Peak", day: "2026-11-30" });
    // The scheduled draft itself: its own start is no other draft's.
    expect(propsOf<Parameters<typeof StartCycleButton>[0]>(await page(peak), StartCycleButton)!.otherScheduled).toBeNull();

    const old = await weekdayCycle({ status: "completed", startDate: "2026-09-01" });
    const banner = propsOf<Parameters<typeof CycleCompletionBanner>[0]>(await page(old), CycleCompletionBanner)!;
    expect(banner.running).toMatchObject({ id: runningId });
  });
});
