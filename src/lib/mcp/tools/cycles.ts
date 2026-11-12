/**
 * MCP tools: training cycles (mesocycles) and their day/rotation slots.
 *
 * Mirrors src/lib/actions/training-cycles.ts, scoped to the MCP-authenticated
 * userId. Ownership is enforced on every read and write.
 */

import { db } from "@/db";
import { programs, trainingCycleSlots, trainingCycles } from "@/db/schema";
import { audit, fail, failInternal, ok } from "@/lib/mcp/result";
import { REVISION_RULES, assistantContext, expectedVersionArg, planErrorResult, reasonArg } from "@/lib/mcp/revisions";
import { liveCycles, livePrograms, liveSlotProgram } from "@/lib/plan-live";
import { activateCycle, deleteCycles, planWrite, versionKey } from "@/lib/plan-revisions";
import { userToday } from "@/lib/user-settings";
import { cycleWeek, parseDateStr } from "@/lib/utils/cycle-position";
import { CYCLE_DURATION_WEEKS } from "@/lib/validators/training-cycles";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

const durationWeeks = z
  .number()
  .int()
  .refine((v) => CYCLE_DURATION_WEEKS.includes(v), {
    message: `Duration must be one of ${CYCLE_DURATION_WEEKS.join(", ")} weeks`,
  });
const endActionEnum = z.enum(["deload", "new_cycle", "rest", "none"]);

/** Returns the owning userId for a live cycle, or null if not found. */
async function cycleOwner(cycleId: number) {
  const [row] = await db
    .select({ userId: trainingCycles.userId })
    .from(trainingCycles)
    .where(and(eq(trainingCycles.id, cycleId), liveCycles))
    .limit(1);
  return row ?? null;
}

const cycleVersion = (versions: Map<string, number>, cycleId: number) =>
  versions.get(versionKey({ type: "cycle", id: cycleId }));

