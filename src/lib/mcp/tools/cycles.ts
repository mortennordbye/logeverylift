/**
 * MCP tools: training cycles (mesocycles) and their day/rotation slots.
 *
 * Mirrors src/lib/actions/training-cycles.ts, scoped to the MCP-authenticated
 * userId. Ownership is enforced on every read and write.
 */

import { db } from "@/db";
import { programs, trainingCycleSlots, trainingCycles } from "@/db/schema";
import { audit, fail, failInternal, ok } from "@/lib/mcp/result";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

const ALLOWED_WEEKS = [4, 6, 8, 10, 12, 16];
const durationWeeks = z
  .number()
  .int()
  .refine((v) => ALLOWED_WEEKS.includes(v), {
    message: "Duration must be 4, 6, 8, 10, 12, or 16 weeks",
  });
const endActionEnum = z.enum(["deload", "new_cycle", "rest", "none"]);

/** Returns the owning userId for a cycle, or null if not found. */
async function cycleOwner(cycleId: number) {
  const [row] = await db
    .select({ userId: trainingCycles.userId })
    .from(trainingCycles)
    .where(eq(trainingCycles.id, cycleId))
    .limit(1);
  return row ?? null;
}

export function registerCycleTools(server: McpServer, userId: string) {
  server.registerTool(
    "list_training_cycles",
    {
      description:
        "List the current user's training cycles (mesocycles), newest first.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const rows = await db
          .select()
          .from(trainingCycles)
          .where(eq(trainingCycles.userId, userId))
          .orderBy(desc(trainingCycles.createdAt));
        return ok(rows);
      } catch (e) {
        return failInternal("cycles", e);
      }
    },
  );

  server.registerTool(
    "get_training_cycle",
    {
      description:
        "Get one training cycle with its slots (each slot's assigned program included).",
      inputSchema: { cycleId: z.number().int().positive() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ cycleId }) => {
      try {
        const cycle = await db.query.trainingCycles.findFirst({
          where: and(
            eq(trainingCycles.id, cycleId),
            eq(trainingCycles.userId, userId),
          ),
          with: { slots: { with: { program: true } } },
        });
        if (!cycle) return fail("Training cycle not found");
        return ok(cycle);
      } catch (e) {
        return failInternal("cycles", e);
      }
    },
  );

  server.registerTool(
    "manage_training_cycle",
    {
      description: [
        "Create, update, delete, or start a training cycle.",
        "operation='create': requires name and durationWeeks (4/6/8/10/12/16); optional scheduleType ('day_of_week'|'rotation'), endAction, endMessage.",
        "operation='update': requires cycleId; any of name, durationWeeks, endAction, endMessage, status ('draft'|'active'|'completed') are applied.",
        "operation='delete': requires cycleId.",
        "operation='start': requires cycleId — marks it active (completing any other active cycle) and sets startDate to today.",
      ].join(" "),
      annotations: { destructiveHint: true, openWorldHint: false },
      inputSchema: {
        operation: z.enum(["create", "update", "delete", "start"]),
        cycleId: z.number().int().positive().optional(),
        name: z.string().min(1).max(100).optional(),
        durationWeeks: durationWeeks.optional(),
        scheduleType: z.enum(["day_of_week", "rotation"]).optional(),
        endAction: endActionEnum.optional(),
        endMessage: z.string().max(500).nullable().optional(),
        status: z.enum(["draft", "active", "completed"]).optional(),
      },
    },
    async (args) => {
      try {
        if (args.operation === "create") {
          if (!args.name || args.durationWeeks == null) {
            return fail("name and durationWeeks are required to create a cycle");
          }
          const [cycle] = await db
            .insert(trainingCycles)
            .values({
              userId,
              name: args.name,
              durationWeeks: args.durationWeeks,
              scheduleType: args.scheduleType ?? "day_of_week",
              endAction: args.endAction ?? "none",
              endMessage: args.endMessage ?? null,
            })
            .returning();
          return ok(cycle);
        }

        if (args.operation === "update") {
          if (args.cycleId == null) return fail("cycleId is required to update a cycle");
          const existing = await db.query.trainingCycles.findFirst({
            where: and(
              eq(trainingCycles.id, args.cycleId),
              eq(trainingCycles.userId, userId),
            ),
          });
          if (!existing) return fail("Training cycle not found");

          // Activating must go through operation='start', which deactivates any
          // other active cycle. Allowing it here could leave two active cycles.
          if (args.status === "active" && existing.status !== "active") {
            return fail(
              "Use operation='start' to activate a cycle — it deactivates any other active cycle first.",
            );
          }

          // Don't let an active cycle be shortened past its elapsed time.
          if (args.durationWeeks && existing.status === "active" && existing.startDate) {
            const start = new Date(existing.startDate);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const elapsed = Math.floor((today.getTime() - start.getTime()) / 86400000);
            if (args.durationWeeks * 7 <= elapsed) {
              return fail(
                "New duration would end the cycle immediately — choose a longer duration",
              );
            }
          }

          const updates: Record<string, unknown> = {};
          if (args.name !== undefined) updates.name = args.name;
          if (args.durationWeeks !== undefined) updates.durationWeeks = args.durationWeeks;
          if (args.endAction !== undefined) updates.endAction = args.endAction;
          if (args.endMessage !== undefined) updates.endMessage = args.endMessage;
          if (args.status !== undefined) updates.status = args.status;

          const [cycle] = await db
            .update(trainingCycles)
            .set(updates)
            .where(eq(trainingCycles.id, args.cycleId))
            .returning();
          return ok(cycle);
        }

        if (args.operation === "delete") {
          if (args.cycleId == null) return fail("cycleId is required to delete a cycle");
          const owner = await cycleOwner(args.cycleId);
          if (!owner || owner.userId !== userId) return fail("Training cycle not found");
          await db.delete(trainingCycles).where(eq(trainingCycles.id, args.cycleId));
          audit("delete_training_cycle", { userId, cycleId: args.cycleId });
          return ok({ deleted: true, cycleId: args.cycleId });
        }

        // start
        if (args.cycleId == null) return fail("cycleId is required to start a cycle");
        const startCycleId = args.cycleId;
        const owner = await cycleOwner(startCycleId);
        if (!owner || owner.userId !== userId) return fail("Training cycle not found");

        const today = new Date().toISOString().split("T")[0];
        // Deactivate any current active cycle and activate the target in one
        // transaction, so a partial failure can't leave the user with zero (or
        // two) active cycles. The activate is re-scoped to userId as defense.
        const cycle = await db.transaction(async (tx) => {
          await tx
            .update(trainingCycles)
            .set({ status: "completed" })
            .where(
              and(
                eq(trainingCycles.userId, userId),
                eq(trainingCycles.status, "active"),
              ),
            );
          const [activated] = await tx
            .update(trainingCycles)
            .set({ status: "active", startDate: today })
            .where(
              and(
                eq(trainingCycles.id, startCycleId),
                eq(trainingCycles.userId, userId),
              ),
            )
            .returning();
          return activated;
        });
        if (!cycle) return fail("Training cycle not found");
        audit("start_training_cycle", { userId, cycleId: startCycleId });
        return ok(cycle);
      } catch (e) {
        return failInternal("cycles", e);
      }
    },
  );

  server.registerTool(
    "edit_cycle_slot",
    {
      description: [
        "Upsert or remove a slot in a training cycle.",
        "operation='upsert': requires trainingCycleId and either dayOfWeek (1=Mon..7=Sun, for day_of_week cycles) or orderIndex (1,2,3.. for rotation cycles); optional label, programId (the program to run; null to clear), notes. An existing slot at that day/position is updated, otherwise a new one is created.",
        "operation='remove': requires slotId and cycleId.",
      ].join(" "),
      annotations: { destructiveHint: true, openWorldHint: false },
      inputSchema: {
        operation: z.enum(["upsert", "remove"]),
        trainingCycleId: z.number().int().positive().optional(),
        cycleId: z.number().int().positive().optional(),
        slotId: z.number().int().positive().optional(),
        dayOfWeek: z.number().int().min(1).max(7).optional(),
        orderIndex: z.number().int().positive().optional(),
        label: z.string().max(100).nullable().optional(),
        programId: z.number().int().positive().nullable().optional(),
        notes: z.string().max(500).nullable().optional(),
      },
    },
    async (args) => {
      try {
        if (args.operation === "upsert") {
          const { trainingCycleId, dayOfWeek, orderIndex } = args;
          if (trainingCycleId == null) {
            return fail("trainingCycleId is required to upsert a slot");
          }
          if (dayOfWeek === undefined && orderIndex === undefined) {
            return fail("Provide either dayOfWeek or orderIndex");
          }
          const [cycle] = await db
            .select({
              userId: trainingCycles.userId,
              scheduleType: trainingCycles.scheduleType,
            })
            .from(trainingCycles)
            .where(eq(trainingCycles.id, trainingCycleId))
            .limit(1);
          if (!cycle || cycle.userId !== userId) return fail("Training cycle not found");

          // The provided dimension must match the cycle's schedule mode; the
          // other is forced null so we never persist a mixed-mode slot (which
          // would misbehave in schedule resolution and can hit the unique
          // (cycle,day)/(cycle,order) constraints unexpectedly).
          if (cycle.scheduleType === "day_of_week" && dayOfWeek === undefined) {
            return fail("This is a day-of-week cycle — provide dayOfWeek (1=Mon..7=Sun).");
          }
          if (cycle.scheduleType === "rotation" && orderIndex === undefined) {
            return fail("This is a rotation cycle — provide orderIndex (1,2,3..).");
          }
          const effDay = cycle.scheduleType === "day_of_week" ? dayOfWeek ?? null : null;
          const effOrder = cycle.scheduleType === "rotation" ? orderIndex ?? null : null;

          // If assigning a program, verify the user owns it.
          if (args.programId != null) {
            const [prog] = await db
              .select({ userId: programs.userId })
              .from(programs)
              .where(eq(programs.id, args.programId))
              .limit(1);
            if (!prog || prog.userId !== userId) return fail("Program not found");
          }

          const rest = {
            label: args.label ?? null,
            programId: args.programId ?? null,
            notes: args.notes ?? null,
          };

          let existingSlot = null;
          if (effDay !== null) {
            existingSlot = await db.query.trainingCycleSlots.findFirst({
              where: and(
                eq(trainingCycleSlots.trainingCycleId, trainingCycleId),
                eq(trainingCycleSlots.dayOfWeek, effDay),
              ),
            });
          } else if (effOrder !== null) {
            existingSlot = await db.query.trainingCycleSlots.findFirst({
              where: and(
                eq(trainingCycleSlots.trainingCycleId, trainingCycleId),
                eq(trainingCycleSlots.orderIndex, effOrder),
              ),
            });
          }

          if (existingSlot) {
            const [updated] = await db
              .update(trainingCycleSlots)
              .set({ ...rest, dayOfWeek: effDay, orderIndex: effOrder })
              .where(eq(trainingCycleSlots.id, existingSlot.id))
              .returning();
            return ok(updated);
          }
          const [inserted] = await db
            .insert(trainingCycleSlots)
            .values({ trainingCycleId, dayOfWeek: effDay, orderIndex: effOrder, ...rest })
            .returning();
          return ok(inserted);
        }

        // remove
        const { slotId, cycleId } = args;
        if (slotId == null || cycleId == null) {
          return fail("slotId and cycleId are required to remove a slot");
        }
        const owner = await cycleOwner(cycleId);
        if (!owner || owner.userId !== userId) return fail("Training cycle not found");
        const removed = await db
          .delete(trainingCycleSlots)
          .where(
            and(
              eq(trainingCycleSlots.id, slotId),
              eq(trainingCycleSlots.trainingCycleId, cycleId),
            ),
          )
          .returning({ id: trainingCycleSlots.id });
        if (removed.length === 0) return fail("Slot not found");
        audit("remove_cycle_slot", { userId, cycleId, slotId });
        return ok({ removed: true, slotId });
      } catch (e) {
        return failInternal("cycles", e);
      }
    },
  );
}
