// @vitest-environment jsdom
import { ReadinessSwapCard, type ReadinessSwapView } from "@/components/features/ReadinessSwapCard";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The readiness swap card on home (docs/plans/limits-strength-readiness.md,
 * section 5): it shows the reason, the tap goes through callAction with the
 * session id only, a success refreshes the page, and a failure leaves the
 * card with the error.
 */

const makeSessionEasy = vi.fn();
vi.mock("@/lib/actions/readiness", () => ({ makeSessionEasy: (...a: unknown[]) => makeSessionEasy(...a) }));
const callAction = vi.fn();
vi.mock("@/lib/utils/stale-bundle", () => ({ callAction: (p: Promise<unknown>) => callAction(p) }));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const swap: ReadinessSwapView = {
  sessionId: 42,
  label: "Threshold ride",
  minutes: 50,
  text: 'Low readiness today: HRV 7-day mean 48 ms is below your band (52-68) for 2 days and resting HR is 6 bpm over your normal 50. Make "Threshold ride" an easy 50 min zone 2 session?',
};

beforeEach(() => {
  makeSessionEasy.mockReset().mockResolvedValue({ success: true, data: { id: 42 } });
  callAction.mockReset().mockImplementation((p: Promise<unknown>) => p);
  refresh.mockReset();
});

describe("ReadinessSwapCard", () => {
  it("shows the reason and one button", () => {
    render(<ReadinessSwapCard swap={swap} />);
    expect(screen.getByTestId("readiness-swap").textContent).toContain("HRV 7-day mean 48 ms is below your band (52-68)");
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("applies through callAction with the session id only, then refreshes", async () => {
    render(<ReadinessSwapCard swap={swap} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Make it easy" }));
    });
    expect(makeSessionEasy).toHaveBeenCalledWith({ plannedSessionId: 42 });
    expect(callAction).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps the card and shows the error when the action fails", async () => {
    makeSessionEasy.mockResolvedValue({ success: false, error: "Readiness changed: there is no swap to make for this session now." });
    render(<ReadinessSwapCard swap={swap} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Make it easy" }));
    });
    expect(screen.getByRole("alert").textContent).toBe("Readiness changed: there is no swap to make for this session now.");
    expect(screen.getByRole("button", { name: "Make it easy" })).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });
});
