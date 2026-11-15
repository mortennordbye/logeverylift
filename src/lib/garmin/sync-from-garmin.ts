/**
 * "Sync from Garmin" (docs/plans/account-profile.md, 6 and 7): after each
 * import, one step per field group fills what the user did not set. A
 * threshold the user typed or tested is locked by its source; the other
 * fields by users.field_sources, checked in the same statement that writes.
 * Writes go in as the "sync" writer, so they are not assistant changes. To
 * sync a new field, add its step to STEPS and its name to SYNCED_FIELDS.
 */

import { db } from "@/db";
import { garminConnections, garminDays, users } from "@/db/schema";
import { garminSuggestions, getAthleteProfile, saveAthleteProfile, syncGarminThreshold } from "@/lib/athlete-profile";
import { enduranceEnabledFor } from "@/lib/endurance";
import { FieldLockedError, notLocked, withSource } from "@/lib/field-sources";
import { garminAllowedFor } from "@/lib/garmin/access";
import { userToday } from "@/lib/user-settings";
import { toDateStr } from "@/lib/utils/cycle-position";
import type { SyncedField } from "@/lib/utils/field-sources";
import { garminAvailability, garminTimeZone, garminUnits, sameAvailability, type Profile } from "@/lib/utils/garmin-profile";
import { and, desc, eq, sql } from "drizzle-orm";
import { syncGarminWeight } from "./weight-sync";

/** The newest Garmin profile snapshot (garmin_days kind "profile"). */
export async function garminProfile(userId: string): Promise<Profile> {
  const [row] = await db
    .select({ data: garminDays.data })
    .from(garminDays)
    .where(and(eq(garminDays.userId, userId), eq(garminDays.kind, "profile")))
    .orderBy(desc(garminDays.calendarDate))
    .limit(1);
  return (row?.data as Profile) ?? null;
}

const today = async (userId: string) => toDateStr(await userToday(userId));

/** Max HR, threshold HR, FTP and run pace, one kind at a time: a failed kind does not stop the others. */
async function syncThresholds(userId: string) {
  const on = await today(userId);
  for (const s of await garminSuggestions(userId)) {
    try {
      await syncGarminThreshold(userId, s.kind, s.value, on);
    } catch (e) {
      console.error("[syncFromGarmin] threshold failed", { userId, kind: s.kind }, e instanceof Error ? e.message : "unknown");
    }
  }
}

/** Training days, and the long day when Garmin has one. Endurance users only. */
async function syncAvailability(userId: string, force = false) {
  const v = garminAvailability(await garminProfile(userId));
  if (!v || !(await enduranceEnabledFor(userId))) return false;
  const p = await getAthleteProfile(userId);
  if (!force && sameAvailability(v, { availableDays: p?.availableDays ?? null, longDay: p?.longDay ?? null })) return true;
  try {
    await saveAthleteProfile({ userId, writer: "sync", reason: "Garmin sync" }, { availableDays: v.availableDays, ...(v.longDay !== null && { longDay: v.longDay }) });
  } catch (e) {
    if (!(e instanceof FieldLockedError)) throw e;
  }
  return true;
}

async function syncTimeZone(userId: string, force = false) {
  const zone = garminTimeZone(await garminProfile(userId));
  if (!zone) return false;
  await db
    .update(users)
    .set({ timeZone: zone, fieldSources: withSource("timeZone", { by: "garmin", on: await today(userId) }) })
    .where(and(eq(users.id, userId), force ? undefined : notLocked("timeZone"), force ? undefined : sql`${users.timeZone} is distinct from ${zone}`));
  return true;
}

async function syncUnits(userId: string, force = false) {
  const u = garminUnits(await garminProfile(userId));
  if (!u) return false;
  await db
    .update(users)
    .set({ distanceUnit: u.distance, swimUnit: u.swim, fieldSources: withSource("units", { by: "garmin", on: await today(userId) }) })
    .where(
      and(
        eq(users.id, userId),
        force ? undefined : notLocked("units"),
        force ? undefined : sql`(${users.distanceUnit}, ${users.swimUnit}) is distinct from (${u.distance}, ${u.swim})`,
      ),
    );
  return true;
}

const STEPS = [syncGarminWeight, syncThresholds, syncAvailability, syncTimeZone, syncUnits];

/** Runs every step for a Premium user who turned the sync on. A failed step does not stop the others. */
export async function syncFromGarmin(userId: string) {
  if (!(await garminAllowedFor(userId))) return;
  const [conn] = await db.select({ on: garminConnections.syncFromGarmin }).from(garminConnections).where(eq(garminConnections.userId, userId));
  if (!conn?.on) return;
  for (const step of STEPS) {
    try {
      await step(userId);
    } catch (e) {
      console.error("[syncFromGarmin] step failed", { userId, step: step.name }, e instanceof Error ? e.message : "unknown");
    }
  }
}

/** "Use": store Garmin's value for one field and clear its lock. False when Garmin has none. */
export async function takeGarminValue(userId: string, field: SyncedField): Promise<boolean> {
  if (field === "timeZone") return syncTimeZone(userId, true);
  if (field === "units") return syncUnits(userId, true);
  if (!garminAvailability(await garminProfile(userId))) return false;
  // Clear the lock first, so the sync write below is not refused.
  await db.update(users).set({ fieldSources: withSource("availability", { by: "garmin", on: await today(userId) }) }).where(eq(users.id, userId));
  return syncAvailability(userId, true);
}
