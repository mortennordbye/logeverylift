// @vitest-environment jsdom
import type { AnswerSession } from "@/components/features/answer-session";
import { DidYouDoItCard } from "@/components/features/DidYouDoIt";
import { parseDuration } from "@/components/features/SessionAnswers";
import type { Units } from "@/lib/utils/units";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The home card "Did you do these?" (docs/plans/workouts-and-compliance.md,
 * 6.5, 6.6 and 7): Yes logs the session through the sheet, Missed stores the
 * answer, a missed key session offers its suggested day, and a failed answer
 * leaves the row.
 */

const confirmPlannedDone = vi.fn();
const manageIllness = vi.fn();
vi.mock("@/lib/actions/workouts-compliance", () => ({
  confirmPlannedDone: (...a: unknown[]) => confirmPlannedDone(...a),
  manageIllness: (...a: unknown[]) => manageIllness(...a),
}));
const updatePlannedSession = vi.fn();
vi.mock("@/lib/actions/planned-sessions", () => ({
  updatePlannedSession: (...a: unknown[]) => updatePlannedSession(...a),
}));
// callAction passes the result through, and records the call it wrapped.
const callAction = vi.fn();
vi.mock("@/lib/utils/stale-bundle", () => ({ callAction: (p: Promise<unknown>) => callAction(p) }));
let units: Units = { distance: "km", swim: "m" };
vi.mock("@/contexts/user-settings-context", () => ({ useUnits: () => units }));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const run: AnswerSession = { id: 7, date: "2026-11-12", name: "Easy run", summary: "45 min easy", sport: "run" };
const swim: AnswerSession = { id: 8, date: "2026-11-11", name: "Swim drills", summary: null, sport: "swim" };

beforeEach(() => {
  units = { distance: "km", swim: "m" };
  confirmPlannedDone.mockReset().mockResolvedValue({ success: true, data: { sessionId: 99 } });
  manageIllness.mockReset().mockResolvedValue({ success: true, data: { id: 3 } });
  updatePlannedSession.mockReset().mockResolvedValue({ success: true, data: { id: 7, date: "2026-11-12", status: "missed" } });
  callAction.mockReset().mockImplementation((p: Promise<unknown>) => p);
  refresh.mockReset();
});

const rows = () => screen.queryAllByTestId("unconfirmed-session");

