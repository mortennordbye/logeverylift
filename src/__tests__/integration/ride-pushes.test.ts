/**
 * Ride step alerts on the server (docs/plans/bike-ride-logger.md, 4.7): every
 * ride event rewrites the ride's alerts, the loop claims each due alert once,
 * an app on screen (a fresh heartbeat) gets no push, a device that has gone is
 * deleted, and with no VAPID keys push is off.
 */
import { db } from "@/db";
import { athleteThresholds, pushSubscriptions, ridePushes, rides } from "@/db/schema";
import { deletePushSubscription, savePushSubscription } from "@/lib/actions/push";
import { sendRideEvent, startRide } from "@/lib/actions/rides";
import { env } from "@/lib/env";
import { RIDE_PUSH_TICK_MS, sendDueRidePushes, startRidePushLoop } from "@/lib/push";
import { asc, eq } from "drizzle-orm";
import webpush from "web-push";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExercise, createSession, createStepProgram, createUser } from "./factories";
import { asUser } from "./setup";

const { sendNotification } = vi.hoisted(() => ({ sendNotification: vi.fn() }));
vi.mock("web-push", async (importOriginal) => {
  const actual = await importOriginal<{ default: typeof import("web-push") }>();
  return { default: { ...actual.default, sendNotification: (...a: unknown[]) => sendNotification(...a) } };
});

const T0 = new Date("2026-11-17T17:00:00Z").getTime();
const at = (s: number) => T0 + s * 1000;
const KEYS = webpush.generateVAPIDKeys();

let me: string;
let other: string;
let bike: number;
let ids = 0;
const cid = () => `c${++ids}`;

const tempo = {
  v: 2,
  sport: "bike",
  name: "Bike tempo",
  steps: [
    { type: "warmup", end: { type: "time", seconds: 600 }, ramp: { anchor: "ftp", from: 50, to: 70 } },
    {
      type: "repeat",
      count: 2,
      steps: [
        { type: "work", end: { type: "time", seconds: 900 }, target: { metric: "power", anchor: "ftp", low: 76, high: 85 } },
        { type: "recovery", end: { type: "time", seconds: 300 }, free: true },
      ],
    },
    { type: "cooldown", end: { type: "lap" } },
  ],
};

function pushOn(on: boolean) {
  Object.assign(env, on ? { VAPID_PUBLIC_KEY: KEYS.publicKey, VAPID_PRIVATE_KEY: KEYS.privateKey, VAPID_SUBJECT: "mailto:test@example.com" } : { VAPID_PUBLIC_KEY: undefined, VAPID_PRIVATE_KEY: undefined, VAPID_SUBJECT: undefined });
}

const device = (n = 1) => ({ endpoint: `https://push.example/device-${n}`, keys: { p256dh: "BNcR", auth: "tBHI" } });

function ok<T>(r: { success: true; data: T } | { success: false; error: string }): T {
  if (!r.success) throw new Error(r.error);
  return r.data;
}

/** A running ride of the tempo steps, started at T0. */
async function ride(userId = me) {
  await db.insert(athleteThresholds).values({ userId, kind: "ftp", value: 200, measuredOn: "2026-11-01", source: "manual" });
  const { program, slots } = await createStepProgram(userId, bike, tempo);
  const session = await createSession(userId, program.id);
  asUser(userId);
  const view = ok(await startRide({ sessionId: session.id, programExerciseId: slots[0].programExerciseId, mode: "indoor", clientId: cid() }));
  return { view, programId: program.id, programExerciseId: slots[0].programExerciseId };
}

/** The ride's alerts as seconds after T0 and kind. */
async function alerts(rideId: number) {
  const rows = await db.select().from(ridePushes).where(eq(ridePushes.rideId, rideId)).orderBy(asc(ridePushes.sendAt));
  return rows.map((r) => [(r.sendAt.getTime() - T0) / 1000, r.kind] as const);
}

let seq = 1;
async function event(rideId: number, kind: "pause" | "resume" | "skip" | "unskip" | "extend" | "nudge" | "lap" | "end", s: number, value?: number) {
  vi.setSystemTime(at(s));
  const view = ok(await sendRideEvent({ rideId, clientId: cid(), kind, value, expectedSeq: seq }));
  seq = view.ride.seq;
  return view;
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  seq = 1;
  sendNotification.mockReset().mockResolvedValue({ statusCode: 201 });
  pushOn(true);
  me = (await createUser({ enduranceEnabled: true })).id;
  other = (await createUser({ enduranceEnabled: true })).id;
  bike = (await createExercise({ name: `Bike ${Math.random()}`, category: "cardio", discipline: "bike" })).id;
  asUser(me);
  ok(await savePushSubscription(device()));
});

