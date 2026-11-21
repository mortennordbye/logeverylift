// @vitest-environment jsdom
import { RunEndReason } from "@/components/features/run/RunEndReason";
import { isSubPage } from "@/components/features/account/pages";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/** Why a run ended early (docs/plans/run-logger.md, section 5 "Run ended early", R15). */

const setRideEndReason = vi.fn(async (d: { reason: string | null }) => ({ success: true, data: { reason: d.reason } }));
vi.mock("@/lib/actions/rides", () => ({ setRideEndReason: (d: { reason: string | null }) => setRideEndReason(d) }));

describe("RunEndReason", () => {
  it("says which steps are saved; the chips save the reason, a second tap clears it, and Pain links to the page that holds the injury log", async () => {
    render(<RunEndReason rideId={5} kept="Step 1 is saved" endReason={null} />);
    expect(screen.getByTestId("run-kept").textContent).toBe("Step 1 is saved");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Pain" }));
    });
    expect(setRideEndReason).toHaveBeenLastCalledWith({ rideId: 5, reason: "pain" });
    const href = screen.getByTestId("log-injury").getAttribute("href")!;
    const [, more, account, page] = href.split("/");
    expect([more, account]).toEqual(["more", "account"]);
    expect(isSubPage(page)).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Pain" }));
    });
    expect(setRideEndReason).toHaveBeenLastCalledWith({ rideId: 5, reason: null });
    expect(screen.queryByTestId("log-injury")).toBeNull();
  });
});
