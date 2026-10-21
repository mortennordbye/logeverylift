/**
 * The contract between AI Setup and the model.
 *
 * One Zod schema drives everything: it is exported as JSON Schema for
 * providers that enforce structure (response_format json_schema, a tool's
 * parameters, Gemini's responseJsonSchema), described to the model in the
 * prompt, and used to validate whatever comes back — enforced or not.
 *
 * The shape is strict-mode friendly (every key required, absent values are
 * null, no extra keys) and deliberately flatter than the import format, which
 * `toImportPayload` converts to. Parsing is lenient where weak models slip:
 * numeric strings, enum casing and omitted nullable keys are accepted.
 */

import { MAX_REQUIRED_HITS, MIN_REQUIRED_HITS, PROGRESSION_ADVANCES } from "@/lib/utils/progression";
import type { PromptOptions } from "@/lib/utils/ai-prompt";
import { z } from "zod";

export const AI_CYCLE_WEEKS = [4, 6, 8, 10, 12, 16] as const;
export const MAX_PROGRAMS = 7;
export const MAX_EXERCISES_PER_PROGRAM = 8;
export const MAX_SETS_PER_EXERCISE = 5;

const CATEGORIES = ["strength", "cardio", "flexibility"] as const;
const AREAS = ["upper_body", "lower_body", "core", "full_body", "cardio"] as const;
const MUSCLES = [
  "chest", "back", "shoulders", "biceps", "triceps", "forearms", "quads",
  "hamstrings", "glutes", "calves", "abs", "lower_back", "full_body", "cardio",
] as const;
const EQUIPMENT = ["barbell", "dumbbell", "machine", "cable", "bodyweight", "kettlebell", "bands", "other"] as const;
const PATTERNS = ["push", "pull", "hinge", "squat", "carry", "rotation", "isometric", "cardio"] as const;
const ROLES = ["compound", "accessory", "isolation", "plyometric", "isometric"] as const;

// "60" → 60. Only strings that are entirely a number; null stays null.
const num = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)) ? Number(v) : v),
    schema,
  );
// "Upper Body" / "upper-body" → "upper_body"
const token = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toLowerCase().replace(/[\s-]+/g, "_") : v),
    schema,
  );
const nullableInt = (min: number, max: number) =>
  num(z.number().int().min(min).max(max).nullable()).default(null);

const aiSetSchema = z.object({
  type: token(z.enum(["working", "warmup"])).default("working"),
  reps: nullableInt(0, 100),
  kg: num(z.number().min(0).max(1000).nullable()).default(null),
  durSec: nullableInt(0, 36000),
  distM: nullableInt(0, 100000),
  rest: num(z.number().int().min(0).max(600)),
  repMin: nullableInt(1, 100),
  repMax: nullableInt(1, 100),
  rir: nullableInt(0, 5),
});

const aiExerciseSchema = z.object({
  name: z.string().trim().min(1).max(100),
  category: token(z.enum(CATEGORIES)),
  area: token(z.enum(AREAS)),
  muscle: token(z.enum(MUSCLES)),
  equipment: token(z.enum(EQUIPMENT)),
  pattern: token(z.enum(PATTERNS)),
  role: token(z.enum(ROLES)),
  adv: token(z.enum(PROGRESSION_ADVANCES)),
  hits: nullableInt(MIN_REQUIRED_HITS, MAX_REQUIRED_HITS),
  incKg: num(z.number().min(0).max(50).nullable()).default(null),
  incReps: nullableInt(0, 20),
  sets: z.array(aiSetSchema).min(1).max(MAX_SETS_PER_EXERCISE),
});

const aiProgramSchema = z.object({
  name: z.string().trim().min(1).max(100),
  exercises: z.array(aiExerciseSchema).min(1).max(MAX_EXERCISES_PER_PROGRAM),
});

const aiSlotSchema = z.object({
  prog: z.string().trim().min(1).max(100),
  day: nullableInt(1, 7),
  idx: nullableInt(1, 20),
  label: z.string().max(100).nullable().default(null),
  auto: z.boolean().default(false),
});

const aiCycleSchema = z.object({
  name: z.string().trim().min(1).max(100),
  weeks: num(z.union(AI_CYCLE_WEEKS.map((w) => z.literal(w)))),
  sched: token(z.enum(["day_of_week", "rotation"])),
  slots: z.array(aiSlotSchema).min(1).max(14),
});

