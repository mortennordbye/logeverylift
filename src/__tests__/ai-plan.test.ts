import { genericProfile } from "@/lib/utils/ai-edit";
import { AI_EDIT_EXAMPLES } from "@/lib/utils/ai-examples";
import {
  aiPlanJsonSchema,
  checkPlan,
  matchLibraryNames,
  parsePlanText,
  toImportPayload,
  validatePlan,
  type AiPlan,
} from "@/lib/utils/ai-plan";
import { buildEditInput, buildEditMessages, PLAN_TOOL_NAME } from "@/lib/utils/ai-prompt";
import { buildTemplatePlan, fillStartingWeights, stripWeights } from "@/lib/utils/plan-templates";
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
const example = (i: number): AiPlan => clone(AI_EDIT_EXAMPLES[i].output);
const constraintsOf = (i: number) => ({
  daysPerWeek: AI_EDIT_EXAMPLES[i].input.picks.daysPerWeek,
  cycleDurationWeeks: AI_EDIT_EXAMPLES[i].input.picks.cycleWeeks,
});
const exerciseNames = (plan: AiPlan) => plan.programs.map((p) => p.exercises.map((e) => e.name));

describe("worked examples", () => {
  it.each(AI_EDIT_EXAMPLES.map((_, i) => [i]))("example %i passes its own validation", (i) => {
    const result = validatePlan(example(i), constraintsOf(i));
    expect(result.ok ? [] : result.issues).toEqual([]);
  });

  it.each(AI_EDIT_EXAMPLES.map((_, i) => [i]))("example %i converts to a payload the importers accept once weights are set", (i) => {
    const filled = fillStartingWeights(example(i), "beginner", { bodyWeightKg: 80, sex: "male", lifts: {} });
    const payload = toImportPayload(filled);
    expect(importProgramSchema.safeParse(payload).success).toBe(true);
    expect(importCycleSchema.safeParse(payload.cycle).success).toBe(true);
  });

  it.each(AI_EDIT_EXAMPLES.map((_, i) => [i]))("example %i leaves every load null for the app to fill", (i) => {
    for (const ex of example(i).programs.flatMap((p) => p.exercises)) {
      const loaded = ex.equipment !== "bodyweight" && ex.equipment !== "bands";
      for (const set of ex.sets) expect(set.kg).toBe(loaded ? null : 0);
    }
  });

  it("the swap example changes one exercise and nothing else", () => {
    const { input, output } = AI_EDIT_EXAMPLES[0];
    const before = exerciseNames(input.plan).flat();
    const after = exerciseNames(output).flat();
    expect(after.filter((name, i) => name !== before[i])).toEqual(["Seated Cable Row"]);
    expect(output.cycle).toEqual(input.plan.cycle);
  });

  it("the finisher example adds one exercise to the end of each session", () => {
    const { input, output } = AI_EDIT_EXAMPLES[1];
    output.programs.forEach((program, i) => {
      expect(program.exercises.slice(0, -1)).toEqual(input.plan.programs[i].exercises);
      expect(program.exercises.at(-1)!.name).toBe("Burpee");
    });
  });
});

// Plans for the contract tests: a 3-day full body (Mon/Wed/Fri, 8 weeks) and
// an upper/lower with rep ranges, both straight from the template builder.
const testAthlete = { bodyWeightKg: 80, sex: "male", lifts: {} };
const weekly = (): AiPlan =>
  clone(buildTemplatePlan({ goal: "general_fitness", level: "beginner", daysPerWeek: 3, equipment: "full_gym", weeks: 8 }, testAthlete));
const ranged = (): AiPlan =>
  clone(buildTemplatePlan({ goal: "muscle_gain", level: "intermediate", daysPerWeek: 4, equipment: "full_gym", weeks: 8 }, testAthlete));
