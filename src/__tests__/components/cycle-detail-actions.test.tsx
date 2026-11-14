// @vitest-environment jsdom
import { DeleteCycleButton, RestartCycleButton, StartCycleButton } from "@/components/features/CycleDetailClient";
import { CycleScheduleBuilder } from "@/components/features/CycleScheduleBuilder";
import { deleteTrainingCycle, removeCycleSlot, restartTrainingCycle, startTrainingCycle } from "@/lib/actions/training-cycles";
import type { TrainingCycle, TrainingCycleWithSlots } from "@/types/workout";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** The cycle page's actions show a refused write, and starting a later season phase asks first. */

const openWorkout = "A workout from this cycle is still open. Finish or discard it first.";
vi.mock("@/lib/actions/training-cycles", () => ({
  deleteTrainingCycle: vi.fn(),
  restartTrainingCycle: vi.fn(),
  startTrainingCycle: vi.fn(),
  removeCycleSlot: vi.fn(),
  reorderCycleSlots: vi.fn(),
  upsertCycleSlot: vi.fn(),
}));
const returnTo = vi.fn();
vi.mock("@/components/ui/BackLink", () => ({ useReturnTo: () => returnTo }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }) }));

const cycle = { id: 3, name: "Build", status: "draft", scheduleType: "rotation" } as unknown as TrainingCycle;

beforeEach(() => {
  vi.mocked(deleteTrainingCycle).mockReset().mockResolvedValue({ success: false, error: openWorkout });
  vi.mocked(restartTrainingCycle).mockReset().mockResolvedValue({ success: false, error: "Cycle not found" });
  vi.mocked(startTrainingCycle).mockReset().mockResolvedValue({ success: false, error: "Failed to start the cycle" });
  vi.mocked(removeCycleSlot).mockReset().mockResolvedValue({ success: false, error: "Failed to remove the slot" });
  returnTo.mockReset();
});

describe("cycle actions show a refused write", () => {
  it("Delete shows why the cycle was not deleted and stays on the page", async () => {
    render(<DeleteCycleButton cycleId={3} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete cycle" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(openWorkout));
    expect(returnTo).not.toHaveBeenCalled();
  });

  it("Start shows its error", async () => {
    render(<StartCycleButton cycle={cycle} />);
    fireEvent.click(screen.getByRole("button", { name: "Start Cycle" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Failed to start the cycle"));
  });

  it("Restart shows its error", async () => {
    render(<RestartCycleButton cycle={{ ...cycle, status: "completed" } as TrainingCycle} />);
    fireEvent.click(screen.getByRole("button", { name: "Restart cycle" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, restart" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Cycle not found"));
  });

  it("removing a rotation slot shows its error", async () => {
    const withSlots = {
      ...cycle,
      slots: [{ id: 9, orderIndex: 1, label: "Day 1", programId: null, program: null, autoComplete: false }],
    } as unknown as TrainingCycleWithSlots;
    render(<CycleScheduleBuilder cycle={withSlots} programs={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Day 1" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Failed to remove the slot"));
  });
});

describe("starting a season phase that is not the next one", () => {
  it("asks first, names the phase and the skipped phases, and starts only on confirm", async () => {
    vi.mocked(startTrainingCycle).mockResolvedValue({ success: true, data: cycle });
    render(<StartCycleButton cycle={cycle} skippedPhases={2} />);
    fireEvent.click(screen.getByRole("button", { name: "Start Cycle" }));
    expect(startTrainingCycle).not.toHaveBeenCalled();
    expect(screen.getByText("This starts Build today. 2 earlier phases will be skipped and the dates after it move.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start Build" }));
    await waitFor(() => expect(startTrainingCycle).toHaveBeenCalledWith(3));
  });

  it("starts the next phase at once", async () => {
    vi.mocked(startTrainingCycle).mockResolvedValue({ success: true, data: cycle });
    render(<StartCycleButton cycle={cycle} skippedPhases={0} />);
    fireEvent.click(screen.getByRole("button", { name: "Start Cycle" }));
    await waitFor(() => expect(startTrainingCycle).toHaveBeenCalledWith(3));
  });
});