export const aiPlanSchema = z.object({
  programs: z.array(aiProgramSchema).min(1).max(MAX_PROGRAMS),
  cycle: aiCycleSchema.nullable().default(null),
});

export type AiPlan = z.infer<typeof aiPlanSchema>;
export type AiPlanConstraints = Pick<PromptOptions, "daysPerWeek" | "cycleDurationWeeks">;

// Keywords some providers reject in enforced schemas. Zod still checks every
// one of them after the response arrives, so dropping them loses nothing.
const UNSUPPORTED_KEYWORDS = new Set([
  "$schema", "default", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum",
  "minLength", "maxLength", "minItems", "maxItems", "pattern", "format",
]);

function simplify(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(simplify);
  if (typeof node !== "object" || node === null) return node;
  const obj = node as Record<string, unknown>;

  // anyOf of literals → enum: `weeks` is a union of numbers.
  if (Array.isArray(obj.anyOf) && obj.anyOf.every((b) => (b as { const?: unknown }).const !== undefined)) {
    const values = obj.anyOf.map((b) => (b as { const: unknown }).const);
    return { type: typeof values[0] === "number" ? "integer" : "string", enum: values };
  }
  // anyOf [primitive, null] → type: [primitive, "null"]: the form every
  // structured-output implementation accepts. Nullable objects keep anyOf.
  if (Array.isArray(obj.anyOf) && obj.anyOf.length === 2) {
    const [a, b] = obj.anyOf as Record<string, unknown>[];
    const nonNull = b?.type === "null" ? a : a?.type === "null" ? b : null;
    if (nonNull && typeof nonNull.type === "string" && nonNull.type !== "object") {
      return { ...(simplify(nonNull) as object), type: [nonNull.type, "null"] };
    }
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (UNSUPPORTED_KEYWORDS.has(key)) continue;
    out[key] = key === "properties"
      ? Object.fromEntries(Object.entries(value as object).map(([k, v]) => [k, simplify(v)]))
      : simplify(value);
  }
  return out;
}

let cachedJsonSchema: Record<string, unknown> | null = null;

/** The plan schema as provider-safe JSON Schema (strict-mode compatible). */
export function aiPlanJsonSchema(): Record<string, unknown> {
  cachedJsonSchema ??= simplify(z.toJSONSchema(aiPlanSchema)) as Record<string, unknown>;
  return cachedJsonSchema;
}

/**
 * Pulls a JSON value out of a model's text: drops reasoning (a <think> block,
 * or everything before a lone closing tag), prefers a fenced block, then scans
 * for balanced objects and takes the one that looks like a plan. Tolerates
 * trailing commas and // comments. Unwraps the envelopes models like to add
 * ({"plan": {...}}, {"arguments": "..."}). Returns null if nothing parses.
 */
export function parsePlanText(raw: string): unknown | null {
  let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const lastClose = text.toLowerCase().lastIndexOf("</think>");
  if (lastClose !== -1) text = text.slice(lastClose + "</think>".length);
  text = text.trim();

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const whole = tryParse(fence ? fence[1].trim() : text);
  if (whole !== null) return unwrap(whole);

  const objects = balancedObjects(text).map(tryParse).filter((v): v is object => v !== null && typeof v === "object");
  const plan = objects.find((o) => unwrap(o) !== null && typeof unwrap(o) === "object" && "programs" in (unwrap(o) as object));
  return unwrap(plan ?? objects.sort((x, y) => JSON.stringify(y).length - JSON.stringify(x).length)[0] ?? null);
}

/** Every top-level {...} span, matched with string and escape awareness. */
function balancedObjects(text: string): string[] {
  const spans: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}" && depth > 0) {
      depth--;
      if (depth === 0) spans.push(text.slice(start, i + 1));
    }
  }
  return spans;
}

function tryParse(text: string): unknown | null {
  for (const candidate of [text, relaxJson(text)]) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try the relaxed form next
    }
  }
  return null;
}

