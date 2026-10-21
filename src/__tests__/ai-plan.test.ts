import { AI_EXAMPLES } from "@/lib/utils/ai-examples";
import {
  aiPlanJsonSchema,
  checkPlan,
  matchLibraryNames,
  parsePlanText,
  toImportPayload,
  validatePlan,
  type AiPlan,
} from "@/lib/utils/ai-plan";
import { buildGenerationInput, buildGenerationMessages, PLAN_TOOL_NAME } from "@/lib/utils/ai-prompt";
import {
  capabilitiesFromParameters,
  classifyHttpFailure,
  readChatCompletion,
  readGeminiResponse,
} from "@/lib/utils/llm-response";
import { importCycleSchema } from "@/lib/validators/training-cycles";
import { importProgramSchema } from "@/lib/validators/workout";
import { describe, expect, it } from "vitest";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const example = (i: number): AiPlan => clone(AI_EXAMPLES[i].output);
const constraintsOf = (i: number) => ({
  daysPerWeek: AI_EXAMPLES[i].input.constraints.daysPerWeek,
  cycleDurationWeeks: AI_EXAMPLES[i].input.constraints.cycleWeeks,
});

describe("worked examples", () => {
  it.each(AI_EXAMPLES.map((_, i) => i))("example %i passes its own validation", (i) => {
    const result = validatePlan(example(i), constraintsOf(i));
    expect(result.ok ? [] : result.issues).toEqual([]);
  });

  it.each(AI_EXAMPLES.map((_, i) => i))("example %i converts to a payload the importers accept", (i) => {
    const payload = toImportPayload(example(i));
    expect(importProgramSchema.safeParse(payload).success).toBe(true);
    expect(importCycleSchema.safeParse(payload.cycle).success).toBe(true);
  });
});

describe("aiPlanJsonSchema", () => {
  const schema = aiPlanJsonSchema();

  function walk(node: unknown, visit: (obj: Record<string, unknown>) => void) {
    if (Array.isArray(node)) node.forEach((n) => walk(n, visit));
    else if (node && typeof node === "object") {
      visit(node as Record<string, unknown>);
      Object.values(node).forEach((v) => walk(v, visit));
    }
  }

  it("is strict-mode compatible: every object requires all its keys and allows no others", () => {
    walk(schema, (obj) => {
      if (obj.type === "object" && obj.properties) {
        expect(obj.additionalProperties).toBe(false);
        expect([...(obj.required as string[])].sort()).toEqual(Object.keys(obj.properties as object).sort());
      }
    });
  });

  it("drops keywords providers reject", () => {
    walk(schema, (obj) => {
      for (const key of ["$schema", "minimum", "maximum", "minItems", "maxItems", "minLength", "maxLength", "default"]) {
        expect(obj).not.toHaveProperty(key);
      }
    });
  });

  it("states the allowed cycle lengths as an enum", () => {
    const cycle = (schema.properties as Record<string, { anyOf: Record<string, unknown>[] }>).cycle;
    const object = cycle.anyOf.find((b) => b.type === "object") as { properties: { weeks: unknown } };
    expect(object.properties.weeks).toEqual({ type: "integer", enum: [4, 6, 8, 10, 12, 16] });
  });
});

describe("parsePlanText", () => {
  const plan = { programs: [], cycle: null };

  it("reads bare JSON", () => {
    expect(parsePlanText(JSON.stringify(plan))).toEqual(plan);
  });

  it("strips reasoning blocks, code fences and prose", () => {
    const raw = `<think>Let me plan this…{not json}</think>Sure! Here it is:\n\`\`\`json\n${JSON.stringify(plan)}\n\`\`\`\nEnjoy.`;
    expect(parsePlanText(raw)).toEqual(plan);
  });

  it("takes the outermost object out of surrounding text", () => {
    expect(parsePlanText(`Plan: ${JSON.stringify(plan)} (done)`)).toEqual(plan);
  });

  it("unwraps envelopes, including a stringified arguments field", () => {
    expect(parsePlanText(JSON.stringify({ plan }))).toEqual(plan);
    expect(parsePlanText(JSON.stringify({ arguments: JSON.stringify(plan) }))).toEqual(plan);
    expect(parsePlanText(JSON.stringify([plan]))).toEqual(plan);
  });

  it("drops reasoning that ends in a lone closing tag", () => {
    const raw = `The athlete wants {strength}. I'll use {"draft": 1} first.</think>\n${JSON.stringify(plan)}`;
    expect(parsePlanText(raw)).toEqual(plan);
  });

  it("picks the plan among several objects in the text", () => {
    const raw = `Example: {"name": "x"} and the answer {"programs": [], "cycle": null} plus {"note": "}"}`;
    expect(parsePlanText(raw)).toEqual(plan);
  });

  it("tolerates trailing commas and line comments", () => {
    const raw = `{\n  "programs": [], // none yet\n  "cycle": null,\n}`;
    expect(parsePlanText(raw)).toEqual(plan);
  });

  it("keeps // and commas that are inside strings", () => {
    expect(parsePlanText('{"programs": [], "cycle": null, "url": "http://x,}"}')).toEqual({ ...plan, url: "http://x,}" });
  });

  it("returns null when nothing parses", () => {
    expect(parsePlanText("I can't help with that.")).toBeNull();
  });
});

