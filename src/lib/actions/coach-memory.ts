"use server";

/**
 * Coach memory in the app (docs/plans/ai-coach.md, 2.5 and 2.7): the user
 * reads, adds, edits, switches off and deletes the entries their assistant
 * keeps. Writes go through the revision layer as the user.
 */

import { COACH_MEMORY_KINDS } from "@/db/schema";
import {
  COACH_MEMORY_TEXT_MAX,
  addCoachMemory,
  changeCoachMemory,
  listCoachMemory,
  listDeletedCoachMemory,
  restoreDeletedCoachMemory,
  type CoachMemoryEntry,
} from "@/lib/coach-memory";
import { PlanNotFoundError, PlanStateError } from "@/lib/plan-revisions";
import { requireSession } from "@/lib/utils/session";
import type { ActionResult } from "@/types/workout";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const kind = z.enum(COACH_MEMORY_KINDS);
const text = z.string().trim().min(1).max(COACH_MEMORY_TEXT_MAX);

const addSchema = z.object({ kind, text });
const updateSchema = z.object({
  id: z.number().int().positive(),
  kind: kind.optional(),
  text: text.optional(),
  active: z.boolean().optional(),
});
const deleteSchema = z.object({ id: z.number().int().positive() });

function known(e: unknown, action: string): ActionResult<never> {
  if (e instanceof PlanNotFoundError || e instanceof PlanStateError) return { success: false, error: e.message };
  console.error(`[${action}] failed`, e);
  return { success: false, error: "Could not save coach memory" };
}

export async function getCoachMemory(): Promise<
  ActionResult<{ entries: CoachMemoryEntry[]; deleted: Awaited<ReturnType<typeof listDeletedCoachMemory>> }>
> {
  const auth = await requireSession();
  try {
    const [entries, deleted] = await Promise.all([listCoachMemory(auth.user.id, true), listDeletedCoachMemory(auth.user.id)]);
    return { success: true, data: { entries, deleted } };
  } catch (e) {
    console.error("[getCoachMemory] failed", e);
    return { success: false, error: "Could not load coach memory" };
  }
}

export async function addCoachMemoryEntry(data: unknown): Promise<ActionResult<{ id: number }>> {
  const auth = await requireSession();
  const parsed = addSchema.safeParse(data);
  if (!parsed.success) return { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  try {
    const entry = await addCoachMemory({ userId: auth.user.id, writer: "user" }, parsed.data);
    revalidatePath("/more/coach-memory");
    return { success: true, data: { id: entry.id } };
  } catch (e) {
    return known(e, "addCoachMemoryEntry");
  }
}

export async function updateCoachMemoryEntry(data: unknown): Promise<ActionResult<undefined>> {
  const auth = await requireSession();
  const parsed = updateSchema.safeParse(data);
  if (!parsed.success) return { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  const { id, ...change } = parsed.data;
  try {
    await changeCoachMemory({ userId: auth.user.id, writer: "user" }, id, change);
    revalidatePath("/more/coach-memory");
    return { success: true, data: undefined };
  } catch (e) {
    return known(e, "updateCoachMemoryEntry");
  }
}

export async function deleteCoachMemoryEntry(data: unknown): Promise<ActionResult<undefined>> {
  const auth = await requireSession();
  const parsed = deleteSchema.safeParse(data);
  if (!parsed.success) return { success: false, error: "Invalid input" };
  try {
    await changeCoachMemory({ userId: auth.user.id, writer: "user" }, parsed.data.id, "delete");
    revalidatePath("/more/coach-memory");
    return { success: true, data: undefined };
  } catch (e) {
    return known(e, "deleteCoachMemoryEntry");
  }
}

/** Bring back an entry the user deleted (for 90 days, within the 200-entry cap). */
export async function restoreCoachMemoryEntry(data: unknown): Promise<ActionResult<undefined>> {
  const auth = await requireSession();
  const parsed = deleteSchema.safeParse(data);
  if (!parsed.success) return { success: false, error: "Invalid input" };
  try {
    const done = await restoreDeletedCoachMemory({ userId: auth.user.id, writer: "user" }, parsed.data.id);
    if (!done) return { success: false, error: "That entry is not deleted, or it can no longer be restored" };
    revalidatePath("/more/coach-memory");
    return { success: true, data: undefined };
  } catch (e) {
    return known(e, "restoreCoachMemoryEntry");
  }
}

