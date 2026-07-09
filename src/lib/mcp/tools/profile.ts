/**
 * MCP tools: profile & weight.
 *
 * Mirrors the logic in src/lib/actions/profile.ts but scoped to the userId
 * resolved from the MCP OAuth access token (never a tool parameter). The
 * Server Actions can't be reused here — they read identity from the cookie
 * session, which doesn't exist in an MCP request.
 */

import { db } from "@/db";
import { users } from "@/db/schema/users";
import { userWeightEntries } from "@/db/schema/weight-history";
import { audit, fail, failInternal, ok } from "@/lib/mcp/result";
import { GOAL_VALUES, parseUserGoals } from "@/lib/utils/goals";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

export function registerProfileTools(server: McpServer, userId: string) {
  server.registerTool(
    "get_profile",
    {
      description:
        "Get the current user's profile (name, gender, birth year, height, weight, goals, experience level) and recent weight history.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const user = await db.query.users.findFirst({
          where: eq(users.id, userId),
        });
        if (!user) return fail("User not found");

        const weightHistory = await db
          .select()
          .from(userWeightEntries)
          .where(eq(userWeightEntries.userId, userId))
          .orderBy(desc(userWeightEntries.recordedAt))
          .limit(50);

        return ok({
          name: user.name,
          gender: user.gender ?? null,
          birthYear: user.birthYear ?? null,
          heightCm: user.heightCm ?? null,
          weightKg: user.weightKg ?? null,
          goals: parseUserGoals(user.goals),
          experienceLevel: user.experienceLevel ?? null,
          weightHistory: weightHistory.map((w) => ({
            id: w.id,
            weightKg: w.weightKg,
            recordedAt: w.recordedAt.toISOString(),
          })),
        });
      } catch (e) {
        return failInternal("profile", e);
      }
    },
  );

  server.registerTool(
    "update_profile",
    {
      description:
        "Update the current user's profile fields. Only provided fields change. Pass null to clear an optional field. Changing weight also logs a weight history entry.",
      annotations: { idempotentHint: true, openWorldHint: false },
      inputSchema: {
        name: z.string().trim().min(1).max(100).optional(),
        gender: z
          .enum(["male", "female", "other", "prefer_not_to_say"])
          .nullable()
          .optional(),
        birthYear: z
          .number()
          .int()
          .min(1900)
          .max(new Date().getFullYear())
          .nullable()
          .optional(),
        heightCm: z.number().int().positive().max(300).nullable().optional(),
        weightKg: z.number().positive().max(500).nullable().optional(),
        goals: z.array(z.enum(GOAL_VALUES)).max(5).nullable().optional(),
        experienceLevel: z
          .enum(["beginner", "intermediate", "advanced"])
          .nullable()
          .optional(),
      },
    },
    async ({ goals, ...rest }) => {
      try {
        const current = await db.query.users.findFirst({
          where: eq(users.id, userId),
        });
        if (!current) return fail("User not found");

        const goalsValue =
          goals !== undefined
            ? { goals: goals && goals.length > 0 ? JSON.stringify(goals) : null }
            : {};

        await db
          .update(users)
          .set({ ...rest, ...goalsValue })
          .where(eq(users.id, userId));

        const newWeight = rest.weightKg;
        if (newWeight != null && newWeight !== current.weightKg) {
          await db.insert(userWeightEntries).values({
            id: crypto.randomUUID(),
            userId,
            weightKg: newWeight,
            recordedAt: new Date(),
          });
        }

        return ok({ updated: true });
      } catch (e) {
        return failInternal("profile", e);
      }
    },
  );

  server.registerTool(
    "manage_weight",
    {
      description:
        "Log or delete a body-weight entry. operation='log' requires weightKg (recordedAt is an optional ISO datetime, defaults to now) and also updates the profile's current weight. operation='delete' requires entryId.",
      annotations: { destructiveHint: true, openWorldHint: false },
      inputSchema: {
        operation: z.enum(["log", "delete"]),
        weightKg: z.number().positive().max(500).optional(),
        recordedAt: z.iso.datetime().optional(),
        entryId: z.string().optional(),
      },
    },
    async ({ operation, weightKg, recordedAt, entryId }) => {
      try {
        if (operation === "log") {
          if (weightKg == null) return fail("weightKg is required to log a weight entry");
          const recorded = recordedAt ? new Date(recordedAt) : new Date();
          if (recorded.getTime() > Date.now()) {
            return fail("recordedAt cannot be in the future");
          }
          const id = crypto.randomUUID();
          // Insert the entry and sync the profile's current weight atomically.
          await db.transaction(async (tx) => {
            await tx
              .insert(userWeightEntries)
              .values({ id, userId, weightKg, recordedAt: recorded });
            await tx.update(users).set({ weightKg }).where(eq(users.id, userId));
          });
          return ok({ id, weightKg, recordedAt: recorded.toISOString() });
        }

        // delete
        if (!entryId) return fail("entryId is required to delete a weight entry");
        const removed = await db
          .delete(userWeightEntries)
          .where(
            and(
              eq(userWeightEntries.id, entryId),
              eq(userWeightEntries.userId, userId),
            ),
          )
          .returning({ id: userWeightEntries.id });
        if (removed.length === 0) return fail("Weight entry not found");
        audit("delete_weight_entry", { userId, entryId });
        return ok({ deleted: true });
      } catch (e) {
        return failInternal("profile", e);
      }
    },
  );
}
