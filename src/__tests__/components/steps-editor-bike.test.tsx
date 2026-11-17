// @vitest-environment jsdom
import { StepsEditor } from "@/components/features/steps/StepsEditor";
import { DEFAULT_UNITS } from "@/lib/utils/units";
import { parseWorkout } from "@/lib/utils/workout-steps";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * The step editor with the bike step fields of docs/plans/bike-ride-logger.md,
 * step 0: a ramp the assistant wrote shows in watts and is none of the target
 * choices; picking a choice replaces it; an outdoor target survives an edit.
 */

const saveExerciseSteps = vi.fn();
vi.mock("@/lib/actions/program-steps", () => ({ saveExerciseSteps: (d: unknown) => saveExerciseSteps(d) }));
vi.mock("@/lib/utils/stale-bundle", () => ({ callAction: (p: Promise<unknown>) => p }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));

const OUTDOOR = { metric: "hr", anchor: "lthr", low: 81, high: 89 } as const;
const parsed = parseWorkout({
  v: 2,
  sport: "bike",
  name: "Ride",
  steps: [{ type: "warmup", end: { type: "time", seconds: 600 }, ramp: { anchor: "ftp", from: 50, to: 70 }, outdoor: OUTDOOR }],
});
if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));

function renderEditor() {
  render(<StepsEditor programId={1} programExerciseId={2} exerciseName="Bike" initial={parsed.ok ? parsed.workout : (null as never)} converted={false} thresholds={{ ftp: 200 }} units={DEFAULT_UNITS} />);
}

describe("StepsEditor with a ramp", () => {
  it("shows the ramp in watts, with no target choice picked", () => {
    renderEditor();
    expect(within(screen.getByTestId("step-row")).getByText("100 to 140 W")).toBeTruthy();
    fireEvent.click(screen.getByTestId("step-row"));
    const sheet = screen.getByTestId("step-sheet");
    expect(within(sheet).getByTestId("step-target-preview").textContent).toBe("100 to 140 W");
    for (const label of ["None", "Power", "Power zone", "HR zone", "Feel"]) {
      expect(within(sheet).getByRole("button", { name: label }).getAttribute("aria-pressed")).toBe("false");
    }
  });

  it("a picked target replaces the ramp and keeps the outdoor target", async () => {
    saveExerciseSteps.mockResolvedValue({ success: true, data: { programId: 1 } });
    renderEditor();
    fireEvent.click(screen.getByTestId("step-row"));
    const sheet = screen.getByTestId("step-sheet");
    fireEvent.click(within(sheet).getByRole("button", { name: "Power" }));
    expect(within(sheet).getByTestId("step-target-preview").textContent).toBe("176-186 W");
    fireEvent.click(within(sheet).getByRole("button", { name: "Done" }));
    fireEvent.click(await screen.findByRole("button", { name: /Save/ }));
    const sent = saveExerciseSteps.mock.calls[0][0] as { workout: { steps: Record<string, unknown>[] } };
    expect(sent.workout.steps[0]).toMatchObject({ target: { metric: "power", anchor: "ftp", low: 88, high: 93 }, outdoor: OUTDOOR });
    expect(sent.workout.steps[0].ramp).toBeUndefined();
  });
});
