import { describe, expect, it } from "vitest";
import { HONEST_REPS_FROM, isUnverifiedPr } from "@/lib/utils/pr-provenance";

describe("isUnverifiedPr", () => {
  const before = "2020-01-01T10:00:00.000Z";
  const after = "2099-01-01T10:00:00.000Z";

  it("flags the two record types derived from actual_reps", () => {
    expect(isUnverifiedPr("estimated_1rm", before)).toBe(true);
    expect(isUnverifiedPr("reps_at_weight", before)).toBe(true);
  });

  it("never flags a heaviest-weight record", () => {
    // The weight was on the bar either way; it was never assumption-based.
    expect(isUnverifiedPr("weight", before)).toBe(false);
  });

  it("never flags an endurance record", () => {
    expect(isUnverifiedPr("distance", before)).toBe(false);
    expect(isUnverifiedPr("pace", before)).toBe(false);
  });

  it("does not flag a record set once reps were being logged", () => {
    expect(isUnverifiedPr("estimated_1rm", after)).toBe(false);
  });

  it("treats the cutover day itself as verified", () => {
    expect(isUnverifiedPr("estimated_1rm", `${HONEST_REPS_FROM}T00:00:00.000Z`)).toBe(
      false,
    );
  });
});
