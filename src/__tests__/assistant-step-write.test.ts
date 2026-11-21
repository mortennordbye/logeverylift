import { assistantStepWrite, type StoredStep } from "@/lib/utils/step-results";
import { describe, expect, it } from "vitest";

/** An assistant write over a treadmill run's logged step (docs/plans/run-logger.md, step 5). */
const stored = (over: Partial<StoredStep> = {}): StoredStep => ({
  durationSeconds: 600,
  distanceMeters: 1500,
  avgSpeed: 2.5,
  inclinePercent: 1,
  rpe: null,
  notes: null,
  stepStatus: "done",
  isCompleted: true,
  sources: { durationSeconds: "clock", distanceMeters: "belt", avgSpeed: "belt" },
  ...over,
});

describe("assistantStepWrite: a treadmill step's incline", () => {
  it("keeps the belt's incline when the runner typed the distance", () => {
    const w = assistantStepWrite(stored({ sources: { durationSeconds: "clock", distanceMeters: "typed", avgSpeed: "belt" } }), { stepStatus: "done", inclinePercent: 3 });
    expect(w.set).not.toHaveProperty("inclinePercent");
    expect(w.kept).toContainEqual({ field: "inclinePercent", by: "belt" });
  });

  it("keeps the belt's incline when the distance and speed are both typed", () => {
    const w = assistantStepWrite(stored({ sources: { durationSeconds: "clock", distanceMeters: "typed", avgSpeed: "typed" } }), { stepStatus: "done", inclinePercent: 3 });
    expect(w.set).not.toHaveProperty("inclinePercent");
  });

  it("fills an empty incline and changes its own, marked as the assistant's", () => {
    const empty = assistantStepWrite(stored({ inclinePercent: null }), { stepStatus: "done", inclinePercent: 2 });
    expect(empty.set).toMatchObject({ inclinePercent: 2, sources: { inclinePercent: "assistant" } });
    const own = assistantStepWrite(stored({ inclinePercent: 2, sources: { durationSeconds: "clock", inclinePercent: "assistant" } }), { stepStatus: "done", inclinePercent: 3 });
    expect(own.set).toMatchObject({ inclinePercent: 3 });
    expect(own.kept).toEqual([]);
  });
});
