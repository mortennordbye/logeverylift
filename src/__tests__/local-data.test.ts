// @vitest-environment jsdom
import { clearLocalUserData, unsyncedChangeCount } from "@/lib/utils/local-data";
import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => localStorage.clear());

describe("clearLocalUserData", () => {
  it("removes account data and keeps display preferences", async () => {
    localStorage.setItem("theme", "dark");
    localStorage.setItem("uiScale", "1.1");
    localStorage.setItem("activeWorkout", '{"sessionId":1}');
    localStorage.setItem("pendingMutationQueue", "[]");
    localStorage.setItem("weeklyGoal", "4");

    await clearLocalUserData();

    expect(Object.keys(localStorage).sort()).toEqual(["theme", "uiScale"]);
    expect(localStorage.getItem("theme")).toBe("dark");
  });

  it("empties the service worker caches", async () => {
    const del = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("caches", { keys: vi.fn().mockResolvedValue(["pages", "apis"]), delete: del });
    await clearLocalUserData();
    expect(del.mock.calls.map((c) => c[0])).toEqual(["pages", "apis"]);
    vi.unstubAllGlobals();
  });
});

describe("unsyncedChangeCount", () => {
  it("counts queued writes and tolerates a missing or broken queue", () => {
    expect(unsyncedChangeCount()).toBe(0);
    localStorage.setItem("pendingMutationQueue", "not json");
    expect(unsyncedChangeCount()).toBe(0);
    localStorage.setItem("pendingMutationQueue", '[{"id":1},{"id":2}]');
    expect(unsyncedChangeCount()).toBe(2);
  });
});
