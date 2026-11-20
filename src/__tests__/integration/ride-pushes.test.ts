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
import { MAX_DEVICES_PER_USER, RIDE_PUSH_TICK_MS, ridePushTick, sendDueRidePushes, startRidePushLoop } from "@/lib/push";
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

const device = (n = 1) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/device-${n}`, keys: { p256dh: "BNcR", auth: "tBHI" } });

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

describe("a run (docs/plans/run-logger.md, step 6)", () => {
  const strides = {
    v: 2,
    sport: "run",
    name: "Km and strides",
    steps: [
      { type: "work", end: { type: "distance", meters: 1000 }, belt: 10 },
      {
        type: "repeat",
        count: 3,
        steps: [
          { type: "work", end: { type: "time", seconds: 20 }, belt: 13 },
          { type: "recovery", end: { type: "time", seconds: 100 }, belt: 7 },
        ],
      },
      { type: "cooldown", end: { type: "time", seconds: 180 }, belt: 6 },
    ],
  };

  async function run() {
    const runId = (await createExercise({ name: `Run ${Math.random()}`, category: "cardio", discipline: "run" })).id;
    await db.insert(athleteThresholds).values({ userId: me, kind: "lthr_run", value: 180, measuredOn: "2026-11-01", source: "manual" });
    const { program, slots } = await createStepProgram(me, runId, strides);
    const session = await createSession(me, program.id);
    asUser(me);
    const view = ok(await startRide({ sessionId: session.id, programExerciseId: slots[0].programExerciseId, mode: "indoor", clientId: cid() }));
    return { view, programId: program.id, programExerciseId: slots[0].programExerciseId };
  }

  async function runEvent(view: Awaited<ReturnType<typeof run>>["view"], kind: "belt" | "skip" | "unskip" | "pause" | "resume", s: number, value?: number, step?: number) {
    vi.setSystemTime(at(s));
    const stepKey = step !== undefined ? view.plan.steps[step].key : undefined;
    const next = ok(await sendRideEvent({ rideId: view.ride.id, clientId: cid(), kind, value, stepKey, expectedSeq: seq }));
    seq = next.ride.seq;
    return next;
  }

  it("events rewrite the alerts of a run with a strides block; a belt event moves the alert of a belt distance step", async () => {
    const { view } = await run();
    // 1 km at 10 km/h ends at 360 s; the block is 3 × 120 s; the cool-down ends at 900 s.
    expect(await alerts(view.ride.id)).toEqual([
      [300, "minute_left"],
      [360, "step"],
      [620, "step"],
      [720, "step"],
      [840, "minute_left"],
      [900, "done"],
    ]);
    const titles = (await db.select().from(ridePushes).where(eq(ridePushes.rideId, view.ride.id)).orderBy(asc(ridePushes.sendAt))).map((r) => r.title);
    expect(titles).toEqual([
      "1 min left · next 13.0 km/h · Strides 3 × 20 s",
      "13.0 km/h · Strides 3 × 20 s · 1 min 40 s easy between",
      "7.0 km/h · Easy · 1 min 40 s",
      "6.0 km/h · Cool-down · 3 min",
      "1 min left · last step",
      "Run done",
    ]);

    // At 60 s, 167 m are run; the 833 m left at 12 km/h take 250 s.
    await runEvent(view, "belt", 60, 120, 0);
    expect((await alerts(view.ride.id)).map(([s]) => s)).toEqual([250, 310, 570, 670, 790, 850]);

    // Hold to skip in the block skips the rest of it: the cool-down is next, then the end.
    await runEvent(view, "skip", 400, 1, 2);
    expect(await alerts(view.ride.id)).toEqual([
      [520, "minute_left"],
      [580, "done"],
    ]);
    await runEvent(view, "unskip", 410);
    expect((await alerts(view.ride.id)).map(([s]) => s)).toEqual([570, 670, 790, 850]);

    await runEvent(view, "pause", 420);
    expect(await alerts(view.ride.id)).toEqual([]);
  });

  it("the alert goes with the run's title and opens the run exercise in run mode", async () => {
    const { view, programId, programExerciseId } = await run();
    expect(await sendDueRidePushes(at(305))).toMatchObject({ claimed: 1, sent: 1 });
    expect(JSON.parse(sendNotification.mock.calls[0][1])).toEqual({
      title: "1 min left · next 13.0 km/h · Strides 3 × 20 s",
      body: "Step 1 of 3 · Work",
      tag: `ride-${view.ride.id}`,
      url: `/programs/${programId}/workout/exercises/${programExerciseId}?ride=1`,
    });
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
    expect(opts).toMatchObject({ TTL: 60, urgency: "high", timeout: 10_000, vapidDetails: { publicKey: KEYS.publicKey, privateKey: KEYS.privateKey } });
    // No Topic header: it would show the push service the ride id.
    expect(opts).not.toHaveProperty("topic");
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
    expect(JSON.stringify(errors.mock.calls)).not.toContain("googleapis");
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

describe("the loop", () => {
  it("a run that throws or times out never stops the next run", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("hung host timed out"))
      .mockResolvedValue(undefined);
    const tick = ridePushTick(send);
    await tick();
    await tick();
    expect(send).toHaveBeenCalledTimes(2);
    expect(errors).toHaveBeenCalledWith("[ridePush] loop failed", "hung host timed out");
    errors.mockRestore();
  });

  it("one run at a time: a tick while a run is going does nothing", async () => {
    let finish!: () => void;
    const send = vi.fn(() => new Promise<void>((r) => (finish = r)));
    const tick = ridePushTick(send);
    const first = tick();
    await tick();
    expect(send).toHaveBeenCalledTimes(1);
    finish();
    await first;
    const third = tick();
    expect(send).toHaveBeenCalledTimes(2);
    finish();
    await third;
  });
});

describe("subscriptions", () => {
  it("accepts only the push services' hosts, over https, with no IP address", async () => {
    asUser(me);
    for (const endpoint of [
      "https://fcm.googleapis.com/fcm/send/abc",
      "https://web.push.apple.com/QGx",
      "https://api.push.apple.com/x",
      "https://updates.push.services.mozilla.com/wpush/v2/x",
      "https://wns2-db5p.notify.windows.com/w/?token=x",
    ]) {
      expect(await savePushSubscription({ endpoint, keys: device().keys })).toMatchObject({ success: true });
    }
    for (const endpoint of [
      "https://evil.example/x",
      "https://fcm.googleapis.com.evil.example/x",
      "https://evilpush.apple.com/x",
      "https://push.apple.com.evil.example/x",
      "http://fcm.googleapis.com/x",
      "https://127.0.0.1/x",
      "https://[::1]/x",
      "https://fcm.googleapis.com:8443/x",
    ]) {
      expect(await savePushSubscription({ endpoint, keys: device().keys }), endpoint).toMatchObject({ success: false, error: "Invalid input" });
    }
  });

  it(`keeps at most ${10} devices per user: the oldest goes`, async () => {
    expect(MAX_DEVICES_PER_USER).toBe(10);
    asUser(me);
    for (let n = 2; n <= 11; n++) {
      vi.setSystemTime(T0 + n * 1000);
      ok(await savePushSubscription(device(n)));
    }
    const rows = await db.select({ endpoint: pushSubscriptions.endpoint }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, me));
    expect(rows.length).toBe(10);
    expect(rows.map((r) => r.endpoint)).not.toContain(device(1).endpoint);
    // Another user's devices are not counted or touched.
    asUser(other);
    ok(await savePushSubscription(device(20)));
    expect((await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, me))).length).toBe(10);
  });

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
    expect(await savePushSubscription({ endpoint: "http://fcm.googleapis.com/x", keys: device().keys })).toMatchObject({ success: false, error: "Invalid input" });
    expect(await savePushSubscription({ endpoint: device(2).endpoint })).toMatchObject({ success: false, error: "Invalid input" });
    pushOn(false);
    expect(await savePushSubscription(device(2))).toEqual({ success: false, error: "Step alerts are off on this server" });
  });
});
