import { sharedSuggestionSets, suggestionPending } from "@/lib/utils/suggestion-chip";
import type { SetSuggestion } from "@/types/workout";
import { describe, expect, it } from "vitest";

const s = (o: Partial<SetSuggestion> = {}) =>
  ({ reason: "progressed", suggestedWeightKg: 82.5, ...o }) as SetSuggestion;
const set = (o: Partial<{ weightKg: string; targetReps: number; durationSeconds: number; distanceMeters: number }> = {}) => ({
  weightKg: "80.00",
  targetReps: 8,
  durationSeconds: null,
  distanceMeters: null,
  ...o,
});

describe("suggestionPending", () => {
  it("is pending until the set carries the suggested weight", () => {
    expect(suggestionPending(s(), set())).toBe(true);
    expect(suggestionPending(s(), set({ weightKg: "82.50" }))).toBe(false);
  });

  it("keeps a reset pending while either half is untaken", () => {
    const reset = s({ reason: "reset", suggestedReps: 6 });
    expect(suggestionPending(reset, set({ weightKg: "82.50" }))).toBe(true);
    expect(suggestionPending(reset, set({ weightKg: "82.50", targetReps: 6 }))).toBe(false);
  });

  it("never treats a hold as something to apply", () => {
    expect(suggestionPending(s({ reason: "held" }), set())).toBe(false);
  });
});

describe("sharedSuggestionSets", () => {
  it("groups two or more sets proposing the same move", () => {
    expect(sharedSuggestionSets([1, 2, 3], { 1: s(), 2: s(), 3: s() })).toEqual([1, 2, 3]);
  });

  it("does not group a single set, or sets that disagree", () => {
    expect(sharedSuggestionSets([1], { 1: s() })).toBeNull();
    expect(sharedSuggestionSets([1, 2], { 1: s(), 2: s({ suggestedWeightKg: 85 }) })).toBeNull();
  });

  it("does not group reasons that render no chip", () => {
    const held = s({ reason: "held" });
    expect(sharedSuggestionSets([1, 2], { 1: held, 2: held })).toBeNull();
  });

  it("ignores sets without a suggestion, such as warm-ups", () => {
    expect(sharedSuggestionSets([10, 1, 2], { 1: s(), 2: s() })).toEqual([1, 2]);
  });
});
