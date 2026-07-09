"use server";

import { db } from "@/db";
import { feedback, users } from "@/db/schema";
import { ForbiddenError, requireAdmin, requireSession } from "@/lib/utils/session";
import type { ActionResult } from "@/types/workout";
import { desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const submitFeedbackSchema = z.object({
  type: z.enum(["bug", "feature", "other"]),
  message: z.string().min(1, "Message is required").max(2000, "Message too long"),
});

export async function submitFeedback(data: unknown): Promise<ActionResult<void>> {
  const session = await requireSession();

  const parsed = submitFeedbackSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  }

  await db.insert(feedback).values({
    userId: session.user.id,
    type: parsed.data.type,
    message: parsed.data.message,
  });

  return { success: true, data: undefined };
}

export type FeedbackWithUser = {
  id: number;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  type: "bug" | "feature" | "other";
  message: string;
  status: "new" | "read";
  createdAt: Date;
};

export async function listFeedback(): Promise<ActionResult<FeedbackWithUser[]>> {
  try {
    await requireAdmin();
    const rows = await db
      .select({
        id: feedback.id,
        userId: feedback.userId,
        userName: users.name,
        userEmail: users.email,
        type: feedback.type,
        message: feedback.message,
        status: feedback.status,
        createdAt: feedback.createdAt,
      })
      .from(feedback)
      .leftJoin(users, eq(feedback.userId, users.id))
      .orderBy(desc(feedback.createdAt));

    return { success: true, data: rows as FeedbackWithUser[] };
  } catch (e) {
    if (e instanceof ForbiddenError) return { success: false, error: e.message };
    console.error("[listFeedback] failed", e);
    return { success: false, error: "Failed to load feedback" };
  }
}

export async function markFeedbackRead(id: number): Promise<ActionResult<void>> {
  try {
    await requireAdmin();
    await db.update(feedback).set({ status: "read" }).where(eq(feedback.id, id));
    revalidatePath("/more/admin/feedback");
    return { success: true, data: undefined };
  } catch (e) {
    if (e instanceof ForbiddenError) return { success: false, error: e.message };
    console.error("[markFeedbackRead] failed", e);
    return { success: false, error: "Failed to update feedback" };
  }
}
