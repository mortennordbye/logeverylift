import { activityText, lengthText, loggedOf, matchBlockView, sessionCheckHref, type SessionMatch } from "@/lib/utils/session-match";
import { describe, expect, it } from "vitest";

/** The match block's words (docs/plans/session-check.md, decisions 4 and 5). */

const act = (id: number, over: Partial<SessionMatch["candidates"][number]> = {}) => ({
  id,
  activityId: 9000 + id,
  name: `Run ${id}`,
  startTime: "2026-11-22T08:05:00.000Z",
  durationSeconds: 8160,
  distanceMeters: 7800,
  ...over,
});

const base: SessionMatch = {
  plannedSessionId: 7,
  date: "2026-11-22",
  sport: "bike",
  state: "done",
  matchedBy: "link",
  program: { id: 3, name: "Long ride", cycleName: "1 General" },
  logged: "app_ride",
  garmin: { ...act(1, { name: "Indoor Cycling" }), fill: "time" },
  candidates: [],
  canPick: false,
};

describe("loggedOf", () => {
  it("names the app's ride or run mode, a plain workout, or the watch", () => {
    expect(loggedOf("link", ["bike"], "bike")).toBe("app_ride");
    expect(loggedOf("app", ["run"], "run")).toBe("app_run");
    // A brick workout: the ride of the session's own sport.
    expect(loggedOf("link", ["bike", "run"], "run")).toBe("app_run");
    expect(loggedOf("app", [], "run")).toBe("app_workout");
    expect(loggedOf("pick", [], "run")).toBe("watch");
    expect(loggedOf("garmin", [], "bike")).toBe("watch");
    expect(loggedOf(null, ["bike"], "bike")).toBeNull();
  });
});

describe("words", () => {
  it("lengths and activity lines", () => {
    expect(lengthText(2700)).toBe("45 min");
    expect(lengthText(8160)).toBe("2 h 16 min");
    expect(activityText(act(1))).toBe("08:05 · 2 h 16 min · 7.8 km");
    expect(activityText(act(1, { durationSeconds: null, distanceMeters: null }))).toBe("08:05");
    expect(sessionCheckHref(7)).toBe("/planned/7/check");
  });
});

describe("matchBlockView", () => {
  it("a ride the app logged and Garmin filled, as in the picture", () => {
    expect(matchBlockView(base, true)).toEqual({
      program: { href: "/programs/3", text: "1 General · Long ride" },
      logged: "In the app · ride mode",
      garmin: { kind: "matched", href: "/more/garmin/activity/9001", name: "Indoor Cycling", detail: "08:05 · 2 h 16 min", pickAnother: false },
      fill: "Numbers filled from Garmin · split by time",
      stepsHref: "/planned/7/check",
      candidates: [],
    });
  });

  it("not matched: the count of the day's activities and Pick", () => {
    const none: SessionMatch = { ...base, sport: "run", state: "unconfirmed", matchedBy: null, logged: null, garmin: null, canPick: true, candidates: [act(2)] };
    const v = matchBlockView(none, true);
    expect(v.garmin).toEqual({ kind: "none", text: "Not matched · 1 run that day", pick: true });
    expect(v.stepsHref).toBeNull();
    expect(v.candidates).toEqual([{ id: 2, name: "Run 2", detail: "08:05 · 2 h 16 min · 7.8 km" }]);
    expect(matchBlockView({ ...none, candidates: [act(2), act(3)] }, true).garmin).toMatchObject({ text: "Not matched · 2 runs that day" });
    expect(matchBlockView({ ...none, candidates: [] }, true).garmin).toEqual({ kind: "none", text: "Not matched · no run that day", pick: false });
  });

  it("a watch match offers Pick another only with another activity to pick", () => {
    const watch: SessionMatch = { ...base, matchedBy: "garmin", logged: "watch", garmin: { ...act(1), fill: null }, canPick: true, candidates: [act(1)] };
    expect(matchBlockView(watch, true).garmin).toMatchObject({ kind: "matched", pickAnother: false });
    const two = matchBlockView({ ...watch, candidates: [act(1), act(4)] }, true);
    expect(two.garmin).toMatchObject({ pickAnother: true });
    expect(two.candidates.map((c) => c.id)).toEqual([4]);
    expect(two.fill).toBeNull();
    expect(two.logged).toBe("On the watch");
  });

  it("an app workout with no activity says not matched, with no Pick", () => {
    const v = matchBlockView({ ...base, logged: "app_workout", garmin: null, candidates: [act(2)] }, true);
    expect(v.garmin).toEqual({ kind: "none", text: "Not matched · 1 ride that day", pick: false });
  });

  it("no Garmin parts without Garmin", () => {
    const v = matchBlockView({ ...base, canPick: true, candidates: [act(2)] }, false);
    expect(v.garmin).toBeNull();
    expect(v.fill).toBeNull();
    expect(v.candidates).toEqual([]);
    expect(v.logged).toBe("In the app · ride mode");
  });

  it("a session still to come shows the program only", () => {
    const v = matchBlockView({ ...base, state: "planned", matchedBy: null, logged: null, garmin: null }, true);
    expect(v).toMatchObject({ logged: null, garmin: null, fill: null, stepsHref: null });
    expect(v.program).not.toBeNull();
  });
});
