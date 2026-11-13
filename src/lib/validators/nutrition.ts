/**
 * Input shapes for fuel logs, products, sweat tests and race plans
 * (docs/plans/nutrition-and-race-day.md, 3 and 8), shared by the Server
 * Actions and the MCP tools. Values are metric.
 */

import { SWEAT_TEST_SPORTS } from "@/db/schema/nutrition";
import { dateStr } from "@/lib/validators/athlete-profile";
import { z } from "zod";

export const FUEL_PRODUCTS_MAX = 100;
export const FUEL_ITEMS_MAX = 20;
export const SWEAT_TESTS_MAX = 200;
export const NUTRITION_NOTES_MAX = 500;

const amount = (max: number) => z.number().int().min(0).max(max).nullable().optional();

export const fuelLogFields = {
  carbsG: amount(2000),
  fluidMl: amount(20000),
  sodiumMg: amount(20000),
  caffeineMg: amount(2000),
  giScore: z.number().int().min(0).max(10).nullable().optional(),
  items: z
    .array(z.object({ productId: z.number().int().positive(), count: z.number().min(0.5).max(50) }))
    .max(FUEL_ITEMS_MAX)
    .nullable()
    .optional(),
  notes: z.string().trim().max(NUTRITION_NOTES_MAX).nullable().optional(),
};

export const fuelLogInput = z
  .object({
    workoutSessionId: z.number().int().positive().optional(),
    garminActivityId: z.number().int().positive().optional(),
    clear: z.boolean().optional(),
    ...fuelLogFields,
  })
  .refine((d) => (d.workoutSessionId == null) !== (d.garminActivityId == null), "Give one session: workoutSessionId or garminActivityId");
export type FuelLogInput = z.infer<typeof fuelLogInput>;

export const productFields = {
  name: z.string().trim().min(1).max(100),
  carbsG: z.number().min(0).max(500).nullable().optional(),
  sodiumMg: z.number().int().min(0).max(5000).nullable().optional(),
  caffeineMg: z.number().int().min(0).max(500).nullable().optional(),
  fluidMl: z.number().int().min(0).max(2000).nullable().optional(),
};
export const productInput = z.object(productFields);
export const productChange = z.object({ id: z.number().int().positive(), ...productFields, name: productFields.name.optional() });
export type ProductInput = z.infer<typeof productInput>;

export const sweatTestInput = z.object({
  testedOn: dateStr.optional(),
  // The same bounds as sweatTestError in src/lib/utils/fueling.ts.
  durationMinutes: z.number().min(30).max(240),
  preKg: z.number().positive().max(400),
  postKg: z.number().positive().max(400),
  fluidMl: z.number().int().min(0).max(20000),
  urineMl: z.number().int().min(0).max(10000).nullable().optional(),
  temperatureC: z.number().min(-20).max(50).nullable().optional(),
  sport: z.enum(SWEAT_TEST_SPORTS).nullable().optional(),
  sweatSodiumMgL: z.number().int().min(100).max(4000).nullable().optional(),
  notes: z.string().trim().max(NUTRITION_NOTES_MAX).nullable().optional(),
});
export type SweatTestInput = z.infer<typeof sweatTestInput>;

const minutes = (max: number) => z.number().min(1).max(max).nullable().optional();

/** What a race plan stores (race_plans.plan). Everything else is worked out on read. */
export const racePlanInput = z.object({
  startTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM")
    .nullable()
    .optional(),
  swimMinutes: minutes(300),
  bikeMinutes: minutes(720),
  runMinutes: minutes(600),
  t1Minutes: z.number().min(0).max(60).nullable().optional(),
  t2Minutes: z.number().min(0).max(60).nullable().optional(),
  swimOffsetSecondsPer100m: z.number().min(0).max(60).nullable().optional(),
  fuelIntervalMinutes: z.union([z.literal(15), z.literal(20)]).nullable().optional(),
  caffeine: z.boolean().nullable().optional(),
  raceTemperatureC: z.number().min(-10).max(50).nullable().optional(),
  notes: z.string().trim().max(NUTRITION_NOTES_MAX).nullable().optional(),
});
export type RacePlanInput = z.infer<typeof racePlanInput>;
