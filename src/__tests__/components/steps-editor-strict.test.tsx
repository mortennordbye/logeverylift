// @vitest-environment jsdom
import { StepsEditor } from "@/components/features/steps/StepsEditor";
import { DEFAULT_UNITS } from "@/lib/utils/units";
import type { Workout } from "@/lib/utils/workout-steps";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Strict work steps in the step editor (docs/plans/strict-targets.md,
 * decisions 2 and 3; plan picture 4, right column): a heart rate field for a
 * bike or run work step, the belt for a run step, and the missing-target
 * message before save. A step the exercise held already keeps taking edits.
 */

const saveExerciseSteps = vi.fn();
vi.mock("@/lib/actions/program-steps", () => ({ saveExerciseSteps: (d: unknown) => saveExerciseSteps(d) }));
vi.mock("@/lib/utils/stale-bundle", () => ({ callAction: (p: Promise<unknown>) => p }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));

beforeEach(() => {
  saveExerciseSteps.mockReset();
  saveExerciseSteps.mockResolvedValue({ success: true, data: { programId: 1 } });
});

const newExercise = (sport: "bike" | "run"): Workout => ({ v: 2, sport, name: "Session", steps: [{ type: "work", id: "s1", end: { type: "time", seconds: 1800 } }] });

function renderEditor(initial: Workout, opts: { unsaved: boolean }) {
  render(
    <StepsEditor
      programId={1}
      programExerciseId={2}
      exerciseName="Session"
      initial={initial}
      converted={false}
      unsaved={opts.unsaved}
      thresholds={{ ftp: 200, lthr_bike: 160, lthr_run: 170 }}
      units={DEFAULT_UNITS}
    />,
  );
}

const sheet = () => screen.getByTestId("step-sheet");
const done = () => within(sheet()).getByRole("button", { name: "Done" }) as HTMLButtonElement;

