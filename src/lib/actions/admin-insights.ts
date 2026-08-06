"use server";

import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  customWeightUsage,
  exercises,
  programs,
  trainingCycles,
  users,
  workoutSessions,
} from "@/db/schema";
import { ForbiddenError, requireAdmin } from "@/lib/utils/session";
import type { ActionResult } from "@/types/workout";

export type InsightUserRow = {
  id: string;
  name: string;
  email: string;
  joinedAt: Date;
  programCount: number;
  cycleCount: number;
  activeCycleCount: number;
  completedSessionCount: number;
  customExerciseCount: number;
  lastActiveDate: string | null;
};

export type InsightsSummary = {
  totalUsers: number;
  activeLastSevenDays: number;
  activeLastThirtyDays: number;
  totalCompletedSessions: number;
  totalPrograms: number;
  totalCycles: number;
  totalCustomExercises: number;
};

export type InsightsFunnel = {
  usersWithProgram: number;
  usersWithCycle: number;
  usersWithCompletedSession: number;
  usersWithCustomExercise: number;
};

/**
 * Weights people typed in by hand because the 2.5 kg preset ladder didn't
 * offer them. `values` is ordered by how often each weight was typed, so the
 * top entries are the circles a given exercise is missing.
 */
export type CustomWeightRow = {
  exerciseId: number;
  exerciseName: string;
  uses: number;
  userCount: number;
  values: { weightKg: number; uses: number }[];
};

export type AdminInsightsData = {
  summary: InsightsSummary;
  funnel: InsightsFunnel;
  users: InsightUserRow[];
  customWeights: CustomWeightRow[];
};

