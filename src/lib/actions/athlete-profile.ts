"use server";

/**
 * The athlete profile, thresholds, injuries and the intake interview in the
 * app (docs/plans/athlete-profile.md, 2.6 and 2.9). Writes go through the
 * revision layer as the user. Thresholds are for every user; the rest needs
 * the endurance switch, which src/lib/athlete-profile.ts checks.
 */

import {
  PlanConflictError,
  PlanNotFoundError,
  PlanStateError,
  addInjury,
  addThreshold,
  changeInjury,
  changeThreshold,
  getAthleteProfile,
  garminSuggestions,
  interviewRace,
  listDeletedAthleteRows,
  listInjuries,
  listThresholds,
  memoryToOffer,
  missingSteps,
  moveMemoryEntry,
  restoreDeletedAthleteRow,
  saveAthleteProfile,
} from "@/lib/athlete-profile";
import { enduranceEnabledFor } from "@/lib/endurance";
import type { PlanWriteContext } from "@/lib/plan-revisions";
import { getUserSettings, userToday } from "@/lib/user-settings";
import { toDateStr } from "@/lib/utils/cycle-position";
import { requireSession } from "@/lib/utils/session";
import { injuryFields, interviewChangeSet, profileFields, thresholdFields } from "@/lib/validators/athlete-profile";
import type { ActionResult } from "@/types/workout";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const id = z.number().int().positive();

function known(e: unknown, action: string): ActionResult<never> {
  if (e instanceof PlanNotFoundError || e instanceof PlanStateError) return { success: false, error: e.message };
  if (e instanceof PlanConflictError) return { success: false, error: "This changed somewhere else. Reload and try again." };
  console.error(`[athleteProfile] ${action} failed`, e);
  return { success: false, error: "Could not save" };
}

function invalid(error: z.ZodError): ActionResult<never> {
  return { success: false, error: "Invalid input", fieldErrors: error.flatten().fieldErrors };
}

const ctxFor = (userId: string, changeSetId?: string): PlanWriteContext => ({ userId, writer: "user", changeSetId: changeSetId ?? null });

function refresh() {
  revalidatePath("/more/athlete");
  revalidatePath("/more/thresholds");
}

// ── Reads for the pages ──────────────────────────────────────────────────────

export async function getThresholdsData() {
  const auth = await requireSession();
  const userId = auth.user.id;
  try {
    const thresholds = await listThresholds(userId);
    const [deleted, suggestions, settings, today] = await Promise.all([
      listDeletedAthleteRows(userId, "threshold"),
      garminSuggestions(userId, thresholds),
      getUserSettings(userId),
      userToday(userId),
    ]);
    return {
      success: true as const,
      data: { thresholds, deleted, suggestions, units: settings.units, today: toDateStr(today) },
    };
  } catch (e) {
    console.error("[athleteProfile] getThresholdsData failed", e);
    return { success: false as const, error: "Could not load thresholds" };
  }
}

export async function getAthleteData() {
  const auth = await requireSession();
  const userId = auth.user.id;
  try {
    if (!(await enduranceEnabledFor(userId))) return { success: true as const, data: null };
    const [profile, injuries, deletedInjuries, race, memory, thresholds, settings] = await Promise.all([
      getAthleteProfile(userId),
      listInjuries(userId),
      listDeletedAthleteRows(userId, "injury"),
      interviewRace(userId),
      memoryToOffer(userId),
      listThresholds(userId),
      getUserSettings(userId),
    ]);
    return {
      success: true as const,
      data: {
        profile,
        injuries,
        deletedInjuries,
        race,
        memory,
        thresholds,
        units: settings.units,
        missing: missingSteps(profile, thresholds, race),
      },
    };
  } catch (e) {
    console.error("[athleteProfile] getAthleteData failed", e);
    return { success: false as const, error: "Could not load the athlete profile" };
  }
}

// ── Profile ──────────────────────────────────────────────────────────────────

const profileSchema = z.object({ ...profileFields, changeSetId: interviewChangeSet }).strict();

export async function saveProfile(data: unknown): Promise<ActionResult<{ version: number }>> {
  const auth = await requireSession();
  const parsed = profileSchema.safeParse(data);
  if (!parsed.success) return invalid(parsed.error);
  const { changeSetId, ...change } = parsed.data;
  try {
    const { version } = await saveAthleteProfile(ctxFor(auth.user.id, changeSetId), change);
    refresh();
    return { success: true, data: { version } };
  } catch (e) {
    return known(e, "saveProfile");
  }
}

const finishSchema = z.object({ changeSetId: interviewChangeSet });

/** The interview's last step. */
export async function finishInterview(data: unknown): Promise<ActionResult<undefined>> {
  const auth = await requireSession();
  const parsed = finishSchema.safeParse(data);
  if (!parsed.success) return invalid(parsed.error);
  try {
    await saveAthleteProfile(ctxFor(auth.user.id, parsed.data.changeSetId), { completeInterview: true });
    refresh();
    revalidatePath("/cycles/triathlon");
    return { success: true, data: undefined };
  } catch (e) {
    return known(e, "finishInterview");
  }
}

// ── Thresholds ───────────────────────────────────────────────────────────────

const addThresholdSchema = z.object({ ...thresholdFields, changeSetId: interviewChangeSet }).strict();