export function registerCycleTools(server: McpServer, userId: string, clientId?: string) {
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
          .where(and(eq(trainingCycles.userId, userId), liveCycles))
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
        "Get one training cycle with its slots (each slot's assigned program included) and its version. Pass the version as expectedVersion when you change it.",
      inputSchema: { cycleId: z.number().int().positive() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ cycleId }) => {
      try {
        const cycle = await db.query.trainingCycles.findFirst({
          where: and(
            eq(trainingCycles.id, cycleId),
            eq(trainingCycles.userId, userId),
            liveCycles,
          ),
          with: { slots: { with: { program: true } } },
        });
        if (!cycle) return fail("Training cycle not found");
        return ok({ ...cycle, slots: cycle.slots.map(liveSlotProgram) });
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
        `operation='create': requires name and durationWeeks (${CYCLE_DURATION_WEEKS.join("/")}); optional scheduleType ('day_of_week'|'rotation'), endAction, endMessage.`,
        "operation='update': requires cycleId; any of name, durationWeeks, endAction, endMessage, status ('draft'|'active'|'completed') are applied.",
        "operation='delete': requires cycleId. The cycle and the programs it generated can be restored in the app for 90 days, and with restore_revision.",
        "operation='start': requires cycleId — marks it active (completing any other active cycle) and sets startDate to today.",
        `Every operation requires reason; update, delete and start also require expectedVersion (the cycle's version). The result has the new version. ${REVISION_RULES}`,
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
        reason: reasonArg,
        expectedVersion: expectedVersionArg.optional(),
      },
    },
    async (args) => {
      const ctx = assistantContext(userId, clientId, args.reason);
      try {
        if (args.operation === "create") {
          if (!args.name || args.durationWeeks == null) {
            return fail("name and durationWeeks are required to create a cycle");
          }
          const name = args.name;
          const weeks = args.durationWeeks;
          const { result: cycle } = await planWrite(ctx, async (w) => {
            const [row] = await w.tx
              .insert(trainingCycles)
              .values({
                userId,
                name,
                durationWeeks: weeks,
                scheduleType: args.scheduleType ?? "day_of_week",
                endAction: args.endAction ?? "none",
                endMessage: args.endMessage ?? null,
              })
              .returning();
            w.create({ type: "cycle", id: row.id });
            return row;
          });
          return ok(cycle);
        }

        if (args.cycleId == null) return fail(`cycleId is required to ${args.operation} a cycle`);
        if (args.expectedVersion == null) {
          return fail(`expectedVersion is required to ${args.operation} a cycle. Read it with get_training_cycle.`);
        }
        const cycleId = args.cycleId;
        const expectedVersion = args.expectedVersion;

        if (args.operation === "update") {
          const existing = await db.query.trainingCycles.findFirst({
            where: and(
              eq(trainingCycles.id, cycleId),
              eq(trainingCycles.userId, userId),
              liveCycles,
            ),
          });
          if (!existing) return fail("Training cycle not found");

          // Activating must go through operation='start', which deactivates any
          // other active cycle first.
          if (args.status === "active" && existing.status !== "active") {
            return fail(
              "Use operation='start' to activate a cycle — it deactivates any other active cycle first.",
            );
          }

          // Don't let an active cycle be shortened past its elapsed time.
          if (args.durationWeeks && existing.status === "active" && existing.startDate) {
            const { isOver } = cycleWeek(parseDateStr(existing.startDate), args.durationWeeks, await userToday(userId));
            if (isOver) {
              return fail(
                "New duration would end the cycle immediately — choose a longer duration",
              );
            }
          }

          const updates: Record<string, unknown> = {};
          if (args.name !== undefined) updates.name = args.name;
          if (args.durationWeeks !== undefined) updates.durationWeeks = args.durationWeeks;
          // A new block length changes every week's targets; clearing the sync
          // stamp makes the next read re-derive them.
          if (args.durationWeeks !== undefined && args.durationWeeks !== existing.durationWeeks) {
            updates.lastSyncedWeek = null;
          }
          if (args.endAction !== undefined) updates.endAction = args.endAction;
          if (args.endMessage !== undefined) updates.endMessage = args.endMessage;
          if (args.status !== undefined) updates.status = args.status;

          await planWrite(ctx, async (w) => {
            await w.touch({ type: "cycle", id: cycleId }, { expectedVersion });
            if (Object.keys(updates).length > 0) {
              await w.tx.update(trainingCycles).set(updates).where(eq(trainingCycles.id, cycleId));
            }
          });
          // plan-read: includes deleted (re-reads the row this call just wrote)
          // plan-read: includes deleted (re-reads the row this call just wrote)
        const [cycle] = await db.select().from(trainingCycles).where(eq(trainingCycles.id, cycleId));
          return ok(cycle);
        }

        if (args.operation === "delete") {
          const owner = await cycleOwner(cycleId);
          if (!owner || owner.userId !== userId) return fail("Training cycle not found");
          await deleteCycles(ctx, [cycleId], expectedVersion);
          audit("delete_training_cycle", { userId, cycleId });
          return ok({ deleted: true, cycleId });
        }

        // start: any other active cycle completes, in one transaction.
        const owner = await cycleOwner(cycleId);
        if (!owner || owner.userId !== userId) return fail("Training cycle not found");
        await activateCycle(ctx, cycleId, expectedVersion);
        audit("start_training_cycle", { userId, cycleId });
        // plan-read: includes deleted (re-reads the row this call just wrote)
        const [cycle] = await db.select().from(trainingCycles).where(eq(trainingCycles.id, cycleId));
        return ok(cycle);
      } catch (e) {
        return (await planErrorResult(userId, e)) ?? failInternal("cycles", e);
      }
    },
  );

  server.registerTool(
    "edit_cycle_slot",
    {
      description: [
        "Upsert or remove a slot in a training cycle.",
        "operation='upsert': requires trainingCycleId and either dayOfWeek (1=Mon..7=Sun, for day_of_week cycles) or orderIndex (1,2,3.. for rotation cycles); optional label, programId (the program to run; null to clear), notes, autoComplete (true for a day tracked outside the app, which then completes itself; omit to leave unchanged). An existing slot at that day/position is updated, otherwise a new one is created.",
        "operation='remove': requires slotId and cycleId.",
        `Both require reason and expectedVersion (the cycle's version); the result has the new version. ${REVISION_RULES}`,
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
        autoComplete: z.boolean().optional(),
        reason: reasonArg,
        expectedVersion: expectedVersionArg,
      },
    },
    async (args) => {
      const ctx = assistantContext(userId, clientId, args.reason);
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
            .where(and(eq(trainingCycles.id, trainingCycleId), liveCycles))
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
              .where(and(eq(programs.id, args.programId), livePrograms))
              .limit(1);
            if (!prog || prog.userId !== userId) return fail("Program not found");
          }

          const rest = {
            label: args.label ?? null,
            programId: args.programId ?? null,
            notes: args.notes ?? null,
            ...(args.autoComplete !== undefined && { autoComplete: args.autoComplete }),
          };

          const { result: slot, versions } = await planWrite(ctx, async (w) => {
            const tx = w.tx;
            await w.touch({ type: "cycle", id: trainingCycleId }, { expectedVersion: args.expectedVersion });
            let existingSlot = null;
            if (effDay !== null) {
              existingSlot = await tx.query.trainingCycleSlots.findFirst({
                where: and(
                  eq(trainingCycleSlots.trainingCycleId, trainingCycleId),
                  eq(trainingCycleSlots.dayOfWeek, effDay),
                ),
              });
            } else if (effOrder !== null) {
              existingSlot = await tx.query.trainingCycleSlots.findFirst({
                where: and(
                  eq(trainingCycleSlots.trainingCycleId, trainingCycleId),
                  eq(trainingCycleSlots.orderIndex, effOrder),
                ),
              });
            }

            if (existingSlot) {
              const [updated] = await tx
                .update(trainingCycleSlots)
                .set({ ...rest, dayOfWeek: effDay, orderIndex: effOrder })
                .where(eq(trainingCycleSlots.id, existingSlot.id))
                .returning();
              return updated;
            }
            const [inserted] = await tx
              .insert(trainingCycleSlots)
              .values({ trainingCycleId, dayOfWeek: effDay, orderIndex: effOrder, ...rest })
              .returning();
            return inserted;
          });
          return ok({ ...slot, cycleVersion: cycleVersion(versions, trainingCycleId) });
        }

        // remove
        const { slotId, cycleId } = args;
        if (slotId == null || cycleId == null) {
          return fail("slotId and cycleId are required to remove a slot");
        }
        const owner = await cycleOwner(cycleId);
        if (!owner || owner.userId !== userId) return fail("Training cycle not found");
        const { result: removed, versions } = await planWrite(ctx, async (w) => {
          await w.touch({ type: "cycle", id: cycleId }, { expectedVersion: args.expectedVersion });
          return w.tx
            .delete(trainingCycleSlots)
            .where(
              and(
                eq(trainingCycleSlots.id, slotId),
                eq(trainingCycleSlots.trainingCycleId, cycleId),
              ),
            )
            .returning({ id: trainingCycleSlots.id });
        });
        if (removed.length === 0) return fail("Slot not found");
        audit("remove_cycle_slot", { userId, cycleId, slotId });
        return ok({ removed: true, slotId, cycleVersion: cycleVersion(versions, cycleId) });
      } catch (e) {
        return (await planErrorResult(userId, e)) ?? failInternal("cycles", e);
      }
    },
  );
}
