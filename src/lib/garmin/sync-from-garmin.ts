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
import { localDateStr } from "@/lib/utils/user-date";
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

/** What every step reads once per run: the Garmin profile, and today in the user's zone after the time zone step. */
type Run = { profile: Profile; on: string };

/** Time zone first: the other steps date their writes in it. The source is dated in Garmin's zone. */
async function syncTimeZone(userId: string, profile: Profile, force = false) {
  const zone = garminTimeZone(profile);
  if (!zone) return false;
  await db
    .update(users)
    .set({ timeZone: zone, fieldSources: withSource("timeZone", { by: "garmin", on: localDateStr(new Date(), zone) }) })
    .where(and(eq(users.id, userId), force ? undefined : notLocked("timeZone"), force ? undefined : sql`${users.timeZone} is distinct from ${zone}`));
  return true;
}

/** Max HR, threshold HR, FTP and run pace, one kind at a time: a failed kind does not stop the others. */
async function syncThresholds(userId: string, run: Run) {
  for (const s of await garminSuggestions(userId)) {
    try {
      await syncGarminThreshold(userId, s.kind, s.value, run.on);
    } catch (e) {
      console.error("[syncFromGarmin] threshold failed", { userId, kind: s.kind }, e instanceof Error ? e.message : "unknown");
    }
  }
}

/** Training days, and the long day when Garmin has one. Endurance users only. `take` is "Use": it also clears the lock. */
async function syncAvailability(userId: string, run: Run, take = false) {
  if (!(await enduranceEnabledFor(userId))) return false;
  const v = garminAvailability(run.profile);
  if (!v) return false;
  const p = await getAthleteProfile(userId);
  if (!take && sameAvailability(v, { availableDays: p?.availableDays ?? null, longDay: p?.longDay ?? null })) return true;
  try {
    await saveAthleteProfile(
      { userId, writer: "sync", reason: "Garmin sync" },
      { availableDays: v.availableDays, ...(v.longDay !== null && { longDay: v.longDay }) },
      undefined,
      take,
    );
  } catch (e) {
    if (!(e instanceof FieldLockedError)) throw e;
  }
  return true;
}

async function syncUnits(userId: string, run: Run, force = false) {
  const u = garminUnits(run.profile);
  if (!u) return false;
  await db
    .update(users)
    .set({ distanceUnit: u.distance, swimUnit: u.swim, fieldSources: withSource("units", { by: "garmin", on: run.on }) })
    .where(
      and(
        eq(users.id, userId),
        force ? undefined : notLocked("units"),
        force ? undefined : sql`(${users.distanceUnit}, ${users.swimUnit}) is distinct from (${u.distance}, ${u.swim})`,
      ),
    );
  return true;
}

const STEPS = [syncGarminWeight, syncThresholds, syncAvailability, syncUnits];

async function attempt(userId: string, name: string, step: () => Promise<unknown>) {
  try {
    await step();
  } catch (e) {
    console.error("[syncFromGarmin] step failed", { userId, step: name }, e instanceof Error ? e.message : "unknown");
  }
}

/** Runs every step for a Premium user who turned the sync on. A failed step does not stop the others. */
export async function syncFromGarmin(userId: string) {
  if (!(await garminAllowedFor(userId))) return;
  const [conn] = await db.select({ on: garminConnections.syncFromGarmin }).from(garminConnections).where(eq(garminConnections.userId, userId));
  if (!conn?.on) return;
  const profile = await garminProfile(userId);
  await attempt(userId, "syncTimeZone", () => syncTimeZone(userId, profile));
  const run: Run = { profile, on: toDateStr(await userToday(userId)) };
  for (const step of STEPS) await attempt(userId, step.name, () => step(userId, run));
}

/** "Use": store Garmin's value for one field and clear its lock. False when Garmin has none. */
export async function takeGarminValue(userId: string, field: SyncedField): Promise<boolean> {
  const profile = await garminProfile(userId);
  if (field === "timeZone") return syncTimeZone(userId, profile, true);
  const run: Run = { profile, on: toDateStr(await userToday(userId)) };
  if (field === "units") return syncUnits(userId, run, true);
  return syncAvailability(userId, run, true);
}
