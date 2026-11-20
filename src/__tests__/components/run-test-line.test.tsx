// @vitest-environment jsdom
import { RunTestLine } from "@/components/features/run/RunTestLine";
import type { RunTestResult, RunTestView } from "@/lib/utils/run-test";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** "New threshold pace 5:30 /km · LTHR 176 · Save" on the run summary (docs/plans/run-logger.md, 4.10). */

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const saveRunThreshold = vi.fn();
vi.mock("@/lib/actions/run-test", () => ({ saveRunThreshold: (d: unknown) => saveRunThreshold(d) }));

const result = (over: Partial<RunTestResult> = {}): RunTestResult => ({
  lthr: 176,
  hr20: 176,
  speed: 1000 / 330,
  meters30: 5455,
  checks: { noStops: true, evenPace: true, hrHigh: true, effort: true },
  valid: true,
  band: "save",
  ...over,
});
const view = (r: RunTestResult | null, over: Partial<RunTestView> = {}): RunTestView => ({ test: "30min", result: r, current: { lthr: 174, speed: 1000 / 335 }, saved: false, ...over });
const show = (v: RunTestView) => render(<RunTestLine rideId={7} test={v} />);
const saveButton = () => within(screen.getByTestId("summary-threshold")).getByRole("button", { name: "Save" });

beforeEach(() => {
  vi.clearAllMocks();
  saveRunThreshold.mockResolvedValue({ success: true, data: { lthr: 176, speed: 1000 / 330 } });
});

describe("RunTestLine", () => {
  it("shows the new pace and LTHR with Save, and Save sends only the run id", async () => {
    show(view(result()));
    const row = screen.getByTestId("summary-threshold");
    expect(row.textContent).toBe("New threshold pace 5:30 /km · LTHR 176Save");
    expect(row.textContent!.replace(/\d:\d/g, "")).not.toContain(":");
    expect(saveButton().className).toContain("text-primary");
    // A wrap never leaves the dot at the end of a line: it stays with LTHR.
    expect(screen.getByText("· LTHR 176").className).toContain("whitespace-nowrap");
    fireEvent.click(saveButton());
    await waitFor(() => expect(saveRunThreshold).toHaveBeenCalledWith({ rideId: 7 }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("LTHR only when the treadmill test had no belt tap", () => {
    show(view(result({ speed: null, meters30: null })));
    expect(screen.getByTestId("threshold-values").textContent).toBe("New LTHR 176");
  });

  it("6 to 10 bpm or 3 to 8% off: the current and new values side by side to choose", () => {
    show(view(result({ band: "choose" })));
    const compare = screen.getByTestId("threshold-compare");
    expect(compare.textContent).toBe("NowNew5:35 /kmLTHR 1745:30 /kmLTHR 176");
    expect(saveButton()).toBeTruthy();
  });

  it("further off: Run the test again in 4 weeks, and Save is not the default", () => {
    show(view(result({ band: "retest" })));
    expect(screen.getByTestId("threshold-retest").textContent).toBe("Far from your numbers now · Run the test again in 4 weeks");
    expect(saveButton().className).not.toContain("text-primary");
  });

  it("a failed check: Test may be invalid, and Save is not the default", () => {
    show(view(result({ valid: false, checks: { noStops: false, evenPace: true, hrHigh: null, effort: false } })));
    expect(screen.getByTestId("threshold-invalid").textContent).toBe("Test may be invalid · You stopped during the test · Effort was under 8");
    expect(saveButton().className).not.toContain("text-primary");
  });

  it("says Saved with no button once the rows are stored; nothing without a result", () => {
    const { unmount } = show(view(result(), { saved: true }));
    expect(screen.getByTestId("summary-threshold").textContent).toBe("New threshold pace 5:30 /km · LTHR 176Saved");
    expect(within(screen.getByTestId("summary-threshold")).queryByRole("button")).toBeNull();
    unmount();
    show(view(null));
    expect(screen.queryByTestId("summary-threshold")).toBeNull();
  });

  it("a refused save shows the reason and keeps Save", async () => {
    saveRunThreshold.mockResolvedValue({ success: false, error: "This run gives no threshold" });
    show(view(result()));
    fireEvent.click(saveButton());
    expect((await screen.findByRole("alert")).textContent).toBe("This run gives no threshold");
    expect(refresh).not.toHaveBeenCalled();
  });
});