afterEach(() => {
  vi.useRealTimers();
  pushOn(false);
});

describe("scheduling", () => {
  it("start writes the alerts; every event rewrites them from the timeline", async () => {
    const { view } = await ride();
    const id = view.ride.id;
    // Warm-up 10 min, work 15, easy 5, work 15, then a lap cool-down: no alert after its start.
    expect(await alerts(id)).toEqual([
      [540, "minute_left"],
      [600, "step"],
      [1440, "minute_left"],
      [1500, "step"],
      [1740, "minute_left"],
      [1800, "step"],
      [2640, "minute_left"],
      [2700, "step"],
    ]);
    const [first] = await db.select().from(ridePushes).where(eq(ridePushes.rideId, id)).orderBy(asc(ridePushes.sendAt));
    expect(first).toMatchObject({ userId: me, title: "1 min left · next Work 152-170 W", body: "Step 1 of 5 · Warm-up", stepIndex: 0 });

    await event(id, "pause", 100);
    expect(await alerts(id)).toEqual([]);

    await event(id, "resume", 160);
    expect((await alerts(id)).map(([s]) => s)).toEqual([600, 660, 1500, 1560, 1800, 1860, 2700, 2760]);

    await event(id, "skip", 200);
    expect((await alerts(id)).map(([s]) => s)).toEqual([1040, 1100, 1340, 1400, 2240, 2300]);

    await event(id, "unskip", 210);
    expect((await alerts(id))[0]).toEqual([600, "minute_left"]);

    await event(id, "extend", 220, 60);
    expect((await alerts(id))[0]).toEqual([660, "minute_left"]);

    await event(id, "nudge", 230, 5);
    expect((await alerts(id))[0]).toEqual([660, "minute_left"]);

    await event(id, "lap", 240);
    expect((await alerts(id))[0]).toEqual([1080, "minute_left"]);

    await event(id, "end", 300);
    expect(await alerts(id)).toEqual([]);
  });

  it("writes none for a user with no device turned on", async () => {
    asUser(me);
    ok(await deletePushSubscription({ endpoint: device().endpoint }));
    const { view } = await ride();
    expect(await alerts(view.ride.id)).toEqual([]);
  });

  it("push off: no alerts written, an event clears what was there, and the loop sends nothing", async () => {
    const { view } = await ride();
    expect((await alerts(view.ride.id)).length).toBe(8);
    pushOn(false);
    await event(view.ride.id, "pause", 100);
    await event(view.ride.id, "resume", 110);
    expect(await alerts(view.ride.id)).toEqual([]);
    expect(await sendDueRidePushes(at(5000))).toEqual({ claimed: 0, sent: 0, skipped: 0, gone: 0 });
  });
});

