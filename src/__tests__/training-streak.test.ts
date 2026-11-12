import { computeStreakWeeks } from "@/lib/utils/training-streak";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The week starts come from Postgres date_trunc('week', startTime)::date, which
// works on the UTC timestamps. The streak must count the same weeks whatever
// the server's own zone is: in a zone east of UTC, local-time date math with
// toISOString shifted every step a day back, and after local midnight on a
// Monday "this week" became the Sunday before.
const ZONES = ["UTC", "Europe/Oslo", "Pacific/Auckland", "America/Los_Angeles"];
const savedTz = process.env.TZ;

describe.each(ZONES)("computeStreakWeeks with the server in %s", (zone) => {
  beforeAll(() => {
    process.env.TZ = zone;
  });
  afterAll(() => {
    process.env.TZ = savedTz;
  });

  // Wednesday 2026-11-11, midday UTC.
  const wednesday = new Date("2026-11-11T12:00:00Z");

  it("counts consecutive weeks back from this week", () => {
    expect(computeStreakWeeks(["2026-11-09", "2026-11-02", "2026-10-26"], wednesday)).toBe(3);
  });

  it("starts from last week when this week has no workout yet", () => {
    expect(computeStreakWeeks(["2026-11-02", "2026-10-26"], wednesday)).toBe(2);
  });

  it("stops at a gap", () => {
    expect(computeStreakWeeks(["2026-11-09", "2026-10-26"], wednesday)).toBe(1);
  });

  it("is 0 with nothing this or last week", () => {
    expect(computeStreakWeeks(["2026-10-26"], wednesday)).toBe(0);
    expect(computeStreakWeeks([], wednesday)).toBe(0);
  });

  it("puts the first minutes of a UTC Monday in the new week", () => {
    expect(computeStreakWeeks(["2026-11-09", "2026-11-02"], new Date("2026-11-09T00:30:00Z"))).toBe(2);
  });

  it("keeps the last minutes of a UTC Sunday in the old week", () => {
    expect(computeStreakWeeks(["2026-11-02", "2026-10-26"], new Date("2026-11-08T23:30:00Z"))).toBe(2);
  });
});