const weeklyConstraints = { daysPerWeek: 3, cycleDurationWeeks: 8 as const };

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
    const plan = weekly();
    (plan.programs[0].exercises[0] as { muscle: string }).muscle = "pecs";
    const result = validatePlan(plan, weeklyConstraints);
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
    const plan = weekly();
    plan.cycle!.slots[0].prog = "Full Body C";
    expect(checkPlan(plan).join()).toContain('"Full Body C", which is not one of the programs');
  });

  it("matches slot names to programs case-insensitively", () => {
    const plan = weekly();
    plan.cycle!.slots[0].prog = "full body a";
    expect(checkPlan(plan, weeklyConstraints)).toEqual([]);
    expect(toImportPayload(plan).cycle!.slots[0].prog).toBe("Full Body A");
  });

  it("requires a rep range on every working set of a double-progression exercise", () => {
    const plan = ranged();
    plan.programs[0].exercises[0].sets[2].repMax = null;
    expect(checkPlan(plan).join()).toContain('uses adv "double", which needs repMin and repMax');
  });

  it("flags an inverted rep range and a set with no target", () => {
    const plan = ranged();
    Object.assign(plan.programs[0].exercises[0].sets[1], { repMin: 12, repMax: 8 });
    plan.programs[0].exercises[3].sets[0].reps = null;
    const issues = checkPlan(plan).join();
    expect(issues).toContain("repMin (12) is above repMax (8)");
    expect(issues).toContain("has no target");
  });

  it("holds the cycle to the requested frequency and length", () => {
    const plan = weekly();
    const issues = checkPlan(plan, { daysPerWeek: 4, cycleDurationWeeks: 12 }).join();
    expect(issues).toContain("trains 4 days per week, but the cycle has 3 slots");
    expect(issues).toContain('asked for a 12-week cycle, but "weeks" is 8');
  });

  it("requires day on weekday slots, unique days, and idx on rotation slots", () => {
    const plan = weekly();
    plan.cycle!.slots[1].day = 1;
    expect(checkPlan(plan).join()).toContain("two slots on the same day");
    plan.cycle!.slots[2].day = null;
    expect(checkPlan(plan).join()).toContain('every slot needs "day"');

    const rotation = weekly();
    rotation.cycle!.sched = "rotation";
    rotation.cycle!.slots.forEach((slot, i) => Object.assign(slot, { day: null, idx: i + 1 }));
    expect(checkPlan(rotation)).toEqual([]);
    rotation.cycle!.slots[0].idx = null;
    expect(checkPlan(rotation).join()).toContain('every slot needs "idx"');
  });

  it("requires a cycle when the athlete set a frequency", () => {
    const plan = weekly();
    plan.cycle = null;
    expect(checkPlan(plan, { daysPerWeek: 3 }).join()).toContain('include a "cycle"');
    expect(checkPlan(plan)).toEqual([]);
  });
});

describe("matchLibraryNames", () => {
  it("snaps near-miss names to the library and leaves new exercises alone", () => {
    const plan = weekly();
    plan.programs[0].exercises[0].name = "squat";
    plan.programs[0].exercises[1].name = "Bench-Press";
    plan.programs[0].exercises[2].name = "Pendlay Row";
    const out = matchLibraryNames(plan, ["Squat", "Bench Press", "Barbell Row"]);
    expect(out.programs[0].exercises.map((e) => e.name).slice(0, 3)).toEqual(["Squat", "Bench Press", "Pendlay Row"]);
  });
});

describe("buildEditMessages", () => {
  const picks = { goal: "strength", level: "advanced", daysPerWeek: 4, equipment: "dumbbells", weeks: 12, avoid: ["knees"] } as const;
  const profile = genericProfile(
    { birthYear: 1990, gender: "female", goals: ["strength"], experienceLevel: "advanced" },
    2026,
  );
  const plan = stripWeights(buildTemplatePlan({ ...picks, avoid: [...picks.avoid] }, { bodyWeightKg: 90, sex: "female", lifts: { "Goblet Squat": 120 } }));
  const input = buildEditInput(
    profile,
    { ...picks, avoid: [...picks.avoid] },
    { chips: ["cardio_finisher"], text: "" },
    [
      { name: "Squat", muscleGroup: "quads", equipment: "barbell", movementPattern: "squat", exerciseType: "compound" },
      { name: "Goblet Squat", muscleGroup: "quads", equipment: "dumbbell", movementPattern: "squat", exerciseType: "compound" },
      { name: "Burpee", muscleGroup: "full_body", equipment: "bodyweight", movementPattern: "push", exerciseType: "plyometric" },
    ],
    plan,
  );

  it("sends the request as structured JSON after one turn pair per example", () => {
    const messages = buildEditMessages(input, aiPlanJsonSchema(), "json");
    expect(messages.map((m) => m.role)).toEqual(["system", ...AI_EDIT_EXAMPLES.flatMap(() => ["user", "assistant"]), "user"]);
    const last = messages.at(-1)!.content;
    const json = JSON.parse(last.slice(last.indexOf("{")));
    expect(json).toMatchObject({
      athlete: { ageBand: "35_44", gender: "female", goals: ["strength"], experience: "advanced" },
      picks: { daysPerWeek: 4, equipment: "dumbbells", cycleWeeks: 12, sessionMinutes: null, avoidJoints: ["knees"] },
      request: ["Add a short cardio finisher (5 to 10 minutes) as the last exercise of each session."],
      allowedExercises: ["Goblet Squat (quads, dumbbell, squat, compound)", "Burpee (full_body, bodyweight, push, plyometric)"],
    });
    expect(json.plan).toEqual(plan);
  });

  it("sends no birth year, body weight or lift numbers", () => {
    const text = buildEditMessages(input, aiPlanJsonSchema(), "json").at(-1)!.content;
    expect(text).not.toMatch(/1990|birthYear|weightKg|bodyWeightKg|e1rm|estimated1rm|"kg":\s*[1-9]/);
  });

  it("states the delivery in the system prompt", () => {
    const json = buildEditMessages(input, aiPlanJsonSchema(), "json")[0].content;
    const tool = buildEditMessages(input, aiPlanJsonSchema(), "tool")[0].content;
    expect(json).toContain("Reply with exactly one JSON object");
    expect(json).toContain("Change only what the request asks for");
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
