// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { HISTORY_TAG_SCRIPT, readPrevEntry } from "@/lib/utils/nav-history";

/**
 * The pre-hydration script that tags each history entry with the URL it was
 * pushed from. It runs before Next's router, so every push and replace the
 * router makes goes through it.
 */

type Tagged = { __lelPrev?: string; __NA?: boolean; tree?: string };
const state = () => window.history.state as Tagged | null;

beforeAll(() => {
  window.history.replaceState(null, "", "/");
  new Function(HISTORY_TAG_SCRIPT)();
});

describe("history tag", () => {
  it("has no previous page on the first entry", () => {
    expect(readPrevEntry()).toBeNull();
  });

  it("tags a push with the URL it came from, keeping the router's own fields", () => {
    window.history.replaceState(null, "", "/more?x=1");
    window.history.pushState({ __NA: true, tree: "t" }, "", "/more/metrics");
    expect(state()).toEqual({ __NA: true, tree: "t", __lelPrev: "/more?x=1" });
    expect(readPrevEntry()).toBe("/more?x=1");
  });

  it("keeps the tag when the router replaces the entry", () => {
    // Next replaces the current entry on every commit, with a fresh state object.
    window.history.replaceState({ __NA: true, tree: "u" }, "", "/more/metrics?tab=records");
    expect(state()).toEqual({ __NA: true, tree: "u", __lelPrev: "/more?x=1" });
  });

  it("tags a push with null data", () => {
    window.history.pushState(null, "", "/history");
    expect(readPrevEntry()).toBe("/more/metrics?tab=records");
  });

  it("leaves non-object data alone", () => {
    window.history.pushState("raw", "", "/history/2");
    expect(window.history.state).toBe("raw");
    expect(readPrevEntry()).toBeNull();
  });

  it("wraps only once when the script runs again", () => {
    const push = window.history.pushState;
    new Function(HISTORY_TAG_SCRIPT)();
    expect(window.history.pushState).toBe(push);
  });
});
