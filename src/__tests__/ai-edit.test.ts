/**
 * AI edits: the request and profile helpers, the cache key, starting weights,
 * the free-model guard, and editPlanWithAi's cache, limit and validation
 * behaviour against a mocked database and model.
 */

import { aiGenerations, aiModelConfigs, aiPlanCache, exercisePrs, programs } from "@/db/schema";
import {
  ageBand,
  checkEdit,
  editCacheMaterial,
  genericProfile,
  normalizeEditRequest,
  normalizeEditText,
  type GenericProfile,
} from "@/lib/utils/ai-edit";
import type { AiPlan } from "@/lib/utils/ai-plan";
import {
  buildTemplatePlan,
  fillStartingWeights,
  stripWeights,
  type TemplateParams,
} from "@/lib/utils/plan-templates";
import { isFreeModel } from "@/lib/utils/llm-response";
import { aiEditSchema, editRequestSchema, templateParamsSchema } from "@/lib/validators/ai-setup";
import { beforeEach, describe, expect, it, vi } from "vitest";

const athlete = { bodyWeightKg: 80, sex: "male", lifts: {} };
const picks: TemplateParams = { goal: "general_fitness", level: "beginner", daysPerWeek: 3, equipment: "full_gym", weeks: 8 };
const profile: GenericProfile = { ageBand: "25_34", gender: "male", goals: ["strength"], experience: "beginner" };
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe("ageBand", () => {
  it("bands by age and hides a missing or future birth year", () => {
    expect(ageBand(2002, 2026)).toBe("under_25");
    expect(ageBand(2001, 2026)).toBe("25_34");
    expect(ageBand(1992, 2026)).toBe("25_34");
    expect(ageBand(1991, 2026)).toBe("35_44");
    expect(ageBand(1972, 2026)).toBe("45_54");
    expect(ageBand(1962, 2026)).toBe("55_64");
    expect(ageBand(1961, 2026)).toBe("65_plus");
    expect(ageBand(null, 2026)).toBe("unspecified");
    expect(ageBand(2030, 2026)).toBe("unspecified");
  });
});

describe("genericProfile", () => {
  it("keeps only coarse fields and maps unknown values to unspecified", () => {
    expect(genericProfile({ birthYear: 1990, gender: "prefer_not_to_say", goals: ["muscle_gain", "strength"], experienceLevel: null }, 2026)).toEqual({
      ageBand: "35_44",
      gender: "unspecified",
      goals: ["strength", "muscle_gain"],
      experience: "unspecified",
    });
  });
});

