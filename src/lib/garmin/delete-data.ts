/**
 * Every table that holds a user's Garmin data, except the connection itself.
 * Used by "Disconnect and delete Garmin data" and by the worker when that
 * happened while it was importing (worker.ts).
 */

import { db } from "@/db";
import {
  garminActivities,
  garminActivityFiles,
  garminActivityMetrics,
  garminActivityStreams,
  garminDailyMetrics,
  garminDays,
  fuelLogs,
  garminFuelLogs,
  garminSyncRuns,
} from "@/db/schema";
import { and, eq, isNotNull } from "drizzle-orm";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function deleteGarminData(tx: Tx | typeof db, userId: string) {
  await tx.delete(garminDays).where(eq(garminDays.userId, userId));
  await tx.delete(garminDailyMetrics).where(eq(garminDailyMetrics.userId, userId));
  await tx.delete(garminActivityMetrics).where(eq(garminActivityMetrics.userId, userId));
  await tx.delete(garminActivityStreams).where(eq(garminActivityStreams.userId, userId));
  await tx.delete(garminActivityFiles).where(eq(garminActivityFiles.userId, userId));
  await tx.delete(garminActivities).where(eq(garminActivities.userId, userId));
  await tx.delete(garminSyncRuns).where(eq(garminSyncRuns.userId, userId));
  await tx.delete(garminFuelLogs).where(eq(garminFuelLogs.userId, userId));
  // Fuel logs on Garmin activities go with them; logs on app sessions stay.
  await tx.delete(fuelLogs).where(and(eq(fuelLogs.userId, userId), isNotNull(fuelLogs.garminActivityId)));
}
