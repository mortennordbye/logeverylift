/**
 * "Sync from Garmin" (docs/plans/account-profile.md, 6): after each import,
 * one step per field group fills what the user did not set. A threshold the
 * user typed or tested is locked by its source; the other fields by
 * users.field_sources. Writes go in as the "sync" writer, so they are not
 * assistant changes. To sync a new profile field, add it to FIELDS and its
 * name to SYNCED_FIELDS.
 */

import { db } from "@/db";
import { garminConnections, garminDays, users } from "@/db/schema";
import { addThreshold, garminSuggestions, getAthleteProfile, listThresholds, saveAthleteProfile } from "@/lib/athlete-profile";
import { enduranceEnabledFor } from "@/lib/endurance";
import { markField } from "@/lib/field-sources";
import { isLocked, sourceLine, type FieldSources, type SyncedField } from "@/lib/utils/field-sources";
import { garminAvailability, garminTimeZone, garminUnits } from "@/lib/utils/garmin-profile";
import { currentThresholds } from "@/lib/utils/thresholds";
import type { Units } from "@/lib/utils/units";
import { and, desc, eq } from "drizzle-orm";
import { syncGarminWeight } from "./weight-sync";

const SYNC = { writer: "sync", reason: "Garmin sync" } as const;
const DAY_NAMES = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type Profile = Record<string, unknown> | null;

type Field<T> = {
  name: SyncedField;
  fromGarmin: (p: Profile) => T | null;
  /** undefined: the field is not open to this user. */
  current: (userId: string) => Promise<T | undefined>;
  write: (userId: string, value: T) => Promise<void>;
  label: (value: T) => string;
};

const availability: Field<{ availableDays: number[]; longDay: number | null }> = {
  name: "availability",
  fromGarmin: garminAvailability,
  current: async (userId) => {
    if (!(await enduranceEnabledFor(userId))) return undefined;
    const p = await getAthleteProfile(userId);
    return { availableDays: p?.availableDays ?? [], longDay: p?.longDay ?? null };
  },
  write: async (userId, v) => {
    await saveAthleteProfile({ userId, ...SYNC }, v);
  },
  label: (v) => `${v.availableDays.map((d) => DAY_NAMES[d]).join(" ")}${v.longDay ? ` · long day ${DAY_NAMES[v.longDay]}` : ""}`,
};

const timeZone: Field<string> = {
  name: "timeZone",
  fromGarmin: garminTimeZone,
  current: async (userId) => (await db.select({ z: users.timeZone }).from(users).where(eq(users.id, userId)))[0]?.z ?? "",
  write: async (userId, zone) => {
    await db.update(users).set({ timeZone: zone }).where(eq(users.id, userId));
  },
  label: (zone) => zone.replace(/_/g, " "),
};

const units: Field<Units> = {
  name: "units",
  fromGarmin: garminUnits,
  current: async (userId) => {
    const [u] = await db.select({ distance: users.distanceUnit, swim: users.swimUnit }).from(users).where(eq(users.id, userId));
    return u && { distance: u.distance, swim: u.swim };
  },
  write: async (userId, v) => {
    await db.update(users).set({ distanceUnit: v.distance, swimUnit: v.swim }).where(eq(users.id, userId));
  },
  label: (v) => `${v.distance === "km" ? "km" : "miles"}, swim in ${v.swim === "m" ? "meters" : "yards"}`,
};

const FIELDS = [availability, timeZone, units] as unknown as Field<unknown>[];

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

async function garminProfile(userId: string): Promise<Profile> {
  const [row] = await db
    .select({ data: garminDays.data })
    .from(garminDays)
    .where(and(eq(garminDays.userId, userId), eq(garminDays.kind, "profile")))
    .orderBy(desc(garminDays.calendarDate))
    .limit(1);
  return (row?.data as Profile) ?? null;
}

async function fieldSources(userId: string): Promise<FieldSources> {
  const [u] = await db.select({ s: users.fieldSources }).from(users).where(eq(users.id, userId));
  return u?.s ?? {};
}

/** Max HR, threshold HR, FTP and run pace from the Garmin estimates, unless the user typed or tested the value. */
async function syncThresholds(userId: string) {
  const stored = await listThresholds(userId);
  const current = currentThresholds(stored);
  for (const s of await garminSuggestions(userId, stored)) {
    const c = current[s.kind];
    if (c && c.source !== "garmin") continue;
    await addThreshold({ userId, ...SYNC }, { kind: s.kind, value: s.value, source: "garmin" });
  }
}

async function syncProfileFields(userId: string) {
  const [profile, sources] = await Promise.all([garminProfile(userId), fieldSources(userId)]);
  for (const f of FIELDS) {
    const value = f.fromGarmin(profile);
    if (value === null || isLocked(sources, f.name)) continue;
    const current = await f.current(userId);
    if (current === undefined || same(current, value)) continue;
    await f.write(userId, value);
    await markField(userId, f.name, "garmin");
  }
}

const STEPS = [syncGarminWeight, syncThresholds, syncProfileFields];

/** Runs every step when the user turned the sync on. A failed step does not stop the others. */
export async function syncFromGarmin(userId: string) {
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

/** Store Garmin's value for one field and clear its lock ("Use"). False when Garmin has none. */
export async function takeGarminValue(userId: string, name: SyncedField): Promise<boolean> {
  const f = FIELDS.find((x) => x.name === name)!;
  const value = f.fromGarmin(await garminProfile(userId));
  if (value === null || (await f.current(userId)) === undefined) return false;
  await f.write(userId, value);
  await markField(userId, name, "garmin");
  return true;
}

export type FieldSyncView = { note: string | null; says: string | null };

/** Per synced field: its source line, and Garmin's value when it differs from the stored one. */
export async function fieldSyncView(userId: string): Promise<Partial<Record<SyncedField, FieldSyncView>>> {
  const [profile, sources] = await Promise.all([garminProfile(userId), fieldSources(userId)]);
  const out: Partial<Record<SyncedField, FieldSyncView>> = {};
  for (const f of FIELDS) {
    const value = f.fromGarmin(profile);
    const current = await f.current(userId);
    if (current === undefined) continue;
    const source = sources[f.name];
    out[f.name] = { note: source ? sourceLine(source) : null, says: value !== null && !same(value, current) ? f.label(value) : null };
  }
  return out;
}
