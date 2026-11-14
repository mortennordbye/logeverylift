// @vitest-environment jsdom
import { StepResultsForm } from "@/components/features/guided/StepResultsForm";
import { toPlaySteps, type PlayerSession, type PlayerStepView } from "@/components/features/guided/types";
import { PLAYER_STORAGE_KEY, finish, initialState, serializePlayerState, start, tick } from "@/lib/utils/workout-player";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The results screen (docs/plans/endurance-app.md, 5.3): filled from the run
 * saved on this phone, saved through callAction, and a failed save keeps the
 * screen and the saved run.
 */

const saveStepResultsAction = vi.fn();
vi.mock("@/lib/actions/step-results", () => ({ saveStepResultsAction: (d: unknown) => saveStepResultsAction(d) }));
const callAction = vi.fn();
vi.mock("@/lib/utils/stale-bundle", () => ({ callAction: (p: Promise<unknown>) => callAction(p) }));
const push = vi.fn();
const replace = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace, refresh }) }));

const view = (key: string, type: PlayerStepView["type"], seconds: number | null, targetText: string | null = null): PlayerStepView => ({
  key,
  type,
  round: null,
  seconds,
  text: `${key} text`,
  targetText,
  targetLow: targetText ? 220 : null,
  targetHigh: targetText ? 233 : null,
  targetUnit: targetText ? "W" : null,
  plannedMeters: null,
  distanceText: null,
  note: null,
  stroke: null,
  sendOff: false,
});
const session: PlayerSession = {
  plannedSessionId: 41,
  workoutHash: "abc12345",
  name: "Short ride",
  sport: "bike",
  poolLengthM: null,
  steps: [view("s1", "warmup", 600), view("s2", "work", 300, "220-233 W"), view("s3", "cooldown", null)],
};
const units = { distance: "km" as const, swim: "m" as const };

function saveRun() {
  const steps = toPlaySteps(session.steps);
  const t0 = Date.now() - 3_600_000;
  let s = start(initialState({ plannedSessionId: 41, workoutHash: "abc12345", clientKey: "key12345" }), steps, t0);
  s = tick(s, steps, t0 + 900_000).state;
  s = finish(s, steps, t0 + 960_000);
  localStorage.setItem(PLAYER_STORAGE_KEY, serializePlayerState(s));
}

beforeEach(() => {
  localStorage.clear();
  saveStepResultsAction.mockReset().mockResolvedValue({ success: true, data: { workoutSessionId: 5 } });
  callAction.mockReset().mockImplementation((p: Promise<unknown>) => p);
  push.mockReset();
  replace.mockReset();
  refresh.mockReset();
});