describe("edit requests", () => {
  it("normalizes text so trivial differences hit the same cache row", () => {
    expect(normalizeEditText("  No   Barbell Rows, please!  ")).toBe("no barbell rows, please");
    expect(normalizeEditRequest({ chips: ["prefer_machines", "more_variety"], text: "Hi." })).toEqual({
      chips: ["more_variety", "prefer_machines"],
      text: "hi",
    });
  });

  it("gives equivalent requests the same cache material and different ones different", () => {
    const a = editCacheMaterial(profile, { ...picks, avoid: ["knees", "shoulders"] }, { chips: ["prefer_machines", "more_variety"], text: "No rows." });
    const b = editCacheMaterial(
      { ...profile, goals: [...profile.goals].reverse() },
      { ...picks, avoid: ["shoulders", "knees"] },
      { chips: ["more_variety", "prefer_machines"], text: "no rows" },
    );
    expect(a).toBe(b);
    expect(editCacheMaterial({ ...profile, ageBand: "35_44" }, picks, { chips: ["more_variety"], text: "" })).not.toBe(
      editCacheMaterial(profile, picks, { chips: ["more_variety"], text: "" }),
    );
    expect(editCacheMaterial(profile, { ...picks, sessionMinutes: 45 }, { chips: ["more_variety"], text: "" })).not.toBe(
      editCacheMaterial(profile, picks, { chips: ["more_variety"], text: "" }),
    );
  });

  it("flags exercises outside the equipment pick", () => {
    const plan = buildTemplatePlan({ ...picks, equipment: "full_gym" }, athlete);
    expect(checkEdit(plan, { equipment: "full_gym" })).toEqual([]);
    expect(checkEdit(plan, { equipment: "dumbbells" }).join()).toContain("Squat (barbell)");
  });

  it("flags a session that runs well over the chosen length", () => {
    const plan = buildTemplatePlan({ ...picks, sessionMinutes: 45 }, athlete);
    expect(checkEdit(plan, { equipment: "full_gym", sessionMinutes: 45 })).toEqual([]);
    const long = clone(plan);
    for (const ex of long.programs[0].exercises) ex.sets.push(...clone(ex.sets), ...clone(ex.sets));
    expect(checkEdit(long, { equipment: "full_gym", sessionMinutes: 45 }).join()).toContain(`"${long.programs[0].name}" takes about`);
    expect(checkEdit(long, { equipment: "full_gym" })).toEqual([]);
  });

  it("keys the cache on the chosen weekdays, in any order", () => {
    const request = { chips: ["more_variety" as const], text: "" };
    expect(editCacheMaterial(profile, { ...picks, weekdays: [5, 1, 3] }, request)).toBe(
      editCacheMaterial(profile, { ...picks, weekdays: [1, 3, 5] }, request),
    );
    expect(editCacheMaterial(profile, { ...picks, weekdays: [2, 4, 6] }, request)).not.toBe(
      editCacheMaterial(profile, picks, request),
    );
  });
});

describe("validators", () => {
  it("accepts a full set of picks and rejects a split the days can't hold", () => {
    expect(templateParamsSchema.safeParse({ ...picks, sessionMinutes: 45, split: "ppl", priorities: ["arms"], avoid: ["knees"] }).success).toBe(true);
    expect(templateParamsSchema.safeParse({ ...picks, daysPerWeek: 4, split: "ppl" }).success).toBe(false);
    expect(templateParamsSchema.safeParse({ ...picks, daysPerWeek: 7 }).success).toBe(false);
    expect(templateParamsSchema.safeParse({ ...picks, sessionMinutes: 50 }).success).toBe(false);
  });

  it("takes one different weekday per training day", () => {
    expect(templateParamsSchema.safeParse({ ...picks, weekdays: [2, 4, 6] }).success).toBe(true);
    expect(templateParamsSchema.safeParse({ ...picks, weekdays: [2, 4] }).success).toBe(false);
    expect(templateParamsSchema.safeParse({ ...picks, weekdays: [2, 2, 4] }).success).toBe(false);
    expect(templateParamsSchema.safeParse({ ...picks, weekdays: [0, 2, 4] }).success).toBe(false);
    expect(templateParamsSchema.safeParse({ ...picks, weekdays: [2, 4, 8] }).success).toBe(false);
  });

  it("caps priorities at two different muscles", () => {
    expect(templateParamsSchema.safeParse({ ...picks, priorities: ["arms", "chest", "back"] }).success).toBe(false);
    expect(templateParamsSchema.safeParse({ ...picks, priorities: ["arms", "arms"] }).success).toBe(false);
  });

  it("needs a chip or text, text for the swap chip, and at most 200 characters", () => {
    expect(editRequestSchema.safeParse({ chips: [], text: "  " }).success).toBe(false);
    expect(editRequestSchema.safeParse({ chips: ["swap_named"], text: "" }).success).toBe(false);
    expect(editRequestSchema.safeParse({ chips: ["swap_named"], text: "no lunges" }).success).toBe(true);
    expect(editRequestSchema.safeParse({ chips: [], text: "x".repeat(201) }).success).toBe(false);
    expect(editRequestSchema.safeParse({ chips: ["not_a_chip"], text: "" }).success).toBe(false);
  });
});

