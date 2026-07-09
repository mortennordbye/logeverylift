"use server";

import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
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

export type AdminInsightsData = {
  summary: InsightsSummary;
  funnel: InsightsFunnel;
  users: InsightUserRow[];
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
    ]);

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
      },
    };
  } catch (e) {
    if (e instanceof ForbiddenError) return { success: false, error: e.message };
    console.error("[getAdminInsights] failed", e);
    return { success: false, error: "Failed to load insights" };
  }
}
