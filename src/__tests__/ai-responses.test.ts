/**
 * Real model responses recorded by scripts/ai-smoke.ts, replayed through the
 * parser and validators. Each fixture stores whether its response validated
 * when it was recorded; parsing must keep giving the same answer, so a change
 * to parsePlanText, validatePlan or checkEdit can't silently start rejecting
 * output real models produce (or accepting output they got wrong).
 */

import { checkEdit } from "@/lib/utils/ai-edit";
import { parsePlanText, validatePlan } from "@/lib/utils/ai-plan";
import { buildTemplatePlan, stripWeights, type TemplateParams } from "@/lib/utils/plan-templates";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

type Fixture = {
  model: string;
  kind: "edit" | "repair";
  mode: string;
  valid: boolean;
  issues: string[];
  picks: TemplateParams;
  text: string;
};

const DIR = join(__dirname, "fixtures", "ai-responses");
const fixtures = readdirSync(DIR)
  .filter((f) => f.endsWith(".json"))
  .map((file) => ({ file, ...(JSON.parse(readFileSync(join(DIR, file), "utf8")) as Fixture) }));

describe("recorded model responses", () => {
  it("include at least one valid edit and one valid repair", () => {
    expect(fixtures.some((f) => f.kind === "edit" && f.valid)).toBe(true);
    expect(fixtures.some((f) => f.kind === "repair" && f.valid)).toBe(true);
  });

  it.each(fixtures.map((f) => [f.file, f] as const))("%s validates as recorded", (_, fixture) => {
    const result = validatePlan(parsePlanText(fixture.text), {
      daysPerWeek: fixture.picks.daysPerWeek,
      cycleDurationWeeks: fixture.picks.weeks,
    });
    const issues = result.ok ? checkEdit(result.plan, fixture.picks) : result.issues;
    expect(issues.length === 0).toBe(fixture.valid);
  });

  // scripts/ai-smoke.ts asks for a cardio finisher and forces a repair of an extra training day.
  it.each(fixtures.filter((f) => f.valid).map((f) => [f.file, f] as const))("%s made exactly the change asked for", (_, fixture) => {
    const base = stripWeights(buildTemplatePlan(fixture.picks, { bodyWeightKg: 80, sex: null, lifts: {} }));
    const result = validatePlan(parsePlanText(fixture.text), { daysPerWeek: fixture.picks.daysPerWeek, cycleDurationWeeks: fixture.picks.weeks });
    if (!result.ok) throw new Error(result.issues[0]);
    result.plan.programs.forEach((program, i) => {
      const before = base.programs[i].exercises.map((e) => e.name);
      const after = program.exercises.map((e) => e.name);
      if (fixture.kind === "repair") {
        expect(after).toEqual(before);
      } else {
        // The finisher goes last. A full session (at the exercise cap or the
        // time limit) may give up one exercise to make room, nothing else.
        const kept = after.slice(0, -1);
        expect(before.filter((name) => kept.includes(name))).toEqual(kept);
        expect(kept.length).toBeGreaterThanOrEqual(before.length - 1);
        expect(program.exercises.at(-1)!.sets[0].durSec).toBeGreaterThanOrEqual(300);
      }
    });
    expect(result.plan.cycle!.slots).toHaveLength(fixture.picks.daysPerWeek);
  });
});