describe("validatePlan leniency", () => {
  it("accepts numeric strings, loose enum casing and omitted nullable keys", () => {
    const raw = {
      programs: [
        {
          name: "Day",
          exercises: [
            {
              name: "Squat", category: "Strength", area: "Lower Body", muscle: "quads", equipment: "barbell",
              pattern: "squat", role: "compound", adv: "load",
              sets: [{ reps: "5", kg: "60", rest: "120" }],
            },
          ],
        },
      ],
    };
    const result = validatePlan(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ex = result.plan.programs[0].exercises[0];
    expect(ex.area).toBe("lower_body");
    expect(ex.sets[0]).toMatchObject({ type: "working", reps: 5, kg: 60, rest: 120, repMin: null, rir: null });
    expect(result.plan.cycle).toBeNull();
  });

  it("reports schema problems with a readable path", () => {
    const plan = example(0);
    (plan.programs[0].exercises[0] as { muscle: string }).muscle = "pecs";
    const result = validatePlan(plan, constraintsOf(0));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]).toMatch(/^programs\[0\]\.exercises\[0\]\.muscle:/);
  });

  it("rejects a non-object", () => {
    expect(validatePlan(null).ok).toBe(false);
  });
});

describe("checkPlan", () => {
  it("flags a cycle slot that names no program", () => {
    const plan = example(0);
    plan.cycle!.slots[0].prog = "Full Body C";
    expect(checkPlan(plan).join()).toContain('"Full Body C", which is not one of the programs');
  });

  it("matches slot names to programs case-insensitively", () => {
    const plan = example(0);
    plan.cycle!.slots[0].prog = "full body a";
    expect(checkPlan(plan, constraintsOf(0))).toEqual([]);
    expect(toImportPayload(plan).cycle!.slots[0].prog).toBe("Full Body A");
  });

  it("requires a rep range on every working set of a double-progression exercise", () => {
    const plan = example(1);
    plan.programs[0].exercises[0].sets[1].repMax = null;
    expect(checkPlan(plan).join()).toContain('uses adv "double", which needs repMin and repMax');
  });

  it("flags an inverted rep range and a set with no target", () => {
    const plan = example(1);
    Object.assign(plan.programs[0].exercises[0].sets[0], { repMin: 12, repMax: 8 });
    plan.programs[0].exercises[3].sets[0].reps = null;
    const issues = checkPlan(plan).join();
    expect(issues).toContain("repMin (12) is above repMax (8)");
    expect(issues).toContain("has no target");
  });

  it("holds the cycle to the requested frequency and length", () => {
    const plan = example(0);
    const issues = checkPlan(plan, { daysPerWeek: 4, cycleDurationWeeks: 12 }).join();
    expect(issues).toContain("trains 4 days per week, but the cycle has 3 slots");
    expect(issues).toContain('asked for a 12-week cycle, but "weeks" is 8');
  });

  it("requires day on weekday slots, unique days, and idx on rotation slots", () => {
    const weekly = example(0);
    weekly.cycle!.slots[1].day = 1;
    expect(checkPlan(weekly).join()).toContain("two slots on the same day");
    weekly.cycle!.slots[2].day = null;
    expect(checkPlan(weekly).join()).toContain('every slot needs "day"');

    const rotation = example(1);
    rotation.cycle!.slots[0].idx = null;
    expect(checkPlan(rotation).join()).toContain('every slot needs "idx"');
  });

  it("requires a cycle when the athlete set a frequency", () => {
    const plan = example(0);
    plan.cycle = null;
    expect(checkPlan(plan, { daysPerWeek: 3 }).join()).toContain('include a "cycle"');
    expect(checkPlan(plan)).toEqual([]);
  });
});

describe("matchLibraryNames", () => {
  it("snaps near-miss names to the library and leaves new exercises alone", () => {
    const plan = example(0);
    plan.programs[0].exercises[0].name = "squat";
    plan.programs[0].exercises[1].name = "Bench-Press";
    plan.programs[0].exercises[2].name = "Pendlay Row";
    const out = matchLibraryNames(plan, ["Squat", "Bench Press", "Barbell Row"]);
    expect(out.programs[0].exercises.map((e) => e.name).slice(0, 3)).toEqual(["Squat", "Bench Press", "Pendlay Row"]);
  });
});

