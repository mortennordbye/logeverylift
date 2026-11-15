import { answerSession } from "@/components/features/answer-session";
import { describe, expect, it } from "vitest";

describe("answerSession", () => {
  const base = { id: 4, date: "2026-11-12", label: null, programName: null, workout: null, workoutSummary: null, sport: "run" as const };

  it("carries the planned time, which Yes fills in (round 10)", () => {
    expect(answerSession({ ...base, planned: { durationSeconds: 3900, distanceMeters: null } }).plannedSeconds).toBe(3900);
    expect(answerSession({ ...base, planned: { durationSeconds: null, distanceMeters: 5000 } }).plannedSeconds).toBeNull();
  });
});
