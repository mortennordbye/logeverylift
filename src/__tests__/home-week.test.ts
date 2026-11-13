import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The home week strip's dated sessions (docs/plans/sessions.md, review 5 and 7):
 * a failed read falls back to the template instead of breaking the page, and a
 * declined day keeps its program dot.
 */

// A plain function, not vi.fn: a vi.fn that rejects is reported by Vitest as
// an unhandled error even when the code under test catches it.
const state = vi.hoisted(() => ({ fail: false }));
vi.mock("@/lib/planned-sessions", () => ({
  listPlanned: async () => {
    if (state.fail) throw new Error("deadlock");
    return [{ id: 1 }];
  },
}));

afterEach(() => {
  state.fail = false;
});

describe("homeWeekPlanned", () => {
  it("returns the week's sessions", async () => {
    const { homeWeekPlanned } = await import("@/lib/home-week");
    expect(await homeWeekPlanned("u", "2026-11-02", "2026-11-08", 3)).toEqual([{ id: 1 }]);
  });

  it("returns null and logs a tagged line when the read fails", async () => {
    state.fail = true;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { homeWeekPlanned } = await import("@/lib/home-week");
    expect(await homeWeekPlanned("u", "2026-11-02", "2026-11-08", 3)).toBeNull();
    expect(log).toHaveBeenCalledWith("[home] planned week failed", { cycleId: 3 }, "deadlock");
    log.mockRestore();
  });
});

describe("weekDayMarks", () => {
  it("keeps a declined day's program dot, and counts only sessions still planned", async () => {
    const { weekDayMarks } = await import("@/lib/utils/planned-sessions");
    expect(weekDayMarks({ planned: [{ status: "skipped" }], inBlock: true, templateHasProgram: true })).toEqual({ hasProgram: true, count: 0 });
    expect(weekDayMarks({ planned: [{ status: "planned" }, { status: "done" }, { status: "skipped" }], inBlock: true, templateHasProgram: false })).toEqual({
      hasProgram: true,
      count: 2,
    });
    // Outside the block, or when the read failed: the template, as before.
    expect(weekDayMarks({ planned: null, inBlock: true, templateHasProgram: true })).toEqual({ hasProgram: true, count: 0 });
    expect(weekDayMarks({ planned: [], inBlock: false, templateHasProgram: false })).toEqual({ hasProgram: false, count: 0 });
  });
});
