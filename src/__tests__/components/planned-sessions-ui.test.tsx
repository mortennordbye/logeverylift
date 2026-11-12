// @vitest-environment jsdom
import { PlannedSessionActions } from "@/components/features/PlannedSessionActions";
import { TodaySessionsList } from "@/components/features/TodaySessionsList";
import type { TodaySession } from "@/types/workout";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The home card's list for a day with several sessions, and the calendar's
 * Move and Skip (docs/plans/sessions.md, 5).
 */

const updatePlannedSession = vi.fn();
vi.mock("@/lib/actions/planned-sessions", () => ({
  updatePlannedSession: (...a: unknown[]) => updatePlannedSession(...a),
}));
vi.mock("@/lib/actions/training-cycles", () => ({ skipAutoCompletedDay: vi.fn() }));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

beforeEach(() => {
  updatePlannedSession.mockReset();
  updatePlannedSession.mockResolvedValue({ success: true, data: { id: 1, date: "2026-11-06", status: "planned" } });
  refresh.mockReset();
});

const session = (id: number, programId: number, name: string, done: boolean, autoSessionId: number | null = null): TodaySession => ({
  plannedSessionId: id,
  done,
  autoSessionId,
  slot: {
    id,
    trainingCycleId: 1,
    dayOfWeek: 4,
    orderIndex: null,
    daySlot: id,
    label: null,
    notes: null,
    autoComplete: autoSessionId != null,
    programId,
    program: { id: programId, name } as TodaySession["slot"]["program"],
  },
});

describe("TodaySessionsList", () => {
  it("lists each session with its own Start link carrying the planned session", () => {
    render(<TodaySessionsList sessions={[session(1, 10, "Strength", false), session(2, 20, "Easy run", true, 99)]} />);
    const rows = screen.getAllByTestId("today-session");
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining("Strength"), expect.stringContaining("Easy run")]);
    expect(screen.getByRole("link", { name: "Start Strength" }).getAttribute("href")).toBe("/programs/10/workout?planned=1");
    expect(screen.getByRole("link", { name: "Do again Easy run" }).getAttribute("href")).toBe("/programs/20/workout?planned=2");
    expect(screen.getByText("Done · automatic")).toBeTruthy();
    expect(screen.getByRole("button", { name: "I skipped it" })).toBeTruthy();
  });
});

describe("PlannedSessionActions", () => {
  const base = { id: 5, date: "2026-11-09", status: "planned" as const, touched: false, templateDate: "2026-11-09" };

  it("moves a session to the picked day through the action", async () => {
    render(<PlannedSessionActions session={base} today="2026-11-05" lastDay="2026-11-29" name="Strength" />);
    fireEvent.click(screen.getByRole("button", { name: "Move Strength" }));
    fireEvent.change(screen.getByLabelText("New day for Strength"), { target: { value: "2026-11-11" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    expect(updatePlannedSession).toHaveBeenCalledWith({ op: "move", id: 5, date: "2026-11-11" });
    expect(refresh).toHaveBeenCalled();
  });

  it("skips, and shows the server's refusal", async () => {
    updatePlannedSession.mockResolvedValue({ success: false, error: "This session is logged; past sessions do not change." });
    render(<PlannedSessionActions session={base} today="2026-11-05" lastDay="2026-11-29" name="Strength" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Skip Strength" }));
    });
    expect(updatePlannedSession).toHaveBeenCalledWith({ op: "skip", id: 5 });
    expect(screen.getByRole("alert").textContent).toBe("This session is logged; past sessions do not change.");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("offers nothing for a logged session, and plan again and reset for a skipped, moved one", () => {
    const { rerender } = render(<PlannedSessionActions session={{ ...base, status: "done" }} today="2026-11-05" lastDay="2026-11-29" name="Strength" />);
    expect(screen.queryAllByRole("button")).toEqual([]);
    rerender(<PlannedSessionActions session={{ ...base, status: "skipped", touched: true }} today="2026-11-05" lastDay="2026-11-29" name="Strength" />);
    expect(screen.getByRole("button", { name: "Plan Strength again" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back to the template" })).toBeTruthy();
  });
});
