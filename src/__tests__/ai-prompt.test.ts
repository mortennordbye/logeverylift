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
