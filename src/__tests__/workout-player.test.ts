import {
  PLAYER_STORAGE_KEY,
  PLAYER_TTL_MS,
  elapsedSeconds,
  extend,
  finish,
  flattenWorkout,
  initialState,
  lap,
  pause,
  remainingSeconds,
  restorePlayerState,
  resume,
  serializePlayerState,
  skip,
  start,
  tick,
  totalActiveSeconds,
  workoutHash,
  type PlayableWorkout,
} from "@/lib/utils/workout-player";
import { describe, expect, it } from "vitest";

const T0 = 1_800_000_000_000;
const s = (n: number) => n * 1000;

// warm-up 60 s, 2 × (work 30 s, recovery 20 s), cool-down to lap
const workout: PlayableWorkout = {
  steps: [
    { id: "s1", type: "warmup", end: { type: "time", seconds: 60 } },
    {
      id: "s2",
      type: "repeat",
      count: 2,
      steps: [
        { id: "s3", type: "work", end: { type: "time", seconds: 30 } },
        { id: "s4", type: "recovery", end: { type: "time", seconds: 20 } },
      ],
    },
    { id: "s5", type: "cooldown", end: { type: "lap" } },
  ],
};
const steps = flattenWorkout(workout);
const fresh = () => initialState({ plannedSessionId: 7, workoutHash: workoutHash(workout), clientKey: "k1" });
const started = () => start(fresh(), steps, T0);

describe("flattenWorkout", () => {
  it("expands repeats with round keys and keeps the order", () => {
    expect(steps.map((p) => p.key)).toEqual(["s1", "s3#1", "s4#1", "s3#2", "s4#2", "s5"]);
    expect(steps[3].round).toEqual({ index: 2, of: 2 });
    expect(steps[0].round).toBeNull();
  });

  it("gives time steps their seconds and lap or distance steps none", () => {
    expect(steps.map((p) => p.seconds)).toEqual([60, 30, 20, 30, 20, null]);
    const d = flattenWorkout({ steps: [{ id: "a", type: "work", end: { type: "distance", meters: 400 } }] });
    expect(d[0].seconds).toBeNull();
  });

  it("uses the send-off as the time of a swim rep", () => {
    const swim = flattenWorkout({
      steps: [{ id: "r", type: "repeat", count: 3, steps: [{ id: "w", type: "work", end: { type: "distance", meters: 100 }, sendOffSeconds: 120 }] }],
    });
    expect(swim.map((p) => [p.key, p.seconds])).toEqual([["w#1", 120], ["w#2", 120], ["w#3", 120]]);
  });

  it("fills a key for a step without an id", () => {
    expect(flattenWorkout({ steps: [{ type: "work", end: { type: "lap" } }] })[0].key).toBe("n1");
  });

  it("refuses more than 400 steps", () => {
    const big: PlayableWorkout = { steps: Array.from({ length: 9 }, (_, i) => ({ id: `r${i}`, type: "repeat" as const, count: 50, steps: [{ id: `w${i}`, type: "work" as const, end: { type: "lap" as const } }] })) };
    expect(() => flattenWorkout(big)).toThrow(RangeError);
  });
});

describe("workoutHash", () => {
  it("is stable and changes with the workout", () => {
    expect(workoutHash(workout)).toBe(workoutHash(JSON.parse(JSON.stringify(workout))));
    expect(workoutHash({ ...workout, steps: workout.steps.slice(1) })).not.toBe(workoutHash(workout));
  });
});

