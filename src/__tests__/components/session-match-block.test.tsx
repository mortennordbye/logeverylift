// @vitest-environment jsdom
import { SessionMatchBlock } from "@/components/features/SessionMatchBlock";
import type { MatchBlockView } from "@/lib/utils/session-match";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** The match block and its Pick sheet (docs/plans/session-check.md, decisions 4 and 5). */

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const pickSessionActivity = vi.fn();
vi.mock("@/lib/actions/session-match", () => ({ pickSessionActivity: (d: unknown) => pickSessionActivity(d) }));

beforeEach(() => {
  refresh.mockReset();
  pickSessionActivity.mockReset();
});

const matched: MatchBlockView = {
  program: { href: "/programs/3", text: "1 General · Long ride" },
  logged: "In the app · ride mode",
  garmin: { kind: "matched", href: "/more/garmin/activity/9001", name: "Indoor Cycling", detail: "08:05 · 2 h 16 min", pickAnother: false },
  fill: "Numbers filled from Garmin · split by time",
  stepsHref: "/planned/7/check",
  candidates: [],
};

const unmatched: MatchBlockView = {
  program: { href: "/programs/3", text: "1 General · Run" },
  logged: null,
  garmin: { kind: "none", text: "Not matched · 2 runs that day", pick: true },
  fill: null,
  stepsHref: null,
  candidates: [
    { id: 11, name: "Morning Run", detail: "07:00 · 45 min · 8.0 km" },
    { id: 12, name: "Evening Run", detail: "18:00 · 10 min · 2.0 km" },
  ],
};

describe("SessionMatchBlock", () => {
  it("shows the match with its links, as in the picture", () => {
    render(<SessionMatchBlock plannedSessionId={7} view={matched} />);
    expect(screen.getByTestId("match-program").getAttribute("href")).toBe("/programs/3");
    expect(screen.getByTestId("match-program").textContent).toContain("1 General · Long ride");
    expect(screen.getByTestId("match-logged").textContent).toContain("In the app · ride mode");
    const g = screen.getByTestId("match-garmin");
    expect(g.getAttribute("href")).toBe("/more/garmin/activity/9001");
    expect(g.textContent).toContain("Indoor Cycling · 08:05 · 2 h 16 min");
    expect(screen.getByTestId("match-fill").textContent).toContain("Numbers filled from Garmin · split by time");
    expect(screen.getByRole("link", { name: "See every step ›" }).getAttribute("href")).toBe("/planned/7/check");
    expect(screen.queryByRole("button", { name: /Pick/ })).toBeNull();
  });

  it("Pick opens the day's activities, and choosing one stores it", async () => {
    pickSessionActivity.mockResolvedValue({ success: true, data: null });
    render(<SessionMatchBlock plannedSessionId={7} view={unmatched} />);
    expect(screen.getByTestId("match-garmin").textContent).toContain("Not matched · 2 runs that day");
    fireEvent.click(screen.getByRole("button", { name: "Pick ›" }));
    const list = await screen.findByTestId("match-candidates");
    expect(within(list).getAllByRole("button").map((b) => b.textContent)).toEqual(["Morning Run07:00 · 45 min · 8.0 km", "Evening Run18:00 · 10 min · 2.0 km"]);
    fireEvent.click(within(list).getByRole("button", { name: /Evening Run/ }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(pickSessionActivity).toHaveBeenCalledWith({ plannedSessionId: 7, activityId: 12 });
  });

  it("a refused pick shows why and keeps the sheet open", async () => {
    pickSessionActivity.mockResolvedValue({ success: false, error: "That activity is already matched to another session." });
    render(<SessionMatchBlock plannedSessionId={7} view={unmatched} />);
    fireEvent.click(screen.getByRole("button", { name: "Pick ›" }));
    fireEvent.click(within(await screen.findByTestId("match-candidates")).getByRole("button", { name: /Morning Run/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("That activity is already matched to another session.");
    expect(screen.getByTestId("match-candidates")).not.toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("a watch match offers Pick another", async () => {
    render(<SessionMatchBlock plannedSessionId={7} view={{ ...matched, logged: "On the watch", fill: null, garmin: { ...(matched.garmin as Extract<MatchBlockView["garmin"], { kind: "matched" }>), pickAnother: true }, candidates: unmatched.candidates }} />);
    expect(screen.queryByTestId("match-fill")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Pick another" }));
    expect(await screen.findByTestId("match-candidates")).not.toBeNull();
  });

  it("no Pick when there is nothing to pick", () => {
    render(<SessionMatchBlock plannedSessionId={7} view={{ ...unmatched, garmin: { kind: "none", text: "Not matched · no run that day", pick: false }, candidates: [] }} />);
    expect(screen.getByTestId("match-garmin").textContent).toContain("Not matched · no run that day");
    expect(screen.queryByRole("button", { name: "Pick ›" })).toBeNull();
  });
});
