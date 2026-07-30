import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  consumeHistoryNav,
  consumeProgrammaticBack,
  markProgrammaticBack,
  resetNavIntent,
} from "@/lib/utils/nav-intent";
import {
  getDepth,
  getDirection,
  resolveDirection,
} from "@/lib/utils/page-transition";

describe("getDepth", () => {
  it("counts path segments, ignoring leading and trailing slashes", () => {
    expect(getDepth("/")).toBe(0);
    expect(getDepth("/history")).toBe(1);
    expect(getDepth("/programs/4/workout")).toBe(3);
    expect(getDepth("/programs/4/workout/exercises/9")).toBe(5);
    expect(getDepth("/programs/4/workout/")).toBe(3);
  });
});

describe("getDirection", () => {
  it("returns none when the path has not changed", () => {
    expect(getDirection("/programs/4/workout", "/programs/4/workout")).toBe("none");
  });

  it("does not animate between bottom-nav tabs", () => {
    expect(getDirection("/", "/cycles")).toBe("none");
    expect(getDirection("/cycles", "/more")).toBe("none");
    expect(getDirection("/more", "/")).toBe("none");
  });

  it("slides forward when going deeper", () => {
    expect(getDirection("/programs/4/workout", "/programs/4/workout/exercises/9")).toBe(
      "forward",
    );
    expect(getDirection("/history", "/history/12")).toBe("forward");
  });

  it("slides back when coming up a level", () => {
    expect(getDirection("/programs/4/workout/exercises/9", "/programs/4/workout")).toBe(
      "back",
    );
  });

  it("returns none for a sideways move at equal depth", () => {
    expect(
      getDirection(
        "/programs/4/workout/exercises/9",
        "/programs/4/workout/exercises/10",
      ),
    ).toBe("none");
  });
});

describe("resolveDirection", () => {
  const deep = "/programs/4/workout/exercises/9";
  const shallow = "/programs/4/workout";

  it("animates an in-app push", () => {
    expect(resolveDirection(shallow, deep, "push")).toBe("forward");
    expect(resolveDirection(deep, shallow, "push")).toBe("back");
  });

  it("stands down for a platform history navigation", () => {
    // The iOS edge swipe and the browser Back button both land here. The
    // system is already animating; a second slide is the bug being fixed.
    expect(resolveDirection(deep, shallow, "history")).toBe("none");
    expect(resolveDirection(shallow, deep, "history")).toBe("none");
  });

  it("keeps the animation for a back we initiated ourselves", () => {
    // Same popstate as a swipe, but no system gesture ran, so standing down
    // would leave the transition dead.
    expect(resolveDirection(deep, shallow, "programmatic-back")).toBe("back");
  });

  it("still refuses to animate a tab switch, whatever the source", () => {
    expect(resolveDirection("/", "/cycles", "push")).toBe("none");
    expect(resolveDirection("/", "/cycles", "programmatic-back")).toBe("none");
  });
});

describe("nav intent", () => {
  beforeEach(() => {
    vi.useRealTimers();
    resetNavIntent();
  });

  it("is false when nothing marked it", () => {
    expect(consumeProgrammaticBack()).toBe(false);
  });

  it("reports a marked back exactly once", () => {
    markProgrammaticBack();
    expect(consumeProgrammaticBack()).toBe(true);
    expect(consumeProgrammaticBack()).toBe(false);
  });

  it("expires so a marked call that never navigated cannot colour a later swipe", () => {
    vi.useFakeTimers();
    markProgrammaticBack();
    vi.advanceTimersByTime(1_500);
    expect(consumeProgrammaticBack()).toBe(false);
    vi.useRealTimers();
  });

  it("does not expire a mark that is consumed promptly", () => {
    vi.useFakeTimers();
    markProgrammaticBack();
    vi.advanceTimersByTime(200);
    expect(consumeProgrammaticBack()).toBe(true);
    vi.useRealTimers();
  });
});

describe("consumeHistoryNav", () => {
  // The suite runs in the node environment, so this also covers the server
  // render path, where `window` does not exist and the helper must not throw.
  it("reports false and does not throw when there is no window", () => {
    expect(typeof globalThis.window).toBe("undefined");
    expect(() => consumeHistoryNav()).not.toThrow();
    expect(consumeHistoryNav()).toBe(false);
  });

  it("reads the flag the pre-hydration script sets, and clears it", () => {
    const g = globalThis as { window?: unknown };
    g.window = { __lelHistoryNav: true };
    try {
      expect(consumeHistoryNav()).toBe(true);
      // Cleared, so one pop cannot silence a later push.
      expect(consumeHistoryNav()).toBe(false);
    } finally {
      delete g.window;
    }
  });
});