export async function getAdminInsights(): Promise<ActionResult<AdminInsightsData>> {
  try {
    await requireAdmin();
    const [
      [{ count: totalUsers }],
      [{ count: active7 }],
      [{ count: active30 }],
      [{ count: totalSessions }],
      [{ count: totalPrograms }],
      [{ count: totalCycles }],
      [{ count: totalCustomExercises }],
      [{ count: usersWithProgram }],
      [{ count: usersWithCycle }],
      [{ count: usersWithSession }],
      [{ count: usersWithCustom }],
      userRows,
      customWeightExercises,
      customWeightValues,
    ] = await Promise.all([
      // Summary scalars
      db.select({ count: sql<number>`COUNT(*)` }).from(users),
      db
        .select({ count: sql<number>`COUNT(DISTINCT ${workoutSessions.userId})` })
        .from(workoutSessions)
        .where(
          and(
            eq(workoutSessions.isCompleted, true),
            sql`${workoutSessions.startTime} >= NOW() - interval '7 days'`,
          ),
        ),
      db
        .select({ count: sql<number>`COUNT(DISTINCT ${workoutSessions.userId})` })
        .from(workoutSessions)
        .where(
          and(
            eq(workoutSessions.isCompleted, true),
            sql`${workoutSessions.startTime} >= NOW() - interval '30 days'`,
          ),
        ),
      db
        .select({ count: sql<number>`COUNT(*)` })
        .from(workoutSessions)
        .where(eq(workoutSessions.isCompleted, true)),
      db.select({ count: sql<number>`COUNT(*)` }).from(programs),
      db.select({ count: sql<number>`COUNT(*)` }).from(trainingCycles),
      db
        .select({ count: sql<number>`COUNT(*)` })
        .from(exercises)
        .where(eq(exercises.isCustom, true)),

      // Funnel scalars
      db
        .select({ count: sql<number>`COUNT(DISTINCT ${programs.userId})` })
        .from(programs),
      db
        .select({ count: sql<number>`COUNT(DISTINCT ${trainingCycles.userId})` })
        .from(trainingCycles),
      db
        .select({ count: sql<number>`COUNT(DISTINCT ${workoutSessions.userId})` })
        .from(workoutSessions)
        .where(eq(workoutSessions.isCompleted, true)),
      db
        .select({ count: sql<number>`COUNT(DISTINCT ${exercises.userId})` })
        .from(exercises)
        .where(and(eq(exercises.isCustom, true), isNotNull(exercises.userId))),

      // Per-user breakdown
      db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          joinedAt: users.createdAt,
          programCount: sql<number>`COUNT(DISTINCT ${programs.id})`,
          cycleCount: sql<number>`COUNT(DISTINCT ${trainingCycles.id})`,
          activeCycleCount: sql<number>`COUNT(DISTINCT CASE WHEN ${trainingCycles.status} = 'active' THEN ${trainingCycles.id} END)`,
          completedSessionCount: sql<number>`COUNT(DISTINCT CASE WHEN ${workoutSessions.isCompleted} = true THEN ${workoutSessions.id} END)`,
          customExerciseCount: sql<number>`COUNT(DISTINCT CASE WHEN ${exercises.isCustom} = true THEN ${exercises.id} END)`,
          lastActiveDate: sql<string | null>`MAX(CASE WHEN ${workoutSessions.isCompleted} = true THEN ${workoutSessions.date} END)`,
        })
        .from(users)
        .leftJoin(programs, eq(programs.userId, users.id))
        .leftJoin(trainingCycles, eq(trainingCycles.userId, users.id))
        .leftJoin(workoutSessions, eq(workoutSessions.userId, users.id))
        .leftJoin(
          exercises,
          and(eq(exercises.userId, users.id), eq(exercises.isCustom, true)),
        )
        .groupBy(users.id, users.name, users.email, users.createdAt)
        .orderBy(
          desc(
            sql`MAX(CASE WHEN ${workoutSessions.isCompleted} = true THEN ${workoutSessions.startTime} END)`,
          ),
        ),

      // Custom weights — which exercises drive manual entry...
      db
        .select({
          exerciseId: customWeightUsage.exerciseId,
          exerciseName: exercises.name,
          uses: sql<number>`COUNT(*)`,
          userCount: sql<number>`COUNT(DISTINCT ${customWeightUsage.userId})`,
        })
        .from(customWeightUsage)
        .innerJoin(exercises, eq(exercises.id, customWeightUsage.exerciseId))
        .groupBy(customWeightUsage.exerciseId, exercises.name)
        .orderBy(desc(sql`COUNT(*)`))
        .limit(30),

      // ...and which weights they reach for.
      db
        .select({
          exerciseId: customWeightUsage.exerciseId,
          weightKg: customWeightUsage.weightKg,
          uses: sql<number>`COUNT(*)`,
        })
        .from(customWeightUsage)
        .groupBy(customWeightUsage.exerciseId, customWeightUsage.weightKg)
        .orderBy(desc(sql`COUNT(*)`)),
    ]);

    const valuesByExercise = new Map<number, { weightKg: number; uses: number }[]>();
    for (const row of customWeightValues) {
      const list = valuesByExercise.get(row.exerciseId) ?? [];
      list.push({ weightKg: row.weightKg, uses: Number(row.uses ?? 0) });
      valuesByExercise.set(row.exerciseId, list);
    }

    return {
      success: true,
      data: {
        summary: {
          totalUsers: Number(totalUsers ?? 0),
          activeLastSevenDays: Number(active7 ?? 0),
          activeLastThirtyDays: Number(active30 ?? 0),
          totalCompletedSessions: Number(totalSessions ?? 0),
          totalPrograms: Number(totalPrograms ?? 0),
          totalCycles: Number(totalCycles ?? 0),
          totalCustomExercises: Number(totalCustomExercises ?? 0),
        },
        funnel: {
          usersWithProgram: Number(usersWithProgram ?? 0),
          usersWithCycle: Number(usersWithCycle ?? 0),
          usersWithCompletedSession: Number(usersWithSession ?? 0),
          usersWithCustomExercise: Number(usersWithCustom ?? 0),
        },
        users: userRows.map((row) => ({
          id: row.id,
          name: row.name,
          email: row.email,
          joinedAt: row.joinedAt,
          programCount: Number(row.programCount ?? 0),
          cycleCount: Number(row.cycleCount ?? 0),
          activeCycleCount: Number(row.activeCycleCount ?? 0),
          completedSessionCount: Number(row.completedSessionCount ?? 0),
          customExerciseCount: Number(row.customExerciseCount ?? 0),
          lastActiveDate: row.lastActiveDate ?? null,
        })),
        customWeights: customWeightExercises.map((row) => ({
          exerciseId: row.exerciseId,
          exerciseName: row.exerciseName,
          uses: Number(row.uses ?? 0),
          userCount: Number(row.userCount ?? 0),
          values: valuesByExercise.get(row.exerciseId) ?? [],
        })),
      },
    };
  } catch (e) {
    if (e instanceof ForbiddenError) return { success: false, error: e.message };
    console.error("[getAdminInsights] failed", e);
    return { success: false, error: "Failed to load insights" };
  }
}
