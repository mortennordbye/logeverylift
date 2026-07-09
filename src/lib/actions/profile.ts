"use server";

import { db } from "@/db";
import { users } from "@/db/schema/users";
import { userWeightEntries } from "@/db/schema/weight-history";
import { GOAL_VALUES } from "@/lib/utils/goals";
import { requireSession } from "@/lib/utils/session";
import type { ActionResult } from "@/types/workout";
import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

export type WeightEntry = {
  id: string;
  weightKg: number;
  recordedAt: string;
};

const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  gender: z.enum(["male", "female", "other", "prefer_not_to_say"]).nullable().optional(),
  birthYear: z.number().int().min(1900).max(new Date().getFullYear()).nullable().optional(),
  heightCm: z.number().int().positive().max(300).nullable().optional(),
  weightKg: z.number().positive().max(500).nullable().optional(),
  goals: z.array(z.enum(GOAL_VALUES)).max(5).nullable().optional(),
  experienceLevel: z.enum(["beginner", "intermediate", "advanced"]).nullable().optional(),
});

export async function updateUserProfile(data: unknown): Promise<ActionResult<void>> {
  const session = await requireSession();
  const parsed = updateProfileSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  }
  try {
    const current = await db.query.users.findFirst({ where: eq(users.id, session.user.id) });

    const { goals, ...rest } = parsed.data;
    const goalsValue =
      goals !== undefined
        ? { goals: goals && goals.length > 0 ? JSON.stringify(goals) : null }
        : {};

    await db.update(users).set({ ...rest, ...goalsValue }).where(eq(users.id, session.user.id));

    // Auto-log weight entry when weight changes
    const newWeight = parsed.data.weightKg;
    if (newWeight != null && newWeight !== current?.weightKg) {
      await db.insert(userWeightEntries).values({
        id: crypto.randomUUID(),
        userId: session.user.id,
        weightKg: newWeight,
        recordedAt: new Date(),
      });
    }

    revalidatePath("/more/account");
    revalidatePath("/more/metrics");
    return { success: true, data: undefined };
  } catch {
    return { success: false, error: "Failed to update profile" };
  }
}

export async function getWeightHistory(): Promise<ActionResult<WeightEntry[]>> {
  const session = await requireSession();
  try {
    const rows = await db
      .select()
      .from(userWeightEntries)
      .where(eq(userWeightEntries.userId, session.user.id))
      .orderBy(desc(userWeightEntries.recordedAt));
    return {
      success: true,
      data: rows.map((r) => ({
        id: r.id,
        weightKg: r.weightKg,
        recordedAt: r.recordedAt.toISOString(),
      })),
    };
  } catch {
    return { success: false, error: "Failed to fetch weight history" };
  }
}

const logWeightSchema = z.object({
  weightKg: z.number().positive().max(500),
  recordedAt: z.string().datetime().optional(),
});

export async function logWeightEntry(data: unknown): Promise<ActionResult<WeightEntry>> {
  const session = await requireSession();
  const parsed = logWeightSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  }
  try {
    const recordedAt = parsed.data.recordedAt ? new Date(parsed.data.recordedAt) : new Date();
    const id = crypto.randomUUID();
    await db.insert(userWeightEntries).values({
      id,
      userId: session.user.id,
      weightKg: parsed.data.weightKg,
      recordedAt,
    });
    // Keep users.weightKg in sync with the latest entry
    await db
      .update(users)
      .set({ weightKg: parsed.data.weightKg })
      .where(eq(users.id, session.user.id));
    revalidatePath("/more/metrics");
    revalidatePath("/more/account");
    return {
      success: true,
      data: { id, weightKg: parsed.data.weightKg, recordedAt: recordedAt.toISOString() },
    };
  } catch {
    return { success: false, error: "Failed to log weight" };
  }
}

export async function deleteWeightEntry(id: string): Promise<ActionResult<void>> {
  const session = await requireSession();
  try {
    await db
      .delete(userWeightEntries)
      .where(and(eq(userWeightEntries.id, id), eq(userWeightEntries.userId, session.user.id)));
    revalidatePath("/more/metrics");
    return { success: true, data: undefined };
  } catch {
    return { success: false, error: "Failed to delete entry" };
  }
}
