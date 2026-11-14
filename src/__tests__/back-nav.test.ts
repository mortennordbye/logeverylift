import { describe, expect, it } from "vitest";
import { backLabelFor, resolveBack, returnsByPop } from "@/lib/utils/back-nav";

const MORE = { href: "/more", label: "More" };

describe("backLabelFor", () => {
  it.each([
    ["/", "Home"],
    ["/more", "More"],
    ["/history", "History"],
    ["/history/12", "Session"],
    ["/more/metrics", "Progress"],
    ["/more/metrics?tab=records", "Progress"],
    ["/more/calendar", "Calendar"],
    ["/exercises", "Exercises"],
    ["/exercises/4", "Exercise"],
    ["/more/friends", "Friends"],
    ["/more/friends/abc-123", "Profile"],
    ["/week?w=2026-11-09", "Week"],
    ["/planned/7", "Session"],
    ["/cycles", "Cycles"],
    ["/cycles/3", "Cycle"],
    ["/seasons/2", "Season"],
    ["/programs", "Programs"],
    ["/programs/5", "Program"],
    ["/programs/5?editing=true", "Program"],
    ["/programs/5/workout", "Workout"],
    ["/programs/5/workout/exercises/9", "Sets"],
    ["/programs/5/exercises/9?edit=true", "Sets"],
    ["/more/garmin?tab=day", "Garmin"],
    ["/more/garmin/activity/8", "Activity"],
    ["/settings", "Settings"],
    ["/more/account", "Account"],
    ["/more/gyms", "Gym map"],
    ["/more/assistants", "Connected assistants"],
    ["/more/athlete", "Athlete profile"],
    ["/more/admin", "Admin"],
    ["/more/thresholds", "Thresholds"],
    ["/more/nutrition", "Nutrition"],
    ["/more/workouts", "Workouts"],
    ["/more/friends/search", "Add friends"],
    ["/more/friends/shared-programs", "Shared programs"],
    ["/more/friends/abc/sessions/4", "Workout"],
    ["/more/feedback", "Feedback"],
    ["/more/coach-memory", "Coach memory"],
    ["/more/ai-setup", "AI setup"],
    ["/more/install", "Add to iPhone"],
    ["/more/assistants/changes", "Assistant changes"],
    ["/more/admin/users", "Admin"],
    ["/cycles/3/history", "History"],
    ["/programs/5/history", "History"],
    ["/seasons/2/history", "History"],
    ["/planned/7/pool", "Pool view"],
    ["/privacy", "Privacy"],
    ["/terms", "Terms"],
    ["/new-workout", "New workout"],
  ])("%s is %s", (path, label) => {
    expect(backLabelFor(path)).toBe(label);
  });

  it("has no label for a route it does not know", () => {
    expect(backLabelFor("/more/unknown-page")).toBeNull();
    expect(backLabelFor("/programs/5/history/extra")).toBeNull();
  });
});

describe("resolveBack", () => {
  it("links to the fallback when there is no previous in-app page", () => {
    // Cold start, a pasted URL, the login redirect: a full page load.
    expect(resolveBack(null, "/more/metrics", MORE)).toEqual({ kind: "link", href: "/more", label: "More" });
  });

  it("pops to the previous page and names it", () => {
    expect(resolveBack("/", "/more/metrics", MORE)).toEqual({ kind: "pop", label: "Home" });
    expect(resolveBack("/history", "/history/12", { href: "/history", label: "History" })).toEqual({ kind: "pop", label: "History" });
  });

  it("keeps the fallback's own label when Back goes to the fallback", () => {
    // A friend's name or a plan name says more than the route noun.
    const parent = { href: "/more/friends/abc", label: "Ada" };
    expect(resolveBack("/more/friends/abc", "/more/friends/abc/sessions/4", parent)).toEqual({ kind: "pop", label: "Ada" });
    expect(resolveBack("/more/garmin?tab=activities", "/more/garmin/activity/8", { href: "/more/garmin?tab=activities", label: "Activities" })).toEqual({
      kind: "pop",
      label: "Activities",
    });
  });

  it("names the page it pops to when only the path matches the fallback", () => {
    // Opened from the Overview tab, Back returns to Overview, so it must not say "Activities".
    expect(resolveBack("/more/garmin?tab=overview", "/more/garmin/activity/8", { href: "/more/garmin?tab=activities", label: "Activities" })).toEqual({
      kind: "pop",
      label: "Garmin",
    });
  });

  it("says Back for a previous page it has no name for", () => {
    expect(resolveBack("/more/unknown-page", "/more/metrics", MORE)).toEqual({ kind: "pop", label: "Back" });
  });

  it.each(["/login", "/login?from=/more", "/signup", "/welcome?ref=x", "/consent", "/oauth/consent"])(
    "does not go back to %s",
    (prev) => {
      expect(resolveBack(prev, "/more/metrics", MORE)).toEqual({ kind: "link", href: "/more", label: "More" });
    },
  );

  it.each([
    "/cycles/new",
    "/seasons/new",
    "/cycles/3/edit",
    "/seasons/2/edit",
    "/programs/5/workout/finish?start=x",
    "/programs/5/add-exercise",
    "/programs/5/workout/add-exercise",
    "/programs/5/workout/exercises/9/sets/new",
    "/programs/5/exercises/9/sets/44",
    "/more/athlete/interview",
    "/planned/7/play",
    "/cycles/triathlon",
  ])("does not go back into the form %s", (prev) => {
    expect(resolveBack(prev, "/cycles/3", { href: "/cycles", label: "Cycles" }).kind).toBe("link");
  });

  it("does not pop to the page it is on", () => {
    // A replace keeps the entry's tag, so a page can be tagged with itself.
    expect(resolveBack("/cycles/3", "/cycles/3", { href: "/cycles", label: "Cycles" }).kind).toBe("link");
    expect(resolveBack("/cycles/3?x=1", "/cycles/3", { href: "/cycles", label: "Cycles" }).kind).toBe("link");
  });

  it("ignores anything that is not an app path", () => {
    expect(resolveBack("https://evil.example/", "/more/metrics", MORE).kind).toBe("link");
    expect(resolveBack("//evil.example/x", "/more/metrics", MORE).kind).toBe("link");
    expect(resolveBack("", "/more/metrics", MORE).kind).toBe("link");
  });
});

describe("returnsByPop", () => {
  it("pops when the page before is the target, so no duplicate entry is left", () => {
    expect(returnsByPop("/seasons/2", "/seasons/2")).toBe(true);
    expect(returnsByPop("/programs/5/workout?planned=3", "/programs/5/workout")).toBe(true);
  });

  it("replaces otherwise", () => {
    expect(returnsByPop(null, "/seasons/2")).toBe(false);
    expect(returnsByPop("/cycles", "/seasons/2")).toBe(false);
    expect(returnsByPop("//evil.example/seasons/2", "/seasons/2")).toBe(false);
  });
});