describe("buildGenerationMessages", () => {
  const input = buildGenerationInput(
    "Get stronger",
    { gender: null, birthYear: null, heightCm: null, weightKg: 90, goals: ["strength"], experienceLevel: "advanced" },
    [{ name: "Squat", muscleGroup: "quads", equipment: "barbell", movementPattern: "squat", exerciseType: "compound" }],
    [{ exerciseName: "Squat", estimated1rm: 180 }],
    ["Old Program"],
    { daysPerWeek: 4, equipment: "full_gym", cycleDurationWeeks: 12 },
  );

  it("sends the request as structured JSON after one turn pair per example", () => {
    const messages = buildGenerationMessages(input, { daysPerWeek: 4 }, aiPlanJsonSchema(), "json");
    expect(messages.map((m) => m.role)).toEqual(["system", ...AI_EXAMPLES.flatMap(() => ["user", "assistant"]), "user"]);
    const last = messages.at(-1)!.content;
    const json = JSON.parse(last.slice(last.indexOf("{")));
    expect(json).toMatchObject({
      request: "Get stronger",
      athlete: { experience: "advanced", goals: ["strength"], bodyWeightKg: 90 },
      constraints: { daysPerWeek: 4, equipment: "full_gym", cycleWeeks: 12 },
      currentLifts: [{ exercise: "Squat", e1rmKg: 180 }],
      existingPrograms: ["Old Program"],
      exerciseLibrary: ["Squat (quads, barbell, squat, compound)"],
    });
  });

  it("states the frequency constraint and the delivery in the system prompt", () => {
    const json = buildGenerationMessages(input, { daysPerWeek: 4 }, aiPlanJsonSchema(), "json")[0].content;
    const tool = buildGenerationMessages(input, { daysPerWeek: 4 }, aiPlanJsonSchema(), "tool")[0].content;
    expect(json).toContain("EXACTLY 4 training days per week");
    expect(json).toContain("Reply with exactly one JSON object");
    expect(tool).toContain(`Call the "${PLAN_TOOL_NAME}" tool`);
  });
});

describe("llm response helpers", () => {
  it("orders output modes best first from OpenRouter parameters", () => {
    expect(capabilitiesFromParameters(["structured_outputs", "response_format", "tools", "tool_choice"]).modes)
      .toEqual(["json_schema", "tool", "json_object", "text"]);
    const toolsOnly = capabilitiesFromParameters(["tools"]);
    expect(toolsOnly.modes).toEqual(["tool", "text"]);
    expect(toolsOnly.forceTool).toBe(false);
    expect(capabilitiesFromParameters([]).modes).toEqual(["text"]);
  });

  it("reads tool-call arguments before content", () => {
    const data = { choices: [{ finish_reason: "tool_calls", message: { content: "", tool_calls: [{ function: { arguments: '{"a":1}' } }] } }] };
    expect(readChatCompletion(data)).toEqual({ text: '{"a":1}', truncated: false, error: null });
  });

  it("joins content parts and notices truncation", () => {
    const data = { choices: [{ finish_reason: "length", message: { content: [{ type: "text", text: "{\"a\"" }, { type: "text", text: ":1" }] } }] };
    expect(readChatCompletion(data)).toEqual({ text: '{"a":1', truncated: true, error: null });
  });

  it("surfaces provider errors returned with HTTP 200", () => {
    expect(readChatCompletion({ error: { message: "Provider returned error" } }).error).toBe("Provider returned error");
    expect(readChatCompletion({ choices: [{ message: { content: "" } }] }).text).toBeNull();
  });

  it("skips Gemini thought parts", () => {
    const data = { candidates: [{ finishReason: "STOP", content: { parts: [{ text: "thinking…", thought: true }, { text: "{}" }] } }] };
    expect(readGeminiResponse(data)).toEqual({ text: "{}", truncated: false, error: null });
  });

  it("downgrades only when a structured mode is rejected, moves on otherwise", () => {
    expect(classifyHttpFailure(400, "json_schema")).toBe("unsupported");
    expect(classifyHttpFailure(404, "tool", "No endpoints found that support tool use")).toBe("unsupported");
    // A broken upstream provider is not a capability problem.
    expect(classifyHttpFailure(404, "json_schema", '{"error":{"message":"Provider returned error"}}')).toBe("unavailable");
    expect(classifyHttpFailure(400, "text")).toBe("unavailable");
    expect(classifyHttpFailure(429, "json_schema")).toBe("rate_limited");
    expect(classifyHttpFailure(503, "json_object")).toBe("unavailable");
  });
});