// Trailing commas and line comments outside strings: the two slips weak
// models make most in otherwise valid JSON.
function relaxJson(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    out += ch;
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

function unwrap(value: unknown, depth = 0): unknown | null {
  if (depth > 3 || value === null || typeof value !== "object") return value ?? null;
  if (Array.isArray(value)) return value.length === 1 ? unwrap(value[0], depth + 1) : value;
  const obj = value as Record<string, unknown>;
  if ("programs" in obj) return obj;
  for (const key of ["plan", "setup", "arguments", "parameters", "data", "result", "output"]) {
    const inner = obj[key];
    if (typeof inner === "string") {
      const parsed = tryParse(inner);
      if (parsed !== null) return unwrap(parsed, depth + 1);
    } else if (inner && typeof inner === "object") {
      return unwrap(inner, depth + 1);
    }
  }
  return obj;
}

/**
 * Rules the schema can't express. Each message names the place and the fix,
 * because it is sent back to the model verbatim on a repair attempt.
 */
export function checkPlan(plan: AiPlan, constraints: AiPlanConstraints = {}): string[] {
  const issues: string[] = [];
  const names = plan.programs.map((p) => p.name);

  const seen = new Set<string>();
  for (const name of names) {
    const key = name.toLowerCase();
    if (seen.has(key)) issues.push(`Two programs are named "${name}". Program names must be unique.`);
    seen.add(key);
  }

  plan.programs.forEach((program, pi) => {
    program.exercises.forEach((ex, ei) => {
      const where = `programs[${pi}] "${program.name}" exercise ${ei + 1} "${ex.name}"`;
      const working = ex.sets.filter((s) => s.type === "working");
      if (working.length === 0) issues.push(`${where} has no working sets; add at least one set with type "working".`);
      ex.sets.forEach((set, si) => {
        if (set.repMin !== null && set.repMax !== null && set.repMin > set.repMax) {
          issues.push(`${where} set ${si + 1}: repMin (${set.repMin}) is above repMax (${set.repMax}).`);
        }
        if (set.reps === null && set.durSec === null && set.distM === null) {
          issues.push(`${where} set ${si + 1} has no target; set reps, durSec or distM.`);
        }
      });
      if (ex.adv === "double" && working.some((s) => s.repMin === null || s.repMax === null)) {
        issues.push(`${where} uses adv "double", which needs repMin and repMax on every working set.`);
      }
      if (ex.adv === "duration" && working.some((s) => s.durSec === null)) {
        issues.push(`${where} uses adv "duration", which needs durSec on every working set.`);
      }
      if (ex.adv === "distance" && working.some((s) => s.distM === null)) {
        issues.push(`${where} uses adv "distance", which needs distM on every working set.`);
      }
    });
  });

  const cycle = plan.cycle;
  if (cycle) {
    const lower = new Set(names.map((n) => n.toLowerCase()));
    cycle.slots.forEach((slot, i) => {
      if (!lower.has(slot.prog.toLowerCase())) {
        issues.push(`cycle slot ${i + 1} points to "${slot.prog}", which is not one of the programs (${names.map((n) => `"${n}"`).join(", ")}).`);
      }
    });
    if (cycle.sched === "day_of_week") {
      const days = cycle.slots.map((s) => s.day);
      if (days.some((d) => d === null)) issues.push(`cycle uses sched "day_of_week", so every slot needs "day" (1=Mon … 7=Sun).`);
      const set = new Set(days.filter((d) => d !== null));
      if (set.size !== days.filter((d) => d !== null).length) issues.push("cycle has two slots on the same day; use one slot per day.");
      if (constraints.daysPerWeek && cycle.slots.length !== constraints.daysPerWeek) {
        issues.push(`The athlete trains ${constraints.daysPerWeek} days per week, but the cycle has ${cycle.slots.length} slots. Use exactly ${constraints.daysPerWeek}.`);
      }
    } else if (cycle.slots.some((s) => s.idx === null)) {
      issues.push(`cycle uses sched "rotation", so every slot needs "idx" (1, 2, 3 …).`);
    }
    if (constraints.cycleDurationWeeks && cycle.weeks !== constraints.cycleDurationWeeks) {
      issues.push(`The athlete asked for a ${constraints.cycleDurationWeeks}-week cycle, but "weeks" is ${cycle.weeks}.`);
    }
  } else if (constraints.daysPerWeek || constraints.cycleDurationWeeks) {
    issues.push("The athlete set a training frequency or cycle length, so include a \"cycle\" that schedules the programs.");
  }

  return issues;
}

export type PlanValidation =
  | { ok: true; plan: AiPlan }
  | { ok: false; issues: string[] };

/** Schema check, then the cross-field rules. Issues are model-readable. */
export function validatePlan(raw: unknown, constraints: AiPlanConstraints = {}): PlanValidation {
  if (raw === null || typeof raw !== "object") {
    return { ok: false, issues: ["The response was not a JSON object. Return one JSON object with \"programs\" and \"cycle\"."] };
  }
  const parsed = aiPlanSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 12).map((issue) => {
      const path = issue.path.map((p) => (typeof p === "number" ? `[${p}]` : `.${String(p)}`)).join("").replace(/^\./, "");
      return `${path || "root"}: ${issue.message}`;
    });
    return { ok: false, issues };
  }
  const issues = checkPlan(parsed.data, constraints);
  return issues.length > 0 ? { ok: false, issues } : { ok: true, plan: parsed.data };
}

