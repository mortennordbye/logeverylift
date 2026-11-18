import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The step alerts' service worker (public/push-sw.js): every push shows a
 * notification (Safari takes push away from a site whose push shows none),
 * one tag per ride, and a tap opens the link in the payload.
 */

const code = readFileSync(path.resolve(__dirname, "../../public/push-sw.js"), "utf8");

type Handler = (event: Record<string, unknown>) => void;

function worker(windows: { url: string; focus: () => Promise<unknown> }[] = []) {
  const handlers: Record<string, Handler> = {};
  const self = {
    location: { origin: "https://app.example" },
    addEventListener: (type: string, fn: Handler) => (handlers[type] = fn),
    skipWaiting: vi.fn(),
    registration: { showNotification: vi.fn(async () => undefined) },
    clients: { matchAll: vi.fn(async () => windows), openWindow: vi.fn(async () => null) },
  };
  new Function("self", code)(self);
  return { self, handlers };
}

/** Fire an event and wait for what it passed to waitUntil. */
async function fire(handler: Handler, event: Record<string, unknown>) {
  let pending: Promise<unknown> = Promise.resolve();
  handler({ ...event, waitUntil: (p: Promise<unknown>) => (pending = p) });
  await pending;
}

const push = (payload: unknown) => ({ data: { json: () => (typeof payload === "string" ? JSON.parse(payload) : payload) } });

let w: ReturnType<typeof worker>;
beforeEach(() => {
  w = worker();
});

describe("push", () => {
  it("shows the alert with the ride's tag, renotify, and the link", async () => {
    await fire(w.handlers.push, push({ title: "Work · 135-146 W · 15 min", body: "Step 2 of 5 · Warm-up done", tag: "ride-7", url: "/programs/1/workout/exercises/2?ride=1" }));
    expect(w.self.registration.showNotification).toHaveBeenCalledWith("Work · 135-146 W · 15 min", {
      body: "Step 2 of 5 · Warm-up done",
      icon: "/icon-192x192.png",
      badge: "/icon-192x192.png",
      tag: "ride-7",
      renotify: true,
      data: { url: "/programs/1/workout/exercises/2?ride=1" },
    });
  });

  it("still shows a notification for an empty or broken payload, and never links off the site", async () => {
    await fire(w.handlers.push, { data: null });
    await fire(w.handlers.push, push("{not json"));
    await fire(w.handlers.push, push({ title: "Hi", url: "https://evil.example/" }));
    await fire(w.handlers.push, push({ title: "Hi", url: "//evil.example/x" }));
    await fire(w.handlers.push, push({ title: "Hi", url: "/\\evil.example/x" }));
    const calls = w.self.registration.showNotification.mock.calls as unknown as [string, { data: { url: string }; tag?: string }][];
    expect(calls.map((c) => c[0])).toEqual(["LogEveryLift", "LogEveryLift", "Hi", "Hi", "Hi"]);
    expect(calls.every((c) => c[1].data.url === "/" && c[1].tag === undefined)).toBe(true);
  });
});

describe("notificationclick", () => {
  const click = (url: string) => ({ notification: { close: vi.fn(), data: { url } } });

  it("opens the link in the app", async () => {
    const e = click("/programs/1/workout/exercises/2?ride=1");
    await fire(w.handlers.notificationclick, e);
    expect(e.notification.close).toHaveBeenCalled();
    expect(w.self.clients.openWindow).toHaveBeenCalledWith("https://app.example/programs/1/workout/exercises/2?ride=1");
  });

  it("a link stored off the site opens the app's home", async () => {
    await fire(w.handlers.notificationclick, click("//evil.example/x"));
    expect(w.self.clients.openWindow).toHaveBeenCalledWith("https://app.example/");
  });

  it("focuses a window already on that page", async () => {
    const focus = vi.fn(async () => undefined);
    w = worker([{ url: "https://app.example/programs/1/workout/exercises/2?ride=1", focus }]);
    await fire(w.handlers.notificationclick, click("/programs/1/workout/exercises/2?ride=1"));
    expect(focus).toHaveBeenCalled();
    expect(w.self.clients.openWindow).not.toHaveBeenCalled();
  });
});
