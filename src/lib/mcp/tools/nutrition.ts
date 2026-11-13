/**
 * MCP tools: fuel logs, products, sweat tests, nutrition targets and the
 * race-day plan (docs/plans/nutrition-and-race-day.md, 8). Registered only
 * with the endurance switch on (D18). Fuel logs, products and tests are
 * logged data (no revision); the race plan is plan data (revisioned, with a
 * version check). Every number carries its evidence label and the
 * not-medical-advice line, which the assistant passes on.
 */

import { audit, fail, failInternal, ok } from "@/lib/mcp/result";
import { REVISION_RULES, assistantContext, expectedVersionArg, planErrorResult, reasonArg } from "@/lib/mcp/revisions";
import {
  addProduct,
  addSweatTest,
  deleteProduct,
  deleteSweatTest,
  listProducts,
  NutritionError,
  nutritionSummary,
  saveFuelLog,
  updateProduct,
} from "@/lib/nutrition";
import { defaultPlanRace, getRacePlan, saveRacePlan } from "@/lib/race-plans";
import { userToday } from "@/lib/user-settings";
import { toDateStr } from "@/lib/utils/cycle-position";
import { carbTarget, FLUID_SAFETY, NUTRITION_DISCLAIMER } from "@/lib/utils/fueling";
import { addDaysStr } from "@/lib/utils/seasons";
import { fuelLogFields, productFields, racePlanInput, sweatTestInput } from "@/lib/validators/nutrition";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const SAFETY = `${NUTRITION_DISCLAIMER} ${FLUID_SAFETY} Pass these numbers on as guides with their evidence labels, never as a prescription.`;

/** The carbs rule by session length, as the model reads it. */
const CARB_RULES = [0, 90, 121].map((fromMinutes) => {
  const t = carbTarget(fromMinutes * 60);
  return { fromMinutes, text: t.text, evidence: t.evidence };
});

