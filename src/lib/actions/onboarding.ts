"use server";

import { db } from "@/db";
import { users } from "@/db/schema";
import { requireSession } from "@/lib/utils/session";
import { eq } from "drizzle-orm";

export async function dismissTutorial(): Promise<void> {
  const session = await requireSession();
  await db
    .update(users)
    .set({ tutorialDismissedAt: new Date() })
    .where(eq(users.id, session.user.id));
}
