import { describe, expect, it } from "vitest";
import { buildAiSystemPrompt } from "@/lib/utils/ai-prompt";

const profile = {
  gender: null,
  birthYear: null,
  heightCm: null,
  weightKg: null,
  goals: ["strength"],
  experienceLevel: "intermediate",
};

describe("buildAiSystemPrompt — exercise type", () => {
  it("serializes the exercise type into the library list", () => {
    const out = buildAiSystemPrompt(profile, [
      { name: "Bench Press", muscleGroup: "chest", equipment: "barbell", movementPattern: "push", exerciseType: "compound" },
      { name: "Bicep Curl", muscleGroup: "biceps", equipment: "dumbbell", movementPattern: "pull", exerciseType: "isolation" },
    ]);
    expect(out).toContain("- Bench Press (chest, barbell, push, compound)");
    expect(out).toContain("- Bicep Curl (biceps, dumbbell, pull, isolation)");
  });

  it("omits the type when an exercise has none (no trailing separator)", () => {
    const out = buildAiSystemPrompt(profile, [
      { name: "Plank", muscleGroup: "abs", equipment: "bodyweight", movementPattern: "isometric" },
    ]);
    expect(out).toContain("- Plank (abs, bodyweight, isometric)");
  });

  it("documents the type field and its allowed values for the model", () => {
    const out = buildAiSystemPrompt(profile, []);
    // The output schema rule lists each allowed value
    for (const v of ["compound", "isolation", "accessory", "plyometric", "isometric"]) {
      expect(out).toContain(`"${v}"`);
    }
    // The ordering rule references the explicit type field
    expect(out.toLowerCase()).toContain("compound");
  });
});

describe("buildAiSystemPrompt — the progression axes", () => {
  const prompt = () => buildAiSystemPrompt(profile, []);

  it("describes the axes rather than the retired modes", () => {
    // SI-D8: the prompt offered manual/weight/smart/reps, so a generated plan
    // could never ask for a rep range, a duration or a distance scheme, and
    // every one of them silently took the defaults.
    const text = prompt();
    expect(text).toContain('"adv"');
    expect(text).not.toContain('"smart"');
    for (const advance of ["load", "double", "reps", "duration", "distance"]) {
      expect(text).toContain(`"${advance}"`);
    }
  });

  it("tells the model a rep range is required for double progression", () => {
    // Without both bounds the scheme has nothing to climb inside and quietly
    // behaves as plain load progression.
    const text = prompt();
    expect(text).toContain("repMin");
    expect(text).toContain("repMax");
  });

  it("says what an effort cap costs before offering it", () => {
    // A cap stalls the exercise until effort is logged. A model handing them
    // out freely would generate plans that look normal and never progress.
    expect(prompt()).toMatch(/rir[\s\S]*will NOT count/i);
  });
});