export function registerNutritionTools(server: McpServer, userId: string, clientId?: string, opts: { garmin?: boolean } = {}) {
  server.registerTool(
    "get_nutrition",
    {
      description: [
        "The athlete's fueling: the carbs-per-hour rule by session length, gut training (proved tolerance in g/h from fuel logs of 90 min or more with a GI score under 4, the next step and the race target at 80 % of it), fluid and sodium per hour from the newest sweat test (or the default band), the sweat tests, the fuel products and the fuel logs of the last `days` days (default 28).",
        "GI score: 0 = no gut symptoms, 10 = worst. Values are metric. Health data: use it for coaching only.",
        SAFETY,
      ].join(" "),
      inputSchema: { days: z.number().int().min(1).max(90).optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ days }) => {
      try {
        const today = toDateStr(await userToday(userId));
        const from = addDaysStr(today, -(days ?? 28));
        const [s, products] = await Promise.all([nutritionSummary(userId), listProducts(userId)]);
        return ok({
          safety: SAFETY,
          carbRules: CARB_RULES,
          gutTraining: s.gut,
          fluid: s.fluid,
          sodium: s.sodium,
          sweatTests: s.tests.map((t) => ({
            id: t.id,
            testedOn: t.testedOn,
            durationMinutes: Math.round(t.durationS / 60),
            preKg: t.preKg,
            postKg: t.postKg,
            fluidMl: t.fluidMl,
            urineMl: t.urineMl,
            temperatureC: t.temperatureC,
            sport: t.sport,
            sweatSodiumMgL: t.sweatSodiumMgL,
            sweatRateMlPerHour: t.mlPerHour,
            massChangePct: t.massChangePct,
            flags: t.flags,
          })),
          products: products.map((p) => ({ id: p.id, name: p.name, carbsG: p.carbsG, sodiumMg: p.sodiumMg, caffeineMg: p.caffeineMg, fluidMl: p.fluidMl })),
          fuelLogs: s.logs
            .filter((l) => l.day >= from)
            .map((l) => ({
              id: l.id,
              day: l.day,
              workoutSessionId: l.workoutSessionId,
              garminActivityId: l.garminActivityId,
              durationMinutes: l.durationS != null ? Math.round(l.durationS / 60) : null,
              carbsG: l.carbsG,
              carbsPerHour: l.carbsPerHour,
              fluidMl: l.fluidMl,
              sodiumMg: l.sodiumMg,
              caffeineMg: l.caffeineMg,
              giScore: l.giScore,
              items: l.items,
              notes: l.notes,
            })),
        });
      } catch (e) {
        return failInternal("get_nutrition", e);
      }
    },
  );

  server.registerTool(
    "log_fuel",
    {
      description: [
        "Log or replace what the athlete took in during one session: workoutSessionId (a completed session from recent_workouts)",
        opts.garmin ? "or garminActivityId (from list_garmin_activities)," : ",",
        "and any of carbsG, fluidMl, sodiumMg, caffeineMg, giScore (0 = no gut symptoms, 10 = worst), items ([{ productId, count }] from get_nutrition products; a total you do not send is their sum), notes. clear true deletes the log.",
        "A log replaces the earlier one for that session. Fuel logs are logged data: they make no revision. Requires reason.",
      ].join(" "),
      inputSchema: {
        workoutSessionId: z.number().int().positive().optional(),
        garminActivityId: z.number().int().positive().optional(),
        ...fuelLogFields,
        clear: z.boolean().optional(),
        reason: reasonArg,
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    async (args) => {
      if ((args.workoutSessionId == null) === (args.garminActivityId == null)) return fail("Send workoutSessionId or garminActivityId");
      if (args.garminActivityId != null && !opts.garmin) return fail("Garmin is not enabled for this account");
      try {
        const row = await saveFuelLog(userId, args);
        audit("log_fuel", { logId: row?.id ?? 0 });
        return ok(row ? { saved: true, id: row.id, carbsG: row.carbsG, fluidMl: row.fluidMl, sodiumMg: row.sodiumMg, durationMinutes: row.durationS != null ? Math.round(row.durationS / 60) : null } : { cleared: true });
      } catch (e) {
        if (e instanceof NutritionError) return fail(e.message);
        return failInternal("log_fuel", e);
      }
    },
  );

  server.registerTool(
    "manage_sweat_tests",
    {
      description: [
        "Add or delete a sweat-rate test. operation='add': durationMinutes (30-240), preKg and postKg (nude weights), fluidMl drunk, optional urineMl, temperatureC, sport (bike, run, other), sweatSodiumMgL (a lab value only), testedOn (YYYY-MM-DD, default today), notes.",
        "Sweat rate = (pre - post + fluid - urine) / hours. The server refuses likely typos (a weight change over 5 %, a rate outside 0-4,000 ml/h). operation='delete': id.",
        "Tests are logged data: no revision. Requires reason.",
      ].join(" "),
      inputSchema: {
        operation: z.enum(["add", "delete"]),
        id: z.number().int().positive().optional(),
        ...sweatTestInput.partial().shape,
        reason: reasonArg,
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    async ({ operation, id, ...fields }) => {
      try {
        if (operation === "delete") {
          if (id == null) return fail("id is required to delete a sweat test");
          await deleteSweatTest(userId, id);
          audit("manage_sweat_tests", { op: "delete", id });
          return ok({ deleted: true, id });
        }
        const parsed = sweatTestInput.safeParse(fields);
        if (!parsed.success) return fail("durationMinutes, preKg, postKg and fluidMl are required to add a sweat test");
        const row = await addSweatTest(userId, parsed.data);
        audit("manage_sweat_tests", { op: "add", id: row.id });
        return ok({ added: true, id: row.id });
      } catch (e) {
        if (e instanceof NutritionError) return fail(e.message);
        return failInternal("manage_sweat_tests", e);
      }
    },
  );

  server.registerTool(
    "manage_fuel_products",
    {
      description:
        "Add, change or delete one of the athlete's fuel products (a gel, drink or bar, per serving). operation='add': name, any of carbsG, sodiumMg, caffeineMg, fluidMl. operation='update': id and any field (null clears it). operation='delete': id; fuel logs keep the numbers they were saved with. At most 100 products. Logged data: no revision. Requires reason.",
      inputSchema: {
        operation: z.enum(["add", "update", "delete"]),
        id: z.number().int().positive().optional(),
        ...productFields,
        name: productFields.name.optional(),
        reason: reasonArg,
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    async ({ operation, id, ...fields }) => {
      try {
        if (operation === "add") {
          if (!fields.name) return fail("name is required to add a product");
          const row = await addProduct(userId, { ...fields, name: fields.name });
          audit("manage_fuel_products", { op: "add", id: row.id });
          return ok({ added: true, id: row.id });
        }
        if (id == null) return fail(`id is required to ${operation} a product`);
        if (operation === "delete") await deleteProduct(userId, id);
        else await updateProduct(userId, id, fields);
        audit("manage_fuel_products", { op: operation, id });
        return ok({ [operation === "delete" ? "deleted" : "updated"]: true, id });
      } catch (e) {
        if (e instanceof NutritionError) return fail(e.message);
        return failInternal("manage_fuel_products", e);
      }
    },
  );

  server.registerTool(
    "get_race_plan",
    {
      description: [
        "The race-day plan for a half or full triathlon on the athlete's season: raceId (default: the next A race). Returns the stored inputs with the plan's version (null until the first save), the timeline (clock times per leg with transitions), pacing per leg (swim from CSS plus an offset, bike IF and watts from the TSS cap and the bike time, run heart-rate ceiling and a guide pace), the fuel schedule (carbs, fluid and sodium per interval on the bike and run), caffeine when the plan has it on, race morning, and the safety lines.",
        "Leg times are the athlete's, else from thresholds, else assumed (each leg says which). Pacing is a guide, never a finish prediction.",
        SAFETY,
      ].join(" "),
      inputSchema: { raceId: z.number().int().positive().optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ raceId }) => {
      try {
        const id = raceId ?? (await defaultPlanRace(userId))?.id;
        if (id == null) return fail("No half or full triathlon ahead on the athlete's seasons. Add one with manage_race.");
        const p = await getRacePlan(userId, id);
        if (!p) return fail("Race not found");
        return ok(p);
      } catch (e) {
        return failInternal("get_race_plan", e);
      }
    },
  );

  server.registerTool(
    "update_race_plan",
    {
      description: [
        "Change the inputs of a race's plan: raceId and any of startTime (HH:MM), swimMinutes, bikeMinutes, runMinutes (your expected leg times), t1Minutes, t2Minutes, swimOffsetSecondsPer100m (added to CSS pace), fuelIntervalMinutes (15 or 20), caffeine (true to show caffeine timing), raceTemperatureC (picks the sweat test nearest it), notes. A null clears a field.",
        `The first save creates the plan; after that expectedVersion is required (read it with get_race_plan). Requires reason. ${REVISION_RULES}`,
      ].join(" "),
      inputSchema: {
        raceId: z.number().int().positive(),
        ...racePlanInput.shape,
        reason: reasonArg,
        expectedVersion: expectedVersionArg.optional(),
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    async ({ raceId, reason, expectedVersion, ...change }) => {
      try {
        const current = await getRacePlan(userId, raceId);
        if (!current) return fail("Race not found");
        if (current.version != null && expectedVersion == null) return fail("expectedVersion is required: the plan exists. Read it with get_race_plan.");
        const r = await saveRacePlan(assistantContext(userId, clientId, reason), raceId, change, expectedVersion);
        return ok({ saved: true, id: r.id, version: r.version });
      } catch (e) {
        return (await planErrorResult(userId, e)) ?? failInternal("update_race_plan", e);
      }
    },
  );
}
