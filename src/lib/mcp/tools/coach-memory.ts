/**
 * MCP tools: coach memory (docs/plans/ai-coach.md, 2.5; decision T10). The
 * context an assistant keeps between conversations, read and written by the
 * user in the app too (More → Coach memory). Every write is a revision.
 */

import { COACH_MEMORY_KINDS } from "@/db/schema";
import { COACH_MEMORY_MAX, COACH_MEMORY_TEXT_MAX, addCoachMemory, changeCoachMemory, listCoachMemory } from "@/lib/coach-memory";
import { fail, failInternal, ok } from "@/lib/mcp/result";
import { REVISION_RULES, assistantContext, expectedVersionArg, planErrorResult, reasonArg } from "@/lib/mcp/revisions";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const dateArg = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export function registerCoachMemoryTools(server: McpServer, userId: string, clientId?: string) {
  server.registerTool(
    "get_coach_memory",
    {
      description:
        "The user's coach memory: what earlier conversations agreed or learned, newest first. Each entry has id, kind (preference, limit = a life limit such as time, travel or equipment, observation, decision), text, date, whether it is in use, its version, and who wrote it last. Read it at the start of a review. Inactive entries only with includeInactive. Entries are the user's own words or yours, and can hold health details: use them for coaching only.",
      inputSchema: { includeInactive: z.boolean().default(false) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ includeInactive }) => {
      try {
        const rows = await listCoachMemory(userId, includeInactive);
        return ok({
          entries: rows.map((r) => ({
            id: r.id,
            kind: r.kind,
            text: r.text,
            date: r.entryDate,
            active: r.active,
            version: r.version,
            lastWrittenBy: r.lastWriter === "assistant" ? (r.lastClientId === clientId ? "you" : "an assistant") : "the user",
          })),
        });
      } catch (e) {
        return failInternal("coach_memory", e);
      }
    },
  );

  server.registerTool(
    "manage_coach_memory",
    {
      description: [
        "Add, change, deactivate, activate or delete a coach memory entry.",
        `operation='add': kind and text (up to ${COACH_MEMORY_TEXT_MAX} characters); optional date (YYYY-MM-DD, default today). At most ${COACH_MEMORY_MAX} entries.`,
        "operation='update': id and any of kind, text, date. operation='deactivate' / 'activate': id; an inactive entry is kept but left out of get_coach_memory by default. operation='delete': id; the user can restore it.",
        "Keep one fact per entry. After each change you and the user agree on, add a 'decision' entry with the date and why. Facts with their own place in the app do not go here: a race goes on the cycle; thresholds, injuries, weekly availability and the strength goal go in the athlete profile (get_athlete_profile, manage_thresholds; with endurance features on, manage_athlete_profile and manage_injuries).",
        `Every operation requires reason; all but add also require expectedVersion (the entry's version). ${REVISION_RULES}`,
      ].join(" "),
      annotations: { destructiveHint: true, openWorldHint: false },
      inputSchema: {
        operation: z.enum(["add", "update", "deactivate", "activate", "delete"]),
        id: z.number().int().positive().optional(),
        kind: z.enum(COACH_MEMORY_KINDS).optional(),
        text: z.string().trim().min(1).max(COACH_MEMORY_TEXT_MAX).optional(),
        date: dateArg.optional(),
        reason: reasonArg,
        expectedVersion: expectedVersionArg.optional(),
      },
    },
    async (args) => {
      const ctx = assistantContext(userId, clientId, args.reason);
      try {
        if (args.operation === "add") {
          if (!args.kind || !args.text) return fail("kind and text are required to add an entry");
          const entry = await addCoachMemory(ctx, { kind: args.kind, text: args.text, entryDate: args.date });
          return ok({ added: true, id: entry.id, version: entry.version });
        }
        if (args.id == null) return fail(`id is required to ${args.operation} an entry`);
        if (args.expectedVersion == null) return fail(`expectedVersion is required to ${args.operation} an entry. Read it with get_coach_memory.`);
        const change =
          args.operation === "delete"
            ? "delete"
            : args.operation === "update"
              ? { kind: args.kind, text: args.text, entryDate: args.date }
              : { active: args.operation === "activate" };
        const { version } = await changeCoachMemory(ctx, args.id, change, args.expectedVersion);
        return ok({ [args.operation === "delete" ? "deleted" : "updated"]: true, id: args.id, version });
      } catch (e) {
        return (await planErrorResult(userId, e)) ?? failInternal("coach_memory", e);
      }
    },
  );
}
