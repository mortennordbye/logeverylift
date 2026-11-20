// @vitest-environment jsdom
import { RunDone } from "@/components/features/run/RunDone";
import { isSubPage } from "@/components/features/account/pages";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/** The run exercise after its run (docs/plans/run-logger.md, section 5 "Run done / Run ended early", R15). */

const setRideEndReason = vi.fn(async (d: { reason: string | null }) => ({ success: true, data: { reason: d.reason } }));
vi.mock("@/lib/actions/rides", () => ({ setRideEndReason: (d: { reason: string | null }) => setRideEndReason(d) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn() }), usePathname: () => "/programs/1/workout/exercises/2" }));

const data = { rideId: 5, status: "ended_early" as const, doneLine: "Ended early 18:00 · Treadmill", kept: "Step 1 is saved", endReason: null };

describe("RunDone", () => {
  it("ended early: the reason chips save the reason, and Pain links to the page that holds the injury log", async () => {
    render(<RunDone programId={1} exerciseName="Run" data={data} doneHref="/" />);
    expect(screen.getByText("Run ended early")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start run" })).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Pain" }));
    });
    expect(setRideEndReason).toHaveBeenCalledWith({ rideId: 5, reason: "pain" });
    const href = screen.getByTestId("log-injury").getAttribute("href")!;
    const [, more, account, page] = href.split("/");
    expect([more, account]).toEqual(["more", "account"]);
    expect(isSubPage(page)).toBe(true);
  });

  it("a run that is done has no reason chips", () => {
    render(<RunDone programId={1} exerciseName="Run" data={{ ...data, status: "finished", doneLine: "Done 18:00 · Treadmill" }} doneHref="/" />);
    expect(screen.getByText("Run done")).toBeTruthy();
    expect(screen.queryByTestId("run-end-reason")).toBeNull();
  });
});
