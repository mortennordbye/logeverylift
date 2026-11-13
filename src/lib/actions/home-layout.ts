"use server";

import { db } from "@/db";
import { trainingCycles, users } from "@/db/schema";
import { liveCycles } from "@/lib/plan-live";
import { garminAllowed } from "@/lib/garmin/access";
import { itemSchema, mergeForSave, parseStoredLayout } from "@/lib/home/layout";
import type { StoredHomeItem, StoredHomeLayout } from "@/lib/home/stored-layout";
import { WIDGETS, isWidgetId, widgetDef } from "@/lib/home/widgets";
import { requireSession } from "@/lib/utils/session";
import type { ActionResult } from "@/types/workout";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

/**
 * Save the user's home layout (docs/home-widgets-audit.md, 6.8). `items: null`
 * is Reset: the column goes back to null, which renders the default.
 *
 * A save carries the `updatedAt` it was edited from. If the stored layout has
 * changed since (another device saved), it returns "conflict" unless `force`.
 * The check is part of the UPDATE, so two saves at once cannot both win.
 */

const saveSchema = z
  .object({
    items: z
      .array(itemSchema)
      .max(Object.keys(WIDGETS).length)
      .nullable()
      .superRefine((items, ctx) => {
        if (!items) return;
        const seen = new Set<string>();
        for (const it of items) {
          if (!isWidgetId(it.id)) return ctx.addIssue({ code: "custom", message: "Unknown widget" });
          if (seen.has(it.id)) return ctx.addIssue({ code: "custom", message: "Repeated widget" });
          seen.add(it.id);
          const def = widgetDef(it.id);
          if (!(def.sizes as readonly string[]).includes(it.size)) return ctx.addIssue({ code: "custom", message: "Size not allowed" });
          if (def.critical && it.hidden) return ctx.addIssue({ code: "custom", message: "This widget can't be hidden" });
          if (it.settings !== undefined && !def.settings?.safeParse(it.settings).success) {
            return ctx.addIssue({ code: "custom", message: "Invalid settings" });
          }
        }
      }),
    baseUpdatedAt: z.iso.datetime().nullable(),
    force: z.boolean(),
  })
  .strict();

export async function saveHomeLayout(data: unknown): Promise<ActionResult<{ updatedAt: string | null }>> {
  const auth = await requireSession();
  const parsed = saveSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const { items, baseUpdatedAt, force } = parsed.data;
  const userId = auth.user.id;

  try {
    const [row] = await db
      .select({ homeLayout: users.homeLayout, enduranceEnabled: users.enduranceEnabled, role: users.role })
      .from(users)
      .where(eq(users.id, userId));
    if (!row) return { success: false, error: "Couldn't save your home layout" };

    const stored = parseStoredLayout(row.homeLayout, userId);
    let next: StoredHomeLayout | null = null;
    if (items !== null) {
      // Only whether a cycle is active, read without getActiveCycleForUser (which writes).
      const [active] = await db
        .select({ id: trainingCycles.id })
        .from(trainingCycles)
        .where(and(eq(trainingCycles.userId, userId), eq(trainingCycles.status, "active"), liveCycles))
        .limit(1);
      const audience = { endurance: row.enduranceEnabled, garmin: garminAllowed(row.role), cycle: active !== undefined };
      // Widgets this user cannot have are not taken from the client; the
      // stored ones are kept by mergeForSave.
      const own: StoredHomeItem[] = items.filter((i) => widgetDef(i.id as keyof typeof WIDGETS).available(audience));
      next = { v: 1, updatedAt: new Date().toISOString(), items: mergeForSave(stored, own, audience) };
    }

    const base = force ? null : (baseUpdatedAt ?? null);
    const updated = await db
      .update(users)
      .set({ homeLayout: next })
      .where(
        and(
          eq(users.id, userId),
          force ? undefined : sql`(${users.homeLayout} ->> 'updatedAt') IS NOT DISTINCT FROM ${base}`,
        ),
      )
      .returning({ id: users.id });
    if (updated.length === 0) return { success: false, error: "conflict" };

    revalidatePath("/");
    return { success: true, data: { updatedAt: next?.updatedAt ?? null } };
  } catch (e) {
    console.error("[saveHomeLayout] failed", { userId, error: e instanceof Error ? e.name : "unknown" });
    return { success: false, error: "Couldn't save your home layout" };
  }
}
