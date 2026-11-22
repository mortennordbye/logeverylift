"use server";

/**
 * The athlete profile, thresholds and injuries in the app
 * (docs/plans/athlete-profile.md, 2.9). Writes go through the
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
  garminSuggestions,
  listDeletedThresholds,
  listThresholds,
  restoreDeletedAthleteRow,
  saveAthleteProfile,
} from "@/lib/athlete-profile";
import type { PlanWriteContext } from "@/lib/plan-revisions";
import { getUserSettings, userToday } from "@/lib/user-settings";
import { toDateStr } from "@/lib/utils/cycle-position";
import { garminAllowed } from "@/lib/garmin/access";
import { acceptProposal, declineProposal, listOpenProposals } from "@/lib/threshold-proposals";
import { requireSession } from "@/lib/utils/session";
import { injuryFields, profileFields, thresholdFields } from "@/lib/validators/athlete-profile";
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

const ctxFor = (userId: string): PlanWriteContext => ({ userId, writer: "user" });

const COACH_ONLY = "A coach value comes only from accepting a coach proposal";

function refresh() {
  revalidatePath("/more/account", "layout");
  // The dot on the Account row.
  revalidatePath("/more");
}

// ── Reads for the pages ──────────────────────────────────────────────────────

export async function getThresholdsData() {
  const auth = await requireSession();
  const userId = auth.user.id;
  try {
    const thresholds = await listThresholds(userId);
    const [deleted, suggestions, proposals, settings, today] = await Promise.all([
      listDeletedThresholds(userId),
      garminSuggestions(userId, thresholds),
      listOpenProposals(userId),
      getUserSettings(userId),
      userToday(userId),
    ]);
    return {
      success: true as const,
      data: { thresholds, deleted, suggestions, proposals, units: settings.units, today: toDateStr(today) },
    };
  } catch (e) {
    console.error("[athleteProfile] getThresholdsData failed", e);
    return { success: false as const, error: "Could not load thresholds" };
  }
}

// ── Profile ──────────────────────────────────────────────────────────────────

const profileSchema = z.object({ ...profileFields }).strict();

export async function saveProfile(data: unknown): Promise<ActionResult<{ version: number }>> {
  const auth = await requireSession();
  const parsed = profileSchema.safeParse(data);
  if (!parsed.success) return invalid(parsed.error);
  const change = parsed.data;
  try {
    const { version } = await saveAthleteProfile(ctxFor(auth.user.id), change);
    refresh();
    return { success: true, data: { version } };
  } catch (e) {
    return known(e, "saveProfile");
  }
}

// ── Thresholds ───────────────────────────────────────────────────────────────

const addThresholdSchema = z.object({ ...thresholdFields }).strict();

export async function addThresholdValue(data: unknown): Promise<ActionResult<{ id: number; value: number }>> {
  const auth = await requireSession();
  const parsed = addThresholdSchema.safeParse(data);
  if (!parsed.success) return invalid(parsed.error);
  const input = parsed.data;
  // A Garmin value is Premium only; typed and tested values are open to everyone.
  if (input.source === "garmin" && !garminAllowed(auth.user.role)) return { success: false, error: "Garmin values are for Premium accounts" };
  if (input.source === "coach") return { success: false, error: COACH_ONLY };
  try {
    const { threshold } = await addThreshold(ctxFor(auth.user.id), input);
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
  if (change.source === "coach") return { success: false, error: COACH_ONLY };
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

// ── Coach proposals (docs/plans/strict-targets.md, decision 5) ──────────────

/** Accept a coach proposal: its value becomes a threshold with source coach. */
export async function acceptThresholdProposal(data: unknown): Promise<ActionResult<{ id: number; value: number }>> {
  const auth = await requireSession();
  const parsed = idSchema.safeParse(data);
  if (!parsed.success) return invalid(parsed.error);
  try {
    const threshold = await acceptProposal(auth.user.id, parsed.data.id);
    refresh();
    return { success: true, data: { id: threshold.id, value: threshold.value } };
  } catch (e) {
    return known(e, "acceptThresholdProposal");
  }
}

/** Decline a coach proposal: it closes and nothing else changes. */
export async function declineThresholdProposal(data: unknown): Promise<ActionResult<undefined>> {
  const auth = await requireSession();
  const parsed = idSchema.safeParse(data);
  if (!parsed.success) return invalid(parsed.error);
  try {
    await declineProposal(auth.user.id, parsed.data.id);
    refresh();
    return { success: true, data: undefined };
  } catch (e) {
    return known(e, "declineThresholdProposal");
  }
}

// ── Injuries ─────────────────────────────────────────────────────────────────

const addInjurySchema = z.object({ ...injuryFields }).strict();

export async function addInjuryEntry(data: unknown): Promise<ActionResult<{ id: number }>> {
  const auth = await requireSession();
  const parsed = addInjurySchema.safeParse(data);
  if (!parsed.success) return invalid(parsed.error);
  const input = parsed.data;
  try {
    const { injury } = await addInjury(ctxFor(auth.user.id), input);
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
  })
  .strict();

export async function updateInjuryEntry(data: unknown): Promise<ActionResult<undefined>> {
  const auth = await requireSession();
  const parsed = updateInjurySchema.safeParse(data);
  if (!parsed.success) return invalid(parsed.error);
  const { id: injuryId, ...change } = parsed.data;
  try {
    await changeInjury(ctxFor(auth.user.id), injuryId, change);
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