/**
 * Snaps exercise names to the library, ignoring case and punctuation, so
 * "bench press" or "Pull Up" reuse the existing exercise instead of the import
 * creating a near-duplicate custom one. Unmatched names pass through.
 */
export function matchLibraryNames(plan: AiPlan, libraryNames: string[]): AiPlan {
  const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const byKey = new Map(libraryNames.map((n) => [key(n), n]));
  return {
    ...plan,
    programs: plan.programs.map((p) => ({
      ...p,
      exercises: p.exercises.map((e) => ({ ...e, name: byKey.get(key(e.name)) ?? e.name })),
    })),
  };
}

/**
 * Renames programs that clash with the athlete's existing ones ("Push" →
 * "Push 2"), slots included. Import links cycle slots to programs by name, so
 * a clash would wire the new cycle to the old program.
 */
export function uniqueProgramNames(plan: AiPlan, existingNames: string[]): AiPlan {
  const taken = new Set(existingNames.map((n) => n.toLowerCase()));
  const renames = new Map<string, string>();
  for (const program of plan.programs) {
    let name = program.name;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${program.name} ${n}`;
    taken.add(name.toLowerCase());
    renames.set(program.name.toLowerCase(), name);
  }
  return {
    programs: plan.programs.map((p) => ({ ...p, name: renames.get(p.name.toLowerCase())! })),
    cycle: plan.cycle && {
      ...plan.cycle,
      slots: plan.cycle.slots.map((s) => ({ ...s, prog: renames.get(s.prog.toLowerCase()) ?? s.prog })),
    },
  };
}

/** Converts a validated plan to the payload importProgram / importCycle take. */
export function toImportPayload(plan: AiPlan) {
  // Slots name programs case-insensitively in checkPlan; import matches exactly.
  const canonical = new Map(plan.programs.map((p) => [p.name.toLowerCase(), p.name]));
  return {
    version: 1,
    programs: plan.programs.map((program) => ({
      name: program.name,
      exercises: program.exercises.map((ex, idx) => ({
        idx,
        adv: ex.adv,
        ...(ex.hits !== null && { hits: ex.hits }),
        incKg: ex.incKg ?? 2.5,
        incReps: ex.incReps ?? 0,
        exercise: {
          name: ex.name,
          category: ex.category,
          area: ex.area,
          muscle: ex.muscle,
          equipment: ex.equipment,
          pattern: ex.pattern,
          type: ex.role,
        },
        sets: ex.sets.map((s, i) => ({
          n: i + 1,
          reps: s.reps,
          kg: s.kg,
          durSec: s.durSec,
          distM: s.distM,
          rest: s.rest,
          type: s.type,
          rir: s.rir,
          repMin: s.repMin,
          repMax: s.repMax,
        })),
      })),
    })),
    ...(plan.cycle && {
      cycle: {
        name: plan.cycle.name,
        weeks: plan.cycle.weeks,
        sched: plan.cycle.sched,
        slots: plan.cycle.slots.map((slot) => ({
          prog: canonical.get(slot.prog.toLowerCase()) ?? slot.prog,
          ...(plan.cycle!.sched === "day_of_week" ? { day: slot.day! } : { idx: slot.idx! }),
          ...(slot.label && { label: slot.label }),
          ...(slot.auto && { auto: true }),
        })),
      },
    }),
  };
}
