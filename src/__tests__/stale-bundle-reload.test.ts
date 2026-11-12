import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// reloadForFreshBundle keeps a once-per-page flag at module level, so each
// test (and each simulated page) loads a fresh copy of the module.
async function load() {
  vi.resetModules();
  return import("@/lib/utils/stale-bundle");
}

const reload = vi.fn();
let update = vi.fn(async () => undefined);
let session: Map<string, string>;

function stubPage({
  navType = "navigate",
  ageMs = 120_000,
  storage = true,
}: { navType?: string; ageMs?: number; storage?: boolean } = {}) {
  vi.stubGlobal("window", { location: { reload } });
  vi.stubGlobal("navigator", { serviceWorker: { getRegistration: async () => ({ update: () => update() }) } });
  vi.stubGlobal("performance", {
    now: () => ageMs,
    getEntriesByType: (t: string) => (t === "navigation" ? [{ type: navType }] : []),
  });
  vi.stubGlobal(
    "sessionStorage",
    storage
      ? {
          getItem: (k: string) => session.get(k) ?? null,
          setItem: (k: string, v: string) => void session.set(k, v),
          removeItem: (k: string) => void session.delete(k),
        }
      : {
          getItem: () => {
            throw new Error("SecurityError");
          },
          setItem: () => {
            throw new Error("SecurityError");
          },
          removeItem: () => {
            throw new Error("SecurityError");
          },
        },
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  reload.mockReset();
  update = vi.fn(async () => undefined);
  session = new Map();
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
    expect(reloadForFreshBundle()).toBe("reloading");
    expect(isReloadPending()).toBe(true);
    // A second stale error in the same page joins the reload under way.
    expect(reloadForFreshBundle()).toBe("reloading");
    await vi.runAllTimersAsync();
    expect(update).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads anyway when the service worker update never answers", async () => {
    stubPage();
    update = vi.fn(() => new Promise<undefined>(() => {}));
    const { reloadForFreshBundle } = await load();
    expect(reloadForFreshBundle()).toBe("reloading");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload a page that a reload loaded moments ago, so it cannot loop", async () => {
    stubPage({ navType: "reload", ageMs: 5_000 });
    const { reloadForFreshBundle, isReloadPending } = await load();
    expect(reloadForFreshBundle()).toBe("later");
    expect(isReloadPending()).toBe(false);
    await vi.runAllTimersAsync();
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads again once that page has been open a while", async () => {
    stubPage({ navType: "reload", ageMs: 120_000 });
    const { reloadForFreshBundle } = await load();
    expect(reloadForFreshBundle()).toBe("reloading");
    await vi.runAllTimersAsync();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("gives up after three reloads in a row that reached no server action", async () => {
    stubPage();
    for (let i = 0; i < 3; i++) {
      const { reloadForFreshBundle } = await load();
      expect(reloadForFreshBundle()).toBe("reloading");
      await vi.runAllTimersAsync();
    }
    expect(reload).toHaveBeenCalledTimes(3);

    const page4 = await load();
    expect(page4.reloadForFreshBundle()).toBe("failed");
    await vi.runAllTimersAsync();
    expect(reload).toHaveBeenCalledTimes(3);

    // An action that reached the server resets the count.
    page4.noteActionReached();
    const page5 = await load();
    expect(page5.reloadForFreshBundle()).toBe("reloading");
  });

  it("does not count reloads from deploys far apart towards the cap", async () => {
    stubPage();
    // A PWA left open all day: three deploys hours apart, each reloading the
    // page with no write in between.
    for (let i = 0; i < 3; i++) {
      const { reloadForFreshBundle } = await load();
      expect(reloadForFreshBundle()).toBe("reloading");
      await vi.runAllTimersAsync();
      vi.setSystemTime(Date.now() + 3 * 60 * 60_000);
    }
    const page4 = await load();
    expect(page4.reloadForFreshBundle()).toBe("reloading");
  });

  it("still reloads when session storage is blocked", async () => {
    stubPage({ storage: false });
    const { reloadForFreshBundle, noteActionReached } = await load();
    expect(() => noteActionReached()).not.toThrow();
    expect(reloadForFreshBundle()).toBe("reloading");
    await vi.runAllTimersAsync();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("callAction while a reload is under way", () => {
  it("answers 'App updating' at once instead of waiting on the old bundle's request", async () => {
    stubPage();
    const { callAction, reloadForFreshBundle } = await load();
    reloadForFreshBundle();
    // A request the coming reload cuts off never settles.
    const result = await callAction(new Promise<{ success: true }>(() => {}));
    expect(result).toEqual({ success: false, error: "App updating" });
  });
});