describe("fillStartingWeights", () => {
  const ex = (plan: AiPlan, name: string) => plan.programs.flatMap((p) => p.exercises).find((e) => e.name === name)!;

  it("uses the athlete's lift, else the template ratio, and warms up at half", () => {
    const stripped = stripWeights(buildTemplatePlan(picks, athlete));
    const known = fillStartingWeights(stripped, "beginner", { ...athlete, lifts: { Squat: 140 } });
    expect(ex(known, "Squat").sets.map((s) => s.kg)).toEqual([50, 97.5, 97.5, 97.5]); // 70% of 140 for 8 reps, to 2.5 kg; warm-up half of that
    const estimated = fillStartingWeights(stripped, "beginner", athlete);
    expect(estimated).toEqual(buildTemplatePlan(picks, athlete));
  });

  it("estimates library exercises the templates don't use, and gives unknown ones the equipment's lightest load", () => {
    const plan = clone(stripWeights(buildTemplatePlan(picks, athlete)));
    Object.assign(plan.programs[0].exercises[1], { name: "Pec Deck Machine", equipment: "machine" });
    Object.assign(plan.programs[0].exercises[2], { name: "My Custom Press", equipment: "machine" });
    const filled = fillStartingWeights(plan, "beginner", athlete);
    expect(ex(filled, "Pec Deck Machine").sets.map((s) => s.kg)).toEqual([10, 20, 20, 20]); // 80 × 0.6 × 0.6 × 70%, to 5 kg; warm-up half
    expect(ex(filled, "My Custom Press").sets.every((s) => s.kg === 5)).toBe(true);
  });

  it("keeps bodyweight at 0, leaves timed sets without load, and never overwrites a set load", () => {
    const plan = clone(stripWeights(buildTemplatePlan(picks, athlete)));
    const squat = plan.programs[0].exercises[0];
    squat.sets[1].kg = 100;
    const cardio = { ...squat, name: "Rowing Machine", equipment: "machine" as const, sets: [{ ...squat.sets[1], reps: null, kg: null, durSec: 300 }] };
    plan.programs[0].exercises.push(cardio);
    const filled = fillStartingWeights(plan, "beginner", athlete);
    expect(ex(filled, "Squat").sets[1].kg).toBe(100);
    expect(ex(filled, "Rowing Machine").sets[0].kg).toBeNull();
    expect(ex(filled, "Plank").sets.every((s) => s.kg === 0)).toBe(true);
  });

  it("stripWeights clears loads but not bodyweight zeros", () => {
    const stripped = stripWeights(buildTemplatePlan(picks, athlete));
    expect(ex(stripped, "Squat").sets.every((s) => s.kg === null)).toBe(true);
    expect(ex(stripped, "Plank").sets.every((s) => s.kg === 0)).toBe(true);
  });
});

describe("isFreeModel", () => {
  it("allows OpenRouter free models, the free router and Gemini, nothing else", () => {
    expect(isFreeModel({ modelId: "openrouter/free", provider: "openrouter" })).toBe(true);
    expect(isFreeModel({ modelId: "google/gemma-4-31b-it:free", provider: "openrouter" })).toBe(true);
    expect(isFreeModel({ modelId: "gemini-2.5-flash", provider: "google" })).toBe(true);
    expect(isFreeModel({ modelId: "openai/gpt-4o", provider: "openrouter" })).toBe(false);
    expect(isFreeModel({ modelId: "anthropic/claude:freeish", provider: "openrouter" })).toBe(false);
    expect(isFreeModel({ modelId: "x:free", provider: "other" })).toBe(false);
  });
});

// ─── editPlanWithAi ──────────────────────────────────────────────────────────

const rows = new Map<unknown, unknown[]>();
const inserts: { table: unknown; values: Record<string, unknown> }[] = [];
const updates: { table: unknown; values: Record<string, unknown> }[] = [];
const callModel = vi.fn();
let role = "user";
let aiConsentAt: Date | null = new Date();