describe("sending", () => {
  it("claims each due alert once, also with two runs at the same time", async () => {
    const { view, programId, programExerciseId } = await ride();
    const now = at(545);
    const [a, b] = await Promise.all([sendDueRidePushes(now), sendDueRidePushes(now)]);
    expect(a.claimed + b.claimed).toBe(1);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    const [sub, body, opts] = sendNotification.mock.calls[0];
    expect(sub).toEqual({ endpoint: device().endpoint, keys: device().keys });
    expect(JSON.parse(body)).toEqual({
      title: "1 min left · next Work 152-170 W",
      body: "Step 1 of 5 · Warm-up",
      tag: `ride-${view.ride.id}`,
      url: `/programs/${programId}/workout/exercises/${programExerciseId}?ride=1`,
    });
    expect(opts).toMatchObject({ TTL: 60, urgency: "high", topic: `ride-${view.ride.id}`, vapidDetails: { publicKey: KEYS.publicKey, privateKey: KEYS.privateKey } });
    expect((await alerts(view.ride.id)).length).toBe(7);
    const [stored] = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, me));
    expect(stored.lastUsedAt?.getTime()).toBe(now);
  });

  it("a heartbeat in the last 15 s holds the push back: the app on screen plays its own cue", async () => {
    const { view } = await ride();
    vi.setSystemTime(at(535));
    ok(await sendRideEvent({ rideId: view.ride.id, clientId: cid(), kind: "heartbeat", expectedSeq: 1 }));
    const held = await sendDueRidePushes(at(545));
    expect(held).toMatchObject({ claimed: 1, sent: 0, skipped: 1 });
    expect(sendNotification).not.toHaveBeenCalled();

    // The app went to the background: at the next alert the heartbeat is over a minute old.
    const sent = await sendDueRidePushes(at(601));
    expect(sent).toMatchObject({ claimed: 1, sent: 1 });
    expect(JSON.parse(sendNotification.mock.calls[0][1]).title).toBe("Work · 1 of 2 · 152-170 W · 15 min");
  });

  it("of several due alerts of one ride only the latest goes; one more than a minute late is dropped", async () => {
    const { view } = await ride();
    expect(await sendDueRidePushes(at(605))).toMatchObject({ claimed: 2, sent: 1, skipped: 1 });
    expect(JSON.parse(sendNotification.mock.calls[0][1]).title).toBe("Work · 1 of 2 · 152-170 W · 15 min");
    sendNotification.mockClear();
    // The server was away: at 1561 s the alerts of 1440 and 1500 are due, and the latest is 61 s late.
    expect(await sendDueRidePushes(at(1561))).toMatchObject({ claimed: 2, sent: 0, skipped: 2 });
    expect(sendNotification).not.toHaveBeenCalled();
    expect((await alerts(view.ride.id)).length).toBe(4);
  });

  it("deletes a device whose push service answers 410 or 404, keeps it on other errors", async () => {
    asUser(me);
    ok(await savePushSubscription(device(2)));
    ok(await savePushSubscription(device(3)));
    await ride();
    sendNotification.mockImplementation(async (sub: { endpoint: string }) => {
      if (sub.endpoint.endsWith("device-1")) throw Object.assign(new Error("gone"), { statusCode: 410 });
      if (sub.endpoint.endsWith("device-2")) throw Object.assign(new Error("not found"), { statusCode: 404 });
      throw Object.assign(new Error("server error"), { statusCode: 500 });
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await sendDueRidePushes(at(545))).toMatchObject({ sent: 0, gone: 2 });
    const left = await db.select({ endpoint: pushSubscriptions.endpoint }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, me));
    expect(left.map((r) => r.endpoint)).toEqual([device(3).endpoint]);
    expect(errors).toHaveBeenCalledWith("[ridePush] send failed", expect.objectContaining({ status: 500 }));
    // Logs ids and the status only, never the endpoint.
    expect(JSON.stringify(errors.mock.calls)).not.toContain("push.example");
    errors.mockRestore();
  });

  it("a ride deleted with its rows: nothing is sent", async () => {
    const { view } = await ride();
    await db.delete(rides).where(eq(rides.id, view.ride.id));
    expect(await sendDueRidePushes(at(545))).toMatchObject({ claimed: 0, sent: 0 });
  });
});

describe("the loop", () => {
  it("runs only when the keys are set", () => {
    const spy = vi.spyOn(globalThis, "setInterval");
    pushOn(false);
    expect(startRidePushLoop()).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    pushOn(true);
    const id = startRidePushLoop();
    expect(id).not.toBeNull();
    expect(spy).toHaveBeenCalledWith(expect.any(Function), RIDE_PUSH_TICK_MS);
    clearInterval(id!);
    spy.mockRestore();
  });
});

describe("subscriptions", () => {
  it("save is an upsert by endpoint; the same device signed in as another user moves to that user", async () => {
    asUser(me);
    ok(await savePushSubscription({ ...device(), keys: { p256dh: "BNew", auth: "aNew" } }));
    let rows = await db.select().from(pushSubscriptions);
    expect(rows.map((r) => [r.userId, r.p256dh])).toEqual([[me, "BNew"]]);

    asUser(other);
    ok(await savePushSubscription(device()));
    rows = await db.select().from(pushSubscriptions);
    expect(rows.map((r) => r.userId)).toEqual([other]);
  });

  it("delete removes only the caller's row", async () => {
    asUser(other);
    expect(ok(await deletePushSubscription({ endpoint: device().endpoint }))).toEqual({ deleted: false });
    expect((await db.select().from(pushSubscriptions)).length).toBe(1);
    asUser(me);
    expect(ok(await deletePushSubscription({ endpoint: device().endpoint }))).toEqual({ deleted: true });
    expect(await db.select().from(pushSubscriptions)).toEqual([]);
  });

  it("refuses bad input, and refuses to save while push is off", async () => {
    asUser(me);
    expect(await savePushSubscription({ endpoint: "http://push.example/x", keys: device().keys })).toMatchObject({ success: false, error: "Invalid input" });
    expect(await savePushSubscription({ endpoint: device(2).endpoint })).toMatchObject({ success: false, error: "Invalid input" });
    pushOn(false);
    expect(await savePushSubscription(device(2))).toEqual({ success: false, error: "Step alerts are off on this server" });
  });
});
