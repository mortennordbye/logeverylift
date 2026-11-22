// @vitest-environment jsdom
import type { LastSessionData } from "@/lib/utils/last-session";
import { matchLine } from "@/lib/utils/last-session";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Last session (docs/plans/session-check.md, decision 9): one card per
 * session of the day, each with its match line, its metric rows and marks,
 * the time row and the link to the step page; the empty state; the line for
 * a user without Garmin; a failing load.
 */

const load = vi.fn();
vi.mock("@/components/features/home/widgets/last-session/load", () => ({ loadLastSession: (...a: unknown[]) => load(...a) }));

const { lastSessionWidget: w } = await import("@/components/features/home/widgets/last-session/View");
const { streamedContent } = await import("@/components/features/home/render-widget");

const ctx = { userId: "u1", role: "user", today: "2026-11-22" };

const DAY: LastSessionData = {
  cards: [
    {
      plannedSessionId: 11,
      title: "Long ride · Sun 22 Nov",
      match: "Matched to Garmin · Indoor Cycling · 2 h 16 min",
      rows: [
        { label: "Power", value: "150 W", plan: "plan 110-130", mark: "over" },
        { label: "Heart rate", value: "122", plan: "plan 107-135", mark: "in" },
        { label: "Cadence", value: "85 rpm", plan: "no target", mark: "none" },
      ],
      time: { label: "Time", value: "2:16", plan: "plan 2:15", mark: "in" },
      href: "/planned/11/check",
    },
    {
      plannedSessionId: 12,
      title: "Run off bike · Sun 22 Nov",
      match: "Logged in the app",
      rows: [
        { label: "Heart rate", value: "148", plan: "plan under 162", mark: "in" },
        { label: "Cadence", value: "152 spm", plan: "plan 155-165", mark: "under" },
        { label: "Pace", value: "5:59 /km", plan: "info", mark: "none" },
      ],
      time: { label: "Time", value: "20:00", plan: "plan 20:00", mark: "in" },
      href: "/planned/12/check",
    },
  ],
};

afterEach(cleanup);

describe("Last session", () => {
  it("shows one card per session, in order, each with its match line and rows", () => {
    render(<>{w.View({ data: DAY, size: "m" })}</>);
    const cards = screen.getAllByTestId("last-session");
    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getByText("Long ride · Sun 22 Nov")).toBeTruthy();
    expect(within(cards[0]).getByTestId("last-session-match").textContent).toBe("Matched to Garmin · Indoor Cycling · 2 h 16 min");
    expect(within(cards[0]).getAllByTestId("last-session-row").map((r) => r.textContent)).toEqual([
      "Power150 W · plan 110-130↑ over",
      "Heart rate122 · plan 107-135✓ in",
      "Cadence85 rpm · no target·",
      "Time2:16 · plan 2:15✓ in",
    ]);
    expect(within(cards[1]).getByText("Run off bike · Sun 22 Nov")).toBeTruthy();
    expect(within(cards[1]).getByText("5:59 /km")).toBeTruthy();
  });

  it("highlights only over and under", () => {
    render(<>{w.View({ data: DAY, size: "m" })}</>);
    const marks = screen.getAllByTestId("check-mark");
    for (const m of marks) {
      const out = m.dataset.mark === "over" || m.dataset.mark === "under";
      expect(m.className.includes("bg-primary"), m.dataset.mark).toBe(out);
    }
    expect(marks.filter((m) => m.className.includes("bg-primary")).map((m) => m.textContent)).toEqual(["↑ over", "↓ under"]);
  });

  it("links each card to its step page, a 44 px tap target", () => {
    render(<>{w.View({ data: DAY, size: "m" })}</>);
    const links = screen.getAllByRole("link", { name: "See every step ›" });
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/planned/11/check", "/planned/12/check"]);
    for (const l of links) expect(l.className).toContain("min-h-11");
  });

  it("shows no link when the session has no steps", () => {
    render(<>{w.View({ data: { cards: [{ ...DAY.cards[0], href: null }] }, size: "m" })}</>);
    expect(screen.queryByRole("link", { name: "See every step ›" })).toBeNull();
  });

  it("says how it was logged when there is no Garmin match", () => {
    expect(matchLine({ garmin: null, logged: "app_ride", sport: "bike" })).toBe("Logged in the app");
    expect(matchLine(null)).toBe("Logged in the app");
    expect(matchLine({ garmin: null, logged: "watch", sport: "run" })).toBe("Logged on the watch");
    expect(
      matchLine({
        garmin: { id: 1, activityId: 9, name: "Oslo Running", startTime: "2026-11-22T10:00:00.000Z", durationSeconds: 1200, distanceMeters: 3300, fill: null },
        logged: "watch",
        sport: "run",
      }),
    ).toBe("Matched to Garmin · Oslo Running · 20 min · 3.3 km");
  });

  it("shows the empty state when there is no session", async () => {
    load.mockResolvedValueOnce(null);
    render(<>{await streamedContent("lastSession", w, ctx, "m")}</>);
    expect(screen.getByText("No bike or run session done in the last 2 weeks.")).toBeTruthy();
    expect(screen.getByTestId("last-session").getAttribute("href")).toBe("/history");
  });

  it("a failing load shows the error state", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    load.mockRejectedValueOnce(new Error("boom"));
    render(<>{await streamedContent("lastSession", w, ctx, "m")}</>);
    expect(screen.getByTestId("widget-error")).toBeTruthy();
  });

  it("copy has no colons", () => {
    const { container } = render(<>{w.View({ data: DAY, size: "m" })}</>);
    // Times like 2:16 and 5:59 are numbers, not copy.
    expect(container.textContent!.replace(/\d:\d\d/g, "")).not.toContain(":");
  });
});
