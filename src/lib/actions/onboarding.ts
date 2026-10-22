"use server";

import { db } from "@/db";
import { users, workoutSessions } from "@/db/schema";
import { requireSession } from "@/lib/utils/session";
import { shouldShowSharePrompt } from "@/lib/utils/share-prompt";
import type { ActionResult } from "@/types/workout";
import { and, count, eq } from "drizzle-orm";

export async function dismissTutorial(): Promise<void> {
  const session = await requireSession();
  await db
    .update(users)
    .set({ tutorialDismissedAt: new Date() })
    .where(eq(users.id, session.user.id));
}

/** Whether home should ask the caller to share the app right now. */
export async function isSharePromptDue(): Promise<boolean> {
  const auth = await requireSession();
  const [user] = await db
    .select({ sharePromptAt: users.sharePromptAt, tutorialDismissedAt: users.tutorialDismissedAt })
    .from(users)
    .where(eq(users.id, auth.user.id));
  if (!user) return false;
  // Only sessions logged in the app: cycle days tracked elsewhere ("auto")
  // say nothing about whether the user likes using it.
  const [{ n }] = await db
    .select({ n: count() })
    .from(workoutSessions)
    .where(
      and(
        eq(workoutSessions.userId, auth.user.id),
        eq(workoutSessions.isCompleted, true),
        eq(workoutSessions.source, "app"),
      ),
    );
  return shouldShowSharePrompt({
    completedCount: n,
    lastPromptAt: user.sharePromptAt,
    tutorialDone: user.tutorialDismissedAt !== null,
    now: new Date(),
  });
}

export async function markSharePromptSeen(): Promise<ActionResult> {
  const auth = await requireSession();
  try {
    await db
      .update(users)
      .set({ sharePromptAt: new Date() })
      .where(eq(users.id, auth.user.id));
    return { success: true, data: undefined };
  } catch (e) {
    console.error("[markSharePromptSeen] failed", e);
    return { success: false, error: "Failed to save" };
  }
}
