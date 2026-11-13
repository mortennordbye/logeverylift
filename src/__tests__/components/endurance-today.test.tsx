// @vitest-environment jsdom
import { EnduranceTodayCard, type EnduranceTodayRow } from "@/components/features/guided/EnduranceTodayCard";
import { PLAYER_STORAGE_KEY } from "@/lib/utils/workout-player";
import { act, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

/** Today's structured sessions on home (docs/plans/endurance-app.md, 4.1). */

const ride: EnduranceTodayRow = { id: 41, name: "Sweet spot", sport: "bike", summary: "3 × 10 min 88-93% FTP", amount: "60 min", done: false };
const swim: EnduranceTodayRow = { id: 42, name: "10 × 100", sport: "swim", summary: null, amount: "2.4 km", done: false };

beforeEach(() => localStorage.clear());

describe("EnduranceTodayCard", () => {
  it("renders nothing with no sessions, so a lifter's home does not change", () => {
    const { container } = render(<EnduranceTodayCard rows={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("offers the guided player for a ride and the pool view for a swim", () => {
    render(<EnduranceTodayCard rows={[ride, swim]} />);
    const [r, s] = screen.getAllByTestId("endurance-today-row");
    expect(within(r).getByRole("link", { name: "Start guided" }).getAttribute("href")).toBe("/planned/41/play");
    expect(within(r).getByText("3 × 10 min 88-93% FTP · 60 min")).toBeTruthy();
    expect(within(s).getByRole("link", { name: "Pool view" }).getAttribute("href")).toBe("/planned/42/pool");
  });

  it("a done session links to its results", () => {
    render(<EnduranceTodayCard rows={[{ ...ride, done: true }]} />);
    expect(screen.getByRole("link", { name: "Results" }).getAttribute("href")).toBe("/planned/41/results");
    expect(screen.queryByRole("link", { name: "Start guided" })).toBeNull();
  });

  it("shows Resume for a run saved on this phone, after mount", async () => {
    localStorage.setItem(PLAYER_STORAGE_KEY, JSON.stringify({ plannedSessionId: 41, status: "paused" }));
    render(<EnduranceTodayCard rows={[ride]} />);
    await act(async () => {});
    expect(screen.getByTestId("saved-run").textContent).toBe("Resume");
  });
});
