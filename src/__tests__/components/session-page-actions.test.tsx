// @vitest-environment jsdom
import { SessionPageActions, type SessionPageSession } from "@/components/features/PlannedSessionActions";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The session page's Edit, Move, Skip and menu (docs/plans/bike-sessions.md,
 * 5.3, parity): each control calls the op the assistant has over MCP.
 */

const updatePlannedSession = vi.fn();
const sessionMenuOp = vi.fn();
vi.mock("@/lib/actions/planned-sessions", () => ({ updatePlannedSession: (...a: unknown[]) => updatePlannedSession(...a) }));
vi.mock("@/lib/actions/workout-editor", () => ({ sessionMenuOp: (...a: unknown[]) => sessionMenuOp(...a) }));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const base: SessionPageSession = { id: 7, date: "2026-11-10", status: "planned", priority: null, fromLibrary: true, started: false };

beforeEach(() => {
  updatePlannedSession.mockReset().mockResolvedValue({ success: true, data: { id: 7 } });
  sessionMenuOp.mockReset().mockResolvedValue({ success: true, data: { id: 7 } });
  refresh.mockReset();
});

describe("SessionPageActions", () => {
  it("links Edit to the editor, and moves and skips through the session op", async () => {
    render(<SessionPageActions session={base} today="2026-11-05" lastDay="2026-11-29" />);
    expect(screen.getByRole("link", { name: "Edit" }).getAttribute("href")).toBe("/planned/7/edit");
    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    fireEvent.change(screen.getByLabelText("New day"), { target: { value: "2026-11-12" } });
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Move" })[1]);
    });
    expect(updatePlannedSession).toHaveBeenCalledWith({ op: "move", id: 7, date: "2026-11-12" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    });
    expect(updatePlannedSession).toHaveBeenCalledWith({ op: "skip", id: 7 });
  });

  it("sets the priority and pulls the library copy from the menu", async () => {
    render(<SessionPageActions session={base} today="2026-11-05" lastDay="2026-11-29" />);
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Key" }));
    });
    expect(sessionMenuOp).toHaveBeenCalledWith({ op: "set_priority", id: 7, priority: "key" });
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Update from library/ }));
    });
    expect(sessionMenuOp).toHaveBeenCalledWith({ op: "update_from_library", id: 7 });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("offers Not missed on a missed session, and nothing on a done or started one", async () => {
    const { rerender } = render(<SessionPageActions session={{ ...base, date: "2026-11-03", status: "missed", fromLibrary: false }} today="2026-11-05" lastDay="2026-11-29" />);
    expect(screen.queryByRole("link", { name: "Edit" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(screen.queryByRole("button", { name: /Update from library/ })).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Not missed/ }));
    });
    expect(sessionMenuOp).toHaveBeenCalledWith({ op: "unmiss", id: 7 });
    rerender(<SessionPageActions session={{ ...base, status: "done" }} today="2026-11-05" lastDay="2026-11-29" />);
    expect(screen.queryByTestId("session-actions")).toBeNull();
    rerender(<SessionPageActions session={{ ...base, started: true }} today="2026-11-05" lastDay="2026-11-29" />);
    expect(screen.queryByTestId("session-actions")).toBeNull();
  });
});
