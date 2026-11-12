import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// reloadForFreshBundle keeps a once-per-page flag at module level, so each
// test loads a fresh copy of the module.
async function load() {
  vi.resetModules();
  return import("@/lib/utils/stale-bundle");
}

const reload = vi.fn();
const update = vi.fn(async () => undefined);

function stubPage({ navType = "navigate", ageMs = 120_000 }: { navType?: string; ageMs?: number } = {}) {
  vi.stubGlobal("window", { location: { reload } });
  vi.stubGlobal("navigator", { serviceWorker: { getRegistration: async () => ({ update }) } });
  vi.stubGlobal("performance", {
    now: () => ageMs,
    getEntriesByType: (t: string) => (t === "navigation" ? [{ type: navType }] : []),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  reload.mockReset();
  update.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("reloadForFreshBundle", () => {
  it("updates the service worker, then reloads the page once", async () => {
    stubPage();
    const { reloadForFreshBundle, isReloadPending } = await load();
    expect(isReloadPending()).toBe(false);
    expect(reloadForFreshBundle()).toBe(true);
    expect(isReloadPending()).toBe(true);
    // A second stale error in the same page joins the reload under way.
    expect(reloadForFreshBundle()).toBe(true);
    await vi.runAllTimersAsync();
    expect(update).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload a page that a reload loaded moments ago, so it cannot loop", async () => {
    stubPage({ navType: "reload", ageMs: 5_000 });
    const { reloadForFreshBundle, isReloadPending } = await load();
    expect(reloadForFreshBundle()).toBe(false);
    expect(isReloadPending()).toBe(false);
    await vi.runAllTimersAsync();
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads again once that page has been open a while", async () => {
    stubPage({ navType: "reload", ageMs: 120_000 });
    const { reloadForFreshBundle } = await load();
    expect(reloadForFreshBundle()).toBe(true);
    await vi.runAllTimersAsync();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