export async function addThresholdValue(data: unknown): Promise<ActionResult<{ id: number; value: number }>> {
  const auth = await requireSession();
  const parsed = addThresholdSchema.safeParse(data);
  if (!parsed.success) return invalid(parsed.error);
  const { changeSetId, ...input } = parsed.data;
  try {
    const { threshold } = await addThreshold(ctxFor(auth.user.id, changeSetId), input);
    refresh();
    return { success: true, data: { id: threshold.id, value: threshold.value } };
  } catch (e) {
    return known(e, "addThresholdValue");
  }
}

const { kind: _kind, ...thresholdChangeFields } = thresholdFields;
void _kind;
const updateThresholdSchema = z
  .object({ id, ...thresholdChangeFields, source: thresholdFields.source.optional() })
  .strict();

export async function updateThresholdValue(data: unknown): Promise<ActionResult<undefined>> {
  const auth = await requireSession();
  const parsed = updateThresholdSchema.safeParse(data);
  if (!parsed.success) return invalid(parsed.error);
  const { id: thresholdId, ...change } = parsed.data;
  try {
    await changeThreshold(ctxFor(auth.user.id), thresholdId, change);
    refresh();
    return { success: true, data: undefined };
  } catch (e) {
    return known(e, "updateThresholdValue");
  }
}

const idSchema = z.object({ id });

export async function deleteThresholdValue(data: unknown): Promise<ActionResult<undefined>> {
  const auth = await requireSession();
  const parsed = idSchema.safeParse(data);
  if (!parsed.success) return invalid(parsed.error);
  try {
    await changeThreshold(ctxFor(auth.user.id), parsed.data.id, "delete");
    refresh();
    return { success: true, data: undefined };
  } catch (e) {
    return known(e, "deleteThresholdValue");
  }
}

export async function restoreThresholdValue(data: unknown): Promise<ActionResult<undefined>> {
  const auth = await requireSession();
  const parsed = idSchema.safeParse(data);
  if (!parsed.success) return invalid(parsed.error);
  try {
    const done = await restoreDeletedAthleteRow(ctxFor(auth.user.id), "threshold", parsed.data.id);
    if (!done) return { success: false, error: "That value is not deleted, or it can no longer be restored" };
    refresh();
    return { success: true, data: undefined };
  } catch (e) {
    return known(e, "restoreThresholdValue");
  }
}

// ── Injuries ─────────────────────────────────────────────────────────────────

const addInjurySchema = z.object({ ...injuryFields, changeSetId: interviewChangeSet }).strict();

export async function addInjuryEntry(data: unknown): Promise<ActionResult<{ id: number }>> {
  const auth = await requireSession();
  const parsed = addInjurySchema.safeParse(data);
  if (!parsed.success) return invalid(parsed.error);
  const { changeSetId, ...input } = parsed.data;
  try {
    const { injury } = await addInjury(ctxFor(auth.user.id, changeSetId), input);
    refresh();
    return { success: true, data: { id: injury.id } };
  } catch (e) {
    return known(e, "addInjuryEntry");
  }
}

const updateInjurySchema = z
  .object({
    id,
    area: injuryFields.area.optional(),
    side: injuryFields.side,
    description: injuryFields.description.optional(),
    avoid: injuryFields.avoid,
    status: injuryFields.status.optional(),
    startedOn: injuryFields.startedOn,
    endedOn: injuryFields.endedOn,
    changeSetId: interviewChangeSet,
  })
  .strict();

export async function updateInjuryEntry(data: unknown): Promise<ActionResult<undefined>> {
  const auth = await requireSession();
  const parsed = updateInjurySchema.safeParse(data);
  if (!parsed.success) return invalid(parsed.error);
  const { id: injuryId, changeSetId, ...change } = parsed.data;
  try {
    await changeInjury(ctxFor(auth.user.id, changeSetId), injuryId, change);
    refresh();
    return { success: true, data: undefined };
  } catch (e) {
    return known(e, "updateInjuryEntry");
  }
}

export async function deleteInjuryEntry(data: unknown): Promise<ActionResult<undefined>> {
  const auth = await requireSession();
  const parsed = idSchema.safeParse(data);
  if (!parsed.success) return invalid(parsed.error);
  try {
    await changeInjury(ctxFor(auth.user.id), parsed.data.id, "delete");
    refresh();
    return { success: true, data: undefined };
  } catch (e) {
    return known(e, "deleteInjuryEntry");
  }
}

export async function restoreInjuryEntry(data: unknown): Promise<ActionResult<undefined>> {
  const auth = await requireSession();
  const parsed = idSchema.safeParse(data);
  if (!parsed.success) return invalid(parsed.error);
  try {
    const done = await restoreDeletedAthleteRow(ctxFor(auth.user.id), "injury", parsed.data.id);
    if (!done) return { success: false, error: "That injury is not deleted, or it can no longer be restored" };
    refresh();
    return { success: true, data: undefined };
  } catch (e) {
    return known(e, "restoreInjuryEntry");
  }
}

// ── The memory step ──────────────────────────────────────────────────────────

const moveSchema = z.object({ id, changeSetId: interviewChangeSet });

/** "Moved": the user restated a coach memory entry in the profile; it goes out of use. */
export async function moveMemoryToProfile(data: unknown): Promise<ActionResult<undefined>> {
  const auth = await requireSession();
  const parsed = moveSchema.safeParse(data);
  if (!parsed.success) return invalid(parsed.error);
  try {
    await moveMemoryEntry(ctxFor(auth.user.id, parsed.data.changeSetId), parsed.data.id);
    refresh();
    revalidatePath("/more/coach-memory");
    return { success: true, data: undefined };
  } catch (e) {
    return known(e, "moveMemoryToProfile");
  }
}
