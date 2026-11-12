"use server";

/**
 * Seasons, races and phases in the app (docs/plans/seasons.md, 2.10). Thin
 * wrappers over src/lib/seasons.ts, which the MCP tools share: the session
 * user, Zod input, and the revision layer's errors as messages. App edits send
 * no version (docs/plans/revisions.md, owner decision 3).
 */

import { OpenWorkoutError, PlanConflictError, PlanNotFoundError, PlanStateError } from "@/lib/plan-revisions";
import {
  addPhase,
  addRace,
  clearReplan,
  createSeason,
  deleteSeason,
  fitTaper,
  movePhase,
  removePhase,
  removeRace,
  resumeSeason,
  setPhase,
  updateRace,
  updateSeason,
} from "@/lib/seasons";
import { requireSession } from "@/lib/utils/session";
import {
  addPhaseSchema,
  addRaceSchema,
  createSeasonSchema,
  movePhaseSchema,
  phaseSchema,
  removeRaceSchema,
  seasonIdSchema,
  setPhaseSchema,
  updateRaceSchema,
  updateSeasonSchema,
} from "@/lib/validators/seasons";
import type { ActionResult } from "@/types/workout";
import { revalidatePath } from "next/cache";
import type { z } from "zod";

/** Validate, run as the session user, and turn the layer's errors into messages. */
async function run<S extends z.ZodTypeAny, T>(
  tag: string,
  schema: S,
  data: unknown,
  fn: (ctx: { userId: string; writer: "user" }, input: z.infer<S>) => Promise<T>,
  paths: (input: z.infer<S>, out: T) => string[],
): Promise<ActionResult<T>> {
  const auth = await requireSession();
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> };
  }
  try {
    const out = await fn({ userId: auth.user.id, writer: "user" }, parsed.data);
    for (const p of paths(parsed.data, out)) revalidatePath(p);
    return { success: true, data: out };
  } catch (e) {
    if (e instanceof PlanNotFoundError || e instanceof PlanStateError || e instanceof PlanConflictError || e instanceof OpenWorkoutError) {
      return { success: false, error: e.message };
    }
    console.error(`[${tag}] failed`, e);
    return { success: false, error: "Failed to save the season" };
  }
}

const seasonPaths = (seasonId: number) => ["/cycles", `/seasons/${seasonId}`, "/"];

export async function createSeasonAction(data: unknown) {
  return run(
    "createSeasonAction",
    createSeasonSchema,
    data,
    async (ctx, input) => ({ id: (await createSeason(ctx, input)).season.id }),
    () => ["/cycles"],
  );
}

export async function updateSeasonAction(data: unknown) {
  return run(
    "updateSeasonAction",
    updateSeasonSchema,
    data,
    async (ctx, { seasonId, ...patch }) => {
      await updateSeason(ctx, seasonId, patch);
      return null;
    },
    (i) => seasonPaths(i.seasonId),
  );
}

export async function deleteSeasonAction(data: unknown) {
  return run(
    "deleteSeasonAction",
    seasonIdSchema,
    data,
    async (ctx, { seasonId }) => {
      await deleteSeason(ctx, seasonId);
      return null;
    },
    () => ["/cycles"],
  );
}

export async function clearReplanAction(data: unknown) {
  return run(
    "clearReplanAction",
    seasonIdSchema,
    data,
    async (ctx, { seasonId }) => {
      await clearReplan(ctx, seasonId);
      return null;
    },
    (i) => seasonPaths(i.seasonId),
  );
}

export async function addRaceAction(data: unknown) {
  return run(
    "addRaceAction",
    addRaceSchema,
    data,
    async (ctx, { seasonId, ...race }) => ({ replanFlagged: (await addRace(ctx, seasonId, race)).replanFlagged }),
    (i) => seasonPaths(i.seasonId),
  );
}

export async function updateRaceAction(data: unknown) {
  return run(
    "updateRaceAction",
    updateRaceSchema,
    data,
    async (ctx, { seasonId, raceId, ...patch }) => ({ replanFlagged: (await updateRace(ctx, seasonId, raceId, patch)).replanFlagged }),
    (i) => seasonPaths(i.seasonId),
  );
}

export async function removeRaceAction(data: unknown) {
  return run(
    "removeRaceAction",
    removeRaceSchema,
    data,
    async (ctx, { seasonId, raceId }) => ({ replanFlagged: (await removeRace(ctx, seasonId, raceId)).replanFlagged }),
    (i) => seasonPaths(i.seasonId),
  );
}

export async function addPhaseAction(data: unknown) {
  return run(
    "addPhaseAction",
    addPhaseSchema,
    data,
    async (ctx, { seasonId, ...input }) => {
      const done = await addPhase(ctx, seasonId, input);
      return { cycleId: done.cycleId, raceMoved: done.raceMoved };
    },
    (i, out) => [...seasonPaths(i.seasonId), `/cycles/${out.cycleId}`],
  );
}

export async function removePhaseAction(data: unknown) {
  return run(
    "removePhaseAction",
    phaseSchema,
    data,
    async (ctx, { seasonId, cycleId }) => {
      await removePhase(ctx, seasonId, cycleId);
      return null;
    },
    (i) => [...seasonPaths(i.seasonId), `/cycles/${i.cycleId}`],
  );
}

export async function movePhaseAction(data: unknown) {
  return run(
    "movePhaseAction",
    movePhaseSchema,
    data,
    async (ctx, { seasonId, cycleId, position }) => {
      await movePhase(ctx, seasonId, cycleId, position);
      return null;
    },
    (i) => seasonPaths(i.seasonId),
  );
}

export async function setPhaseAction(data: unknown) {
  return run(
    "setPhaseAction",
    setPhaseSchema,
    data,
    async (ctx, { seasonId, cycleId, ...change }) => {
      await setPhase(ctx, seasonId, cycleId, change);
      return null;
    },
    (i) => [...seasonPaths(i.seasonId), `/cycles/${i.cycleId}`],
  );
}

export async function fitTaperAction(data: unknown) {
  return run(
    "fitTaperAction",
    seasonIdSchema,
    data,
    async (ctx, { seasonId }) => ({ durationDays: (await fitTaper(ctx, seasonId)).durationDays }),
    (i) => seasonPaths(i.seasonId),
  );
}

export async function resumeSeasonAction(data: unknown) {
  return run(
    "resumeSeasonAction",
    seasonIdSchema,
    data,
    async (ctx, { seasonId }) => resumeSeason(ctx, seasonId),
    (i) => seasonPaths(i.seasonId),
  );
}