describe("player events", () => {
  it("counts down from timestamps", () => {
    const st = started();
    expect(st.status).toBe("running");
    expect(remainingSeconds(st, steps, T0)).toBe(60);
    expect(remainingSeconds(st, steps, T0 + 100)).toBe(60);
    expect(remainingSeconds(st, steps, T0 + s(59.5))).toBe(1);
    expect(remainingSeconds(st, steps, T0 + s(60))).toBe(0);
  });

  it("does nothing before start and only starts once", () => {
    expect(tick(fresh(), steps, T0).changed).toBe(0);
    const st = started();
    expect(start(st, steps, T0 + 5)).toBe(st);
  });

  it("tick closes a step at its exact end and starts the next there", () => {
    const { state, changed } = tick(started(), steps, T0 + s(61));
    expect(changed).toBe(1);
    expect(state.index).toBe(1);
    expect(state.runs[0]).toEqual({ key: "s1", startedAt: T0, endedAt: T0 + s(60), activeSeconds: 60, status: "done", extendedSeconds: 0 });
    expect(state.stepStartedAt).toBe(T0 + s(60));
    expect(remainingSeconds(state, steps, T0 + s(61))).toBe(29);
  });

  it("catches up after a long suspend and stops at the lap step", () => {
    const { state, changed } = tick(started(), steps, T0 + s(3600));
    expect(changed).toBe(5);
    expect(state.index).toBe(5);
    expect(state.status).toBe("running");
    expect(state.runs.map((r) => r.endedAt - T0)).toEqual([s(60), s(90), s(110), s(140), s(160)]);
    expect(remainingSeconds(state, steps, T0 + s(3600))).toBeNull();
    expect(elapsedSeconds(state, T0 + s(3600))).toBe(3600 - 160);
  });

  it("pause freezes the remaining time, and resume moves the end", () => {
    let st = pause(started(), steps, T0 + s(10));
    expect(st.status).toBe("paused");
    expect(remainingSeconds(st, steps, T0 + s(500))).toBe(50);
    expect(tick(st, steps, T0 + s(500)).changed).toBe(0);
    st = resume(st, T0 + s(40));
    expect(st.pausedTotalMs).toBe(s(30));
    expect(remainingSeconds(st, steps, T0 + s(40))).toBe(50);
    const t = tick(st, steps, T0 + s(90)).state;
    expect(t.runs[0]).toMatchObject({ endedAt: T0 + s(90), activeSeconds: 60 });
  });

  it("pause first closes steps that already ended", () => {
    const st = pause(started(), steps, T0 + s(70));
    expect(st.index).toBe(1);
    expect(st.status).toBe("paused");
    expect(remainingSeconds(st, steps, T0 + s(999))).toBe(20);
  });

  it("skip closes the step as skipped with its active time", () => {
    const st = skip(started(), steps, T0 + s(12));
    expect(st.runs[0]).toMatchObject({ key: "s1", status: "skipped", activeSeconds: 12, endedAt: T0 + s(12) });
    expect(st.stepStartedAt).toBe(T0 + s(12));
    expect(st.index).toBe(1);
  });

  it("skip while paused counts time to the pause and keeps the next step paused", () => {
    let st = pause(started(), steps, T0 + s(12));
    st = skip(st, steps, T0 + s(100));
    expect(st.runs[0]).toMatchObject({ activeSeconds: 12, endedAt: T0 + s(12) });
    expect(st.status).toBe("paused");
    st = resume(st, T0 + s(100));
    expect(remainingSeconds(st, steps, T0 + s(100))).toBe(30);
  });

  it("extend adds time to a time step, during the last seconds too", () => {
    let st = extend(started(), steps, 30, T0 + s(58));
    expect(remainingSeconds(st, steps, T0 + s(58))).toBe(32);
    st = tick(st, steps, T0 + s(91)).state;
    expect(st.runs[0]).toMatchObject({ activeSeconds: 90, extendedSeconds: 30, endedAt: T0 + s(90) });
    expect(st.extendSeconds).toBe(0);
  });

  it("extend refuses bad amounts and lap steps", () => {
    const st = started();
    expect(extend(st, steps, 0, T0)).toEqual(st);
    expect(extend(st, steps, 601, T0)).toEqual(st);
    const atLap = tick(st, steps, T0 + s(200)).state;
    expect(extend(atLap, steps, 30, T0 + s(200))).toEqual(atLap);
  });

  it("lap closes only a step that waits for it, and the last one finishes the run", () => {
    const st = started();
    expect(lap(st, steps, T0 + s(5))).toEqual(st);
    const atLap = tick(st, steps, T0 + s(200)).state;
    const done = lap(atLap, steps, T0 + s(400));
    expect(done.status).toBe("finished");
    expect(done.finishedAt).toBe(T0 + s(400));
    expect(done.runs.at(-1)).toMatchObject({ key: "s5", status: "done", activeSeconds: 240 });
    expect(totalActiveSeconds(done, T0 + s(400))).toBe(400);
  });

  it("finish closes the current step as partial", () => {
    const st = finish(started(), steps, T0 + s(75));
    expect(st.status).toBe("finished");
    expect(st.runs.map((r) => [r.key, r.status, r.activeSeconds])).toEqual([["s1", "done", 60], ["s3#1", "partial", 15]]);
    expect(st.finishedAt).toBe(T0 + s(75));
    expect(finish(st, steps, T0 + s(99))).toBe(st);
  });

  it("finish before start ends with no steps", () => {
    const st = finish(fresh(), steps, T0);
    expect(st).toMatchObject({ status: "finished", runs: [], finishedAt: T0 });
  });

  it("total active time leaves pauses out", () => {
    let st = pause(started(), steps, T0 + s(10));
    st = resume(st, T0 + s(70));
    expect(totalActiveSeconds(st, T0 + s(80))).toBe(20);
  });
});

