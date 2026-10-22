import { shouldShowSharePrompt } from "@/lib/utils/share-prompt";
import { describe, expect, it } from "vitest";

const now = new Date("2026-10-22T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
const base = { completedCount: 5, lastPromptAt: null, tutorialDone: true, now };

describe("shouldShowSharePrompt", () => {
  it("asks once the user has five workouts and has never been asked", () => {
    expect(shouldShowSharePrompt(base)).toBe(true);
  });

  it("waits for the fifth workout", () => {
    expect(shouldShowSharePrompt({ ...base, completedCount: 4 })).toBe(false);
  });

  it("never asks before the tutorial is done", () => {
    expect(shouldShowSharePrompt({ ...base, completedCount: 50, tutorialDone: false })).toBe(false);
  });

  it("stays quiet for 60 days after the last ask, then asks again", () => {
    expect(shouldShowSharePrompt({ ...base, lastPromptAt: daysAgo(59) })).toBe(false);
    expect(shouldShowSharePrompt({ ...base, lastPromptAt: daysAgo(60) })).toBe(true);
  });
});