function query(table: unknown) {
  const result = Promise.resolve(rows.get(table) ?? []);
  return Object.assign(result, { orderBy: () => result });
}

vi.mock("@/db", () => ({
  db: {
    query: { users: { findFirst: async () => ({ id: "u1", birthYear: 1995, gender: "male", goals: '["strength"]', experienceLevel: "beginner", weightKg: 80, aiConsentAt }) } },
    select: () => ({
      from: (table: unknown) => {
        const chain = { innerJoin: () => chain, where: () => query(table) };
        return chain;
      },
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        inserts.push({ table, values });
        return Object.assign(Promise.resolve(), { onConflictDoNothing: async () => {} });
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          updates.push({ table, values });
        },
      }),
    }),
  },
}));
vi.mock("@/lib/utils/session", () => ({ requireSession: async () => ({ user: { id: "u1", role } }) }));
vi.mock("@/lib/env", () => ({ env: { OPENROUTER_API_KEY: "test", GOOGLE_API_KEY: undefined, BETTER_AUTH_URL: "http://localhost" } }));
vi.mock("@/lib/actions/exercises", () => ({
  getAllExercises: async () => ({ success: true, data: [{ name: "Squat" }, { name: "Seated Cable Row" }, { name: "Bench Press" }] }),
}));
vi.mock("@/lib/llm", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/llm")>()),
  capabilitiesFor: async () => ({ modes: ["json_schema"], forceTool: false, maxCompletionTokens: null }),
  callModel: (...args: unknown[]) => callModel(...args),
}));

const { editPlanWithAi } = await import("@/lib/actions/ai-generate");

const FREE = { modelId: "openrouter/free", label: "Free", provider: "openrouter" };
const base = () => stripWeights(buildTemplatePlan(picks, athlete));
const swapped = (): AiPlan => {
  const plan = clone(base());
  Object.assign(plan.programs[0].exercises[2], { name: "Seated Cable Row", equipment: "cable" });
  return plan;
};
const request = { picks, request: { chips: ["swap_named"], text: "No barbell rows" } };

beforeEach(() => {
  rows.clear();
  rows.set(aiGenerations, [{ value: 0 }]);
  rows.set(aiModelConfigs, [FREE]);
  rows.set(exercisePrs, []);
  rows.set(programs, [{ name: "Full Body A" }]);
  inserts.length = 0;
  updates.length = 0;
  callModel.mockReset();
  role = "user";
  aiConsentAt = new Date();
});