describe("StepResultsForm", () => {
  it("opens as planned when there is no run", () => {
    render(<StepResultsForm session={session} units={units} existing={null} fromPlayer={false} />);
    expect(screen.getAllByTestId("result-step")[0].textContent).toContain("planned 10:00 · done 10:00 · on plan");
  });

  it("fills from the saved run and saves it with its key, RPE and distance through callAction", async () => {
    saveRun();
    render(<StepResultsForm session={session} units={units} existing={null} fromPlayer />);
    await act(async () => {});
    const rows = screen.getAllByTestId("result-step");
    expect(rows[0].textContent).toContain("done 10:00 · on plan");
    expect(rows[2].textContent).toContain("done 01:00");
    fireEvent.click(screen.getByRole("button", { name: "7" }));
    fireEvent.change(screen.getByLabelText("Distance in km"), { target: { value: "8,5" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    expect(callAction).toHaveBeenCalledTimes(1);
    expect(saveStepResultsAction).toHaveBeenCalledWith(
      expect.objectContaining({
        plannedSessionId: 41,
        source: "player",
        clientKey: "key12345",
        sessionRpe: 7,
        distanceMeters: 8500,
        steps: [
          { key: "s1", status: "done", activeSeconds: 600 },
          { key: "s2", status: "done", activeSeconds: 300 },
          { key: "s3", status: "partial", activeSeconds: 60 },
        ],
      }),
    );
    expect(localStorage.getItem(PLAYER_STORAGE_KEY)).toBeNull();
    // Replace, not push: the results form must not stay in history, or Back
    // on the session would return into it.
    expect(replace).toHaveBeenCalledWith("/planned/41");
    expect(push).not.toHaveBeenCalled();
  });

  it("a failed save keeps the screen and the saved run, and offers Retry", async () => {
    saveRun();
    saveStepResultsAction.mockResolvedValue({ success: false, error: "Offline" });
    render(<StepResultsForm session={session} units={units} existing={null} fromPlayer />);
    await act(async () => {});
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    expect(screen.getByTestId("results-error").textContent).toBe("Not saved yet: Offline");
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(localStorage.getItem(PLAYER_STORAGE_KEY)).not.toBeNull();
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  // Review fix 10: the workout was edited after the run; its finished run still fills the form.
  it("fills from a finished run of an older version of the workout", async () => {
    const steps = toPlaySteps(session.steps);
    const t0 = Date.now() - 3_600_000;
    let s = start(initialState({ plannedSessionId: 41, workoutHash: "old00000", clientKey: "key12345" }), steps, t0);
    s = tick(s, steps, t0 + 900_000).state;
    s = finish(s, steps, t0 + 960_000);
    localStorage.setItem(PLAYER_STORAGE_KEY, serializePlayerState(s));
    render(<StepResultsForm session={session} units={units} existing={null} fromPlayer />);
    await act(async () => {});
    expect(screen.getAllByTestId("result-step")[2].textContent).toContain("done 01:00");
    expect(screen.getByTestId("step-results").textContent).toContain("The workout changed after this run");
  });

  // Re-review 2: an edit changed every step id, so no step of the run is in the workout now.
  it("says plainly when no step of the run matches, and saves it as one session with its total time", async () => {
    const oldSteps = toPlaySteps([view("x1", "warmup", 600), view("x2", "work", 300)]);
    const t0 = Date.now() - 3_600_000;
    let s = start(initialState({ plannedSessionId: 41, workoutHash: "old00000", clientKey: "key12345" }), oldSteps, t0);
    s = tick(s, oldSteps, t0 + 900_000).state;
    localStorage.setItem(PLAYER_STORAGE_KEY, serializePlayerState(s));
    render(<StepResultsForm session={session} units={units} existing={null} fromPlayer />);
    await act(async () => {});
    expect(screen.getByTestId("no-step-match").textContent).toContain("None of this run's steps are in the workout now");
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save as one session" }));
    });
    expect(saveStepResultsAction).toHaveBeenCalledWith(
      expect.objectContaining({
        durationSeconds: 900,
        source: "player",
        clientKey: "key12345",
        steps: [
          { key: "s1", status: "not_done" },
          { key: "s2", status: "not_done" },
          { key: "s3", status: "not_done" },
        ],
      }),
    );
  });

  // Re-review 3: an empty RPE is sent as null, so a session the results wrote can be cleared.
  it("sends a cleared RPE and distance as null", async () => {
    render(<StepResultsForm session={session} units={units} existing={{ steps: [{ key: "s1", status: "done", activeSeconds: 600 }], sessionRpe: 6, distanceMeters: 21500 }} fromPlayer={false} />);
    fireEvent.click(screen.getByRole("button", { name: "6" }));
    fireEvent.change(screen.getByLabelText("Distance in km"), { target: { value: "" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    const sent = saveStepResultsAction.mock.calls[0][0] as Record<string, unknown>;
    expect(sent.sessionRpe).toBeNull();
    expect(sent.distanceMeters).toBeNull();
  });

  // Review fix 11: the saved distance shows, and a hand save sends no run details.
  it("shows the saved distance and sends no run details from a hand save", async () => {
    render(<StepResultsForm session={session} units={units} existing={{ steps: [{ key: "s1", status: "done", activeSeconds: 600 }], sessionRpe: 6, distanceMeters: 21500 }} fromPlayer={false} />);
    expect((screen.getByLabelText("Distance in km") as HTMLInputElement).value).toBe("21.5");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    const sent = saveStepResultsAction.mock.calls[0][0] as Record<string, unknown>;
    expect(sent.pausedSeconds).toBeUndefined();
    expect(sent.distanceMeters).toBe(21500);
    expect(sent.sessionRpe).toBe(6);
  });

  it("a step can be marked skipped, and a work step takes a measured value", async () => {
    render(<StepResultsForm session={session} units={units} existing={null} fromPlayer={false} />);
    fireEvent.change(screen.getByLabelText("Status of step s1"), { target: { value: "skipped" } });
    const value = screen.getByText("Average (W)").querySelector("input")!;
    fireEvent.blur(value, { target: { value: "240" } });
    expect(screen.getAllByTestId("result-step")[1].textContent).toContain("above");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    const sent = saveStepResultsAction.mock.calls[0][0] as { source: string; steps: { key: string; status: string; value?: number }[] };
    expect(sent.source).toBe("manual");
    expect(sent.steps[0].status).toBe("skipped");
    expect(sent.steps[1].value).toBe(240);
  });
});