describe("StepsEditor · a new bike work step", () => {
  it("shows what is missing and takes heart rate as the second target", async () => {
    renderEditor(newExercise("bike"), { unsaved: true });
    expect(screen.getByTestId("steps-error").textContent).toBe("Step 1 · A bike work step needs power, heart rate and cadence");

    fireEvent.click(screen.getByTestId("step-row"));
    expect(within(sheet()).getByTestId("step-problem").textContent).toBe("A bike work step needs power, heart rate and cadence");
    expect(done().disabled).toBe(true);
    // No heart rate field before a main target: a second target needs a first one.
    expect(within(sheet()).queryByTestId("step-hr")).toBeNull();

    fireEvent.click(within(sheet()).getByRole("button", { name: "Power" }));
    const hr = within(sheet()).getByTestId("step-hr");
    expect(within(hr).getByRole("button", { name: "No heart rate" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(hr).getByRole("button", { name: "Heart rate zone" }));
    fireEvent.click(within(hr).getByRole("button", { name: "Z3" }));
    expect(done().disabled).toBe(true);

    fireEvent.change(within(sheet()).getByLabelText("Cadence from"), { target: { value: "85" } });
    fireEvent.change(within(sheet()).getByLabelText("Cadence to"), { target: { value: "95" } });
    expect(within(sheet()).queryByTestId("step-problem")).toBeNull();
    expect(done().disabled).toBe(false);
    fireEvent.click(done());

    expect(screen.queryByTestId("steps-error")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save steps" }));
    await vi.waitFor(() => expect(saveExerciseSteps).toHaveBeenCalledTimes(1));
    const sent = saveExerciseSteps.mock.calls[0][0] as { workout: Workout };
    expect(sent.workout.steps[0]).toMatchObject({
      type: "work",
      target: { metric: "power", anchor: "ftp", low: 88, high: 93 },
      target2: { metric: "hr", anchor: "lthr", zone: 3 },
      cadence: { low: 85, high: 95 },
    });
  });

  it("does not save while a new work step lacks a target", () => {
    renderEditor(newExercise("bike"), { unsaved: true });
    fireEvent.click(screen.getByRole("button", { name: "Save steps" }));
    expect(saveExerciseSteps).not.toHaveBeenCalled();
    expect(screen.getByTestId("steps-error").textContent).toBe("Step 1 · A bike work step needs power, heart rate and cadence");
  });

  it("has no heart rate field when the main target is heart rate", () => {
    renderEditor(newExercise("bike"), { unsaved: true });
    fireEvent.click(screen.getByTestId("step-row"));
    fireEvent.click(within(sheet()).getByRole("button", { name: "HR zone" }));
    expect(within(sheet()).queryByTestId("step-hr")).toBeNull();
    expect(within(sheet()).getByTestId("step-problem").textContent).toBe("A bike work step needs power, heart rate and cadence");
  });
});

describe("StepsEditor · a new run work step", () => {
  it("takes the belt, heart rate and cadence in steps per minute", async () => {
    renderEditor(newExercise("run"), { unsaved: true });
    fireEvent.click(screen.getByTestId("step-row"));
    expect(within(sheet()).getByTestId("step-problem").textContent).toBe("A run work step needs belt speed, heart rate and cadence");
    fireEvent.click(within(sheet()).getByRole("button", { name: "Pace" }));
    fireEvent.click(within(within(sheet()).getByTestId("step-hr")).getByRole("button", { name: "Heart rate zone" }));
    fireEvent.change(within(sheet()).getByLabelText("Belt in km/h"), { target: { value: "9,5" } });
    expect(within(sheet()).getByText("Cadence in steps per minute")).toBeTruthy();
    fireEvent.change(within(sheet()).getByLabelText("Cadence from"), { target: { value: "166" } });
    fireEvent.change(within(sheet()).getByLabelText("Cadence to"), { target: { value: "176" } });
    expect(done().disabled).toBe(false);
    fireEvent.click(done());
    fireEvent.click(screen.getByRole("button", { name: "Save steps" }));
    await vi.waitFor(() => expect(saveExerciseSteps).toHaveBeenCalledTimes(1));
    const sent = saveExerciseSteps.mock.calls[0][0] as { workout: Workout };
    expect(sent.workout.steps[0]).toMatchObject({ belt: 9.5, target: { metric: "pace" }, target2: { metric: "hr", zone: 2 }, cadence: { low: 166, high: 176 } });
  });
});

describe("StepsEditor · a work step under 3 min", () => {
  it("needs no heart rate, and says so", () => {
    renderEditor({ v: 2, sport: "bike", name: "Sprints", steps: [{ type: "work", id: "s1", end: { type: "time", seconds: 30 } }] }, { unsaved: true });
    expect(screen.getByTestId("steps-error").textContent).toBe("Step 1 · A bike work step under 3 min needs power and cadence");
    fireEvent.click(screen.getByTestId("step-row"));
    expect(within(sheet()).getByTestId("step-problem").textContent).toBe("A bike work step under 3 min needs power and cadence");
    fireEvent.click(within(sheet()).getByRole("button", { name: "Power" }));
    fireEvent.change(within(sheet()).getByLabelText("Cadence from"), { target: { value: "100" } });
    fireEvent.change(within(sheet()).getByLabelText("Cadence to"), { target: { value: "110" } });
    expect(within(sheet()).queryByTestId("step-problem")).toBeNull();
    expect(done().disabled).toBe(false);
  });
});

describe("StepsEditor · a step the exercise held already", () => {
  const old: Workout = {
    v: 2,
    sport: "bike",
    name: "Old ride",
    steps: [{ type: "work", id: "s1", end: { type: "time", seconds: 1200 }, target: { metric: "power", anchor: "ftp", zone: 2 } }],
  };

  it("takes a small edit and saves, with the message shown", async () => {
    renderEditor(old, { unsaved: false });
    expect(screen.queryByTestId("steps-error")).toBeNull();
    fireEvent.click(screen.getByTestId("step-row"));
    expect(within(sheet()).getByTestId("step-problem").textContent).toBe("A bike work step needs power, heart rate and cadence");
    fireEvent.change(within(sheet()).getByLabelText("Minutes"), { target: { value: "25" } });
    expect(done().disabled).toBe(false);
    fireEvent.click(done());
    fireEvent.click(screen.getByRole("button", { name: "Save steps" }));
    await vi.waitFor(() => expect(saveExerciseSteps).toHaveBeenCalledTimes(1));
  });

  it("is checked once its target changes", () => {
    renderEditor(old, { unsaved: false });
    fireEvent.click(screen.getByTestId("step-row"));
    fireEvent.click(within(sheet()).getByRole("button", { name: "Z3" }));
    expect(done().disabled).toBe(true);
  });
});
