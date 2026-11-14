// @vitest-environment jsdom
import { EditCycleForm } from "@/components/features/EditCycleForm";
import { updateTrainingCycle } from "@/lib/actions/training-cycles";
import type { TrainingCycle } from "@/types/workout";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/** A cycle outside a season can be any whole number of weeks from 1 to 52, set with the chips or the Custom field. */

vi.mock("@/lib/actions/training-cycles", () => ({
  updateTrainingCycle: vi.fn(async () => ({ success: true, data: {} })),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }) }));

const cycle = {
  id: 3,
  userId: "u1",
  name: "Odd block",
  durationWeeks: 7,
  durationDays: null,
  scheduleType: "rotation",
  startDate: null,
  status: "draft",
  endAction: "none",
  endMessage: null,
  raceDate: null,
  raceDistance: null,
  seasonId: null,
} as unknown as TrainingCycle;

afterEach(cleanup);

describe("the cycle length on the edit form", () => {
  it("shows a length that is not a main chip in the Custom field, and saves a typed length", async () => {
    render(<EditCycleForm cycle={cycle} enduranceEnabled={false} today="2026-11-14" />);
    expect(screen.getByRole("button", { name: "Custom" }).getAttribute("aria-pressed")).toBe("true");
    const weeks = screen.getByLabelText("Length in weeks") as HTMLInputElement;
    expect(weeks.value).toBe("7");
    fireEvent.change(weeks, { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));
    await waitFor(() => expect(updateTrainingCycle).toHaveBeenCalledWith(expect.objectContaining({ id: 3, durationWeeks: 9 })));
  });

  it("the Custom field has no native spin buttons, which are under 44 px: a text field with a number keypad (round 8)", () => {
    render(<EditCycleForm cycle={cycle} enduranceEnabled={false} today="2026-11-14" />);
    const weeks = screen.getByLabelText("Length in weeks") as HTMLInputElement;
    expect(weeks.type).toBe("text");
    expect(weeks.inputMode).toBe("numeric");
    fireEvent.change(weeks, { target: { value: "1x2" } });
    expect(weeks.value).toBe("12");
  });

  it("will not save a length outside 1 to 52", () => {
    render(<EditCycleForm cycle={cycle} enduranceEnabled={false} today="2026-11-14" />);
    fireEvent.change(screen.getByLabelText("Length in weeks"), { target: { value: "53" } });
    expect((screen.getByRole("button", { name: /Save/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Pick 1 to 52 weeks.")).toBeTruthy();
  });
});