describe("editPlanWithAi", () => {
  it("calls a model on a miss, caches the plan without loads, counts it, and returns it with this athlete's loads", async () => {
    callModel.mockResolvedValue({ ok: true, text: JSON.stringify(swapped()), truncated: false });

    const result = await editPlanWithAi(request);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.fromCache).toBe(false);
    expect(result.data.generationsToday).toBe(1);
    const cached = inserts.find((i) => i.table === aiPlanCache)!.values;
    expect(cached.modelUsed).toBe("openrouter/free");
    expect(cached.edit).toEqual({ chips: ["swap_named"], text: "no barbell rows" });
    const cachedRow = (cached.plan as AiPlan).programs[0].exercises.find((e) => e.name === "Seated Cable Row")!;
    expect(cachedRow.sets.every((s) => s.kg === null)).toBe(true);
    expect(inserts.filter((i) => i.table === aiGenerations)).toHaveLength(1);

    // Program names are made unique against the user's, and loads are filled.
    expect(result.data.plan.programs.map((p) => p.name)).toEqual(["Full Body A 2", "Full Body B"]);
    const row = result.data.plan.programs[0].exercises.find((e) => e.name === "Seated Cable Row")!;
    expect(row.sets.every((s) => (s.kg ?? 0) > 0)).toBe(true);
  });

  it("reuses a cached edit without calling a model or counting it, even at the daily limit", async () => {
    rows.set(aiPlanCache, [{ plan: swapped() }]);
    rows.set(aiGenerations, [{ value: 5 }]);

    const result = await editPlanWithAi(request);

    expect(result.success && result.data.fromCache).toBe(true);
    expect(callModel).not.toHaveBeenCalled();
    expect(inserts).toEqual([]);
    expect(updates.map((u) => u.table)).toEqual([aiPlanCache]);
  });

  it("stops at the daily limit on a miss", async () => {
    rows.set(aiGenerations, [{ value: 5 }]);
    const result = await editPlanWithAi(request);
    expect(result.success).toBe(false);
    expect(callModel).not.toHaveBeenCalled();
  });

  it("lets admins past the limit", async () => {
    role = "admin";
    rows.set(aiGenerations, [{ value: 50 }]);
    callModel.mockResolvedValue({ ok: true, text: JSON.stringify(swapped()), truncated: false });
    const result = await editPlanWithAi(request);
    expect(result.success).toBe(true);
  });

  it("calls no model without the user's AI opt-in", async () => {
    aiConsentAt = null;
    const result = await editPlanWithAi(request);
    expect(result).toEqual({ success: false, error: "Turn on AI editing first." });
    expect(callModel).not.toHaveBeenCalled();
  });

  it("never calls the free Gemini API, which Google doesn't allow for EEA users", async () => {
    rows.set(aiModelConfigs, [{ modelId: "gemini-2.5-flash", label: "Gemini", provider: "google" }]);
    const result = await editPlanWithAi(request);
    expect(result).toEqual({ success: false, error: "No free AI models are enabled. Ask an admin to enable one." });
    expect(callModel).not.toHaveBeenCalled();
  });

  it("never calls a model that isn't free", async () => {
    rows.set(aiModelConfigs, [{ modelId: "openai/gpt-4o", label: "GPT-4o", provider: "openrouter" }]);
    const result = await editPlanWithAi(request);
    expect(result).toEqual({ success: false, error: "No free AI models are enabled. Ask an admin to enable one." });
    expect(callModel).not.toHaveBeenCalled();
  });

  it("repairs a plan that breaks the picks, then gives up without caching or counting", async () => {
    const extraDay = swapped();
    extraDay.cycle!.slots.push({ prog: "Full Body B", day: 7, idx: null, label: null, auto: false });
    const dumbbellsOnly = { ...request, picks: { ...picks, equipment: "dumbbells" as const } };
    callModel.mockResolvedValue({ ok: true, text: JSON.stringify(extraDay), truncated: false });

    const result = await editPlanWithAi(dumbbellsOnly);

    expect(result).toMatchObject({ success: false, error: expect.stringContaining("rephrase") });
    expect(callModel).toHaveBeenCalledTimes(2);
    const repair = (callModel.mock.calls[1][1] as { content: string }[]).at(-1)!.content;
    expect(repair).toContain("trains 3 days per week, but the cycle has 4 slots");
    expect(inserts).toEqual([]);

    // The equipment check runs once the plan itself is valid.
    callModel.mockReset();
    callModel.mockResolvedValue({ ok: true, text: JSON.stringify(swapped()), truncated: false });
    await editPlanWithAi(dumbbellsOnly);
    expect((callModel.mock.calls[1][1] as { content: string }[]).at(-1)!.content).toContain("only has: dumbbells");
  });

  it("blames busy models, not the request, when no model answered", async () => {
    callModel.mockResolvedValue({ ok: false, reason: "unavailable", detail: "timed out" });
    const result = await editPlanWithAi(request);
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("busy or unavailable") });
    expect(inserts).toEqual([]);
  });

  it("rejects invalid input before touching anything", async () => {
    const result = await editPlanWithAi({ ...request, picks: { ...picks, daysPerWeek: 4, split: "ppl" } });
    expect(result.success).toBe(false);
    expect(callModel).not.toHaveBeenCalled();
    expect(aiEditSchema.safeParse(request).success).toBe(true);
  });
});
