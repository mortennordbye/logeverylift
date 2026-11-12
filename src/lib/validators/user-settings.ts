import { isValidTimeZone } from "@/lib/utils/user-date";
import { z } from "zod";

/** An IANA zone name this runtime knows ("Europe/Oslo"). */
export const timeZoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(isValidTimeZone, { message: "Unknown time zone" });

export const distanceUnitSchema = z.enum(["km", "mi"]);
export const swimUnitSchema = z.enum(["m", "yd"]);

export const setTimeZoneSchema = z.object({
  timeZone: timeZoneSchema,
  // The one-time fill from the browser: writes only while no zone is stored,
  // so it never overwrites a zone the user picked.
  ifUnset: z.boolean().optional(),
});

export const setDisplayUnitsSchema = z
  .object({
    distanceUnit: distanceUnitSchema.optional(),
    swimUnit: swimUnitSchema.optional(),
  })
  .refine((v) => v.distanceUnit !== undefined || v.swimUnit !== undefined, {
    message: "Nothing to change",
  });