describe("persistence", () => {
  const expect0 = { plannedSessionId: 7, workoutHash: workoutHash(workout), now: T0 + s(100) };

  it("round-trips a running state under the guidedWorkout key", () => {
    expect(PLAYER_STORAGE_KEY).toBe("guidedWorkout");
    const st = tick(started(), steps, T0 + s(65)).state;
    expect(restorePlayerState(serializePlayerState(st), expect0)).toEqual({ state: st });
  });

  it("stores no names or notes", () => {
    const raw = serializePlayerState(started());
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(
      ["clientKey", "extendSeconds", "finishedAt", "index", "pausedAt", "pausedTotalMs", "plannedSessionId", "runs", "startedAt", "status", "stepPausedMs", "stepStartedAt", "v", "workoutHash"].sort(),
    );
  });

  it("refuses missing, corrupt and unknown data", () => {
    expect(restorePlayerState(null, expect0)).toEqual({ state: null, reason: "none" });
    expect(restorePlayerState("{not json", expect0)).toEqual({ state: null, reason: "corrupt" });
    expect(restorePlayerState(JSON.stringify({ ...started(), v: 2 }), expect0)).toEqual({ state: null, reason: "corrupt" });
    expect(restorePlayerState(JSON.stringify({ ...started(), name: "x" }), expect0)).toEqual({ state: null, reason: "corrupt" });
  });

  // Review fix 9: a finished run waits for its save, however old.
  it("never expires a finished, unsaved run", () => {
    const done = finish(started(), steps, T0 + s(30));
    expect(restorePlayerState(serializePlayerState(done), { ...expect0, now: T0 + 25 * 3600_000 })).toEqual({ state: done });
  });

  it("refuses another session, an expired run, and reports a changed workout", () => {
    const raw = serializePlayerState(started());
    expect(restorePlayerState(raw, { ...expect0, plannedSessionId: 8 })).toMatchObject({ state: null, reason: "other_session" });
    expect(restorePlayerState(raw, { ...expect0, now: T0 + PLAYER_TTL_MS + 1 })).toEqual({ state: null, reason: "expired" });
    const changed = restorePlayerState(raw, { ...expect0, workoutHash: "deadbeef" });
    expect(changed).toMatchObject({ state: null, reason: "workout_changed" });
    expect("stored" in changed && changed.stored?.clientKey).toBe("k1");
  });
});