describe("DidYouDoItCard", () => {
  it("lists each session with Yes and Missed", () => {
    render(<DidYouDoItCard unconfirmed={[run, swim]} missedKey={[]} today="2026-11-13" />);
    expect(rows().map((r) => r.textContent)).toEqual([expect.stringContaining("Easy run"), expect.stringContaining("Swim drills")]);
    expect(within(rows()[0]).getByText("Thu 12 Nov · 45 min easy")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Yes, I did Easy run" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "I missed Swim drills" })).toBeTruthy();
  });

  it("Yes opens the sheet and saves the time, distance and RPE through callAction", async () => {
    units = { distance: "mi", swim: "m" };
    render(<DidYouDoItCard unconfirmed={[run]} missedKey={[]} today="2026-11-13" />);
    fireEvent.click(screen.getByRole("button", { name: "Yes, I did Easy run" }));
    const sheet = screen.getByTestId("confirm-done-sheet");
    expect(within(sheet).getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
    fireEvent.change(within(sheet).getByLabelText("Time"), { target: { value: "45" } });
    expect(within(sheet).getByText("Distance in mi (optional)")).toBeTruthy();
    fireEvent.change(within(sheet).getByLabelText("Distance"), { target: { value: "5" } });
    fireEvent.click(within(sheet).getByRole("radio", { name: "RPE 4" }));
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    });
    expect(confirmPlannedDone).toHaveBeenCalledWith({ plannedSessionId: 7, durationSeconds: 2700, distanceMeters: 8047, rpe: 4, notes: null });
    expect(callAction).toHaveBeenCalledWith(confirmPlannedDone.mock.results[0].value);
    expect(refresh).toHaveBeenCalled();
    expect(rows()).toHaveLength(0);
  });

  it("I was sick opens the sick-period sheet with the session's day as the first day", async () => {
    render(<DidYouDoItCard unconfirmed={[run]} missedKey={[]} today="2026-11-13" />);
    fireEvent.click(screen.getByRole("button", { name: "Yes, I did Easy run" }));
    fireEvent.click(screen.getByRole("button", { name: "I was sick" }));
    const sheet = await screen.findByTestId("illness-sheet");
    expect((within(sheet).getByLabelText("First sick day") as HTMLInputElement).value).toBe("2026-11-12");
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Save sick period" }));
    });
    expect(manageIllness).toHaveBeenCalledWith({ op: "add", startedOn: "2026-11-12", endedOn: null, severity: null, notes: null });
    expect(refresh).toHaveBeenCalled();
  });

  it("Missed stores the answer and removes the row", async () => {
    render(<DidYouDoItCard unconfirmed={[run, swim]} missedKey={[]} today="2026-11-13" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "I missed Easy run" }));
    });
    expect(updatePlannedSession).toHaveBeenCalledWith({ op: "miss", id: 7 });
    expect(callAction).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalled();
    expect(rows().map((r) => r.textContent)).toEqual([expect.stringContaining("Swim drills")]);
  });

  it("a failed answer shows the error and leaves the row", async () => {
    updatePlannedSession.mockResolvedValue({ success: false, error: "Session not found" });
    confirmPlannedDone.mockResolvedValue({ success: false, error: "This session is already done." });
    render(<DidYouDoItCard unconfirmed={[run]} missedKey={[]} today="2026-11-13" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "I missed Easy run" }));
    });
    expect(within(rows()[0]).getByRole("alert").textContent).toBe("Session not found");

    fireEvent.click(screen.getByRole("button", { name: "Yes, I did Easy run" }));
    const sheet = screen.getByTestId("confirm-done-sheet");
    fireEvent.change(within(sheet).getByLabelText("Time"), { target: { value: "1:05" } });
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    });
    expect(confirmPlannedDone).toHaveBeenCalledWith(expect.objectContaining({ durationSeconds: 3900 }));
    expect(within(sheet).getByRole("alert").textContent).toBe("This session is already done.");
    expect(rows()).toHaveLength(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("a missed key session shows Move to its suggested day, which moves it", async () => {
    render(
      <DidYouDoItCard
        unconfirmed={[]}
        missedKey={[
          { session: { ...run, id: 11, name: "Long run" }, moveTo: "2026-11-14", reason: null },
          { session: { ...run, id: 12, name: "Long ride" }, moveTo: null, reason: "No free day this week. Skip it and go on." },
        ]}
        today="2026-11-13"
      />,
    );
    const [first, second] = screen.getAllByTestId("missed-key-session");
    expect(within(second).getByText("No free day this week. Skip it and go on.")).toBeTruthy();
    expect(within(second).queryByRole("button")).toBeNull();
    await act(async () => {
      fireEvent.click(within(first).getByRole("button", { name: "Move to Sat 14 Nov" }));
    });
    expect(updatePlannedSession).toHaveBeenCalledWith({ op: "move", id: 11, date: "2026-11-14" });
    expect(refresh).toHaveBeenCalled();
  });

  it("renders nothing with no sessions to answer", () => {
    const { container } = render(<DidYouDoItCard unconfirmed={[]} missedKey={[]} today="2026-11-13" />);
    expect(container.innerHTML).toBe("");
  });
});

describe("parseDuration", () => {
  it("reads minutes or h:mm, and refuses the rest", () => {
    expect(parseDuration("45")).toBe(2700);
    expect(parseDuration(" 1:30 ")).toBe(5400);
    expect(parseDuration("0")).toBeNull();
    expect(parseDuration("1:75")).toBeNull();
    expect(parseDuration("45 min")).toBeNull();
    expect(parseDuration("1441")).toBeNull();
  });
});
