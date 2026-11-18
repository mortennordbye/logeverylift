// @vitest-environment jsdom
import { RideSummary } from "@/components/features/bike/RideSummary";
import { allOutStep, ftpTestView, ftpTestWorkout } from "@/lib/utils/ftp-tests";
import { workoutToRows } from "@/lib/utils/program-steps";
import { rideSummary, type StepLog } from "@/lib/utils/ride-results";
import { buildRidePlan } from "@/lib/utils/ride-timeline";
import { parseWorkout } from "@/lib/utils/workout-steps";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** "New FTP 186 W · Save" on the summary of an FTP test ride (docs/plans/bike-ride-logger.md, 4.9). */

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }), usePathname: () => "/programs/1/workout/exercises/2" }));
vi.mock("@/components/ui/BackLink", () => ({ BackLink: () => <span>Workout</span> }));
vi.mock("@/lib/actions/ride-garmin", () => ({ undoRideGarminFill: vi.fn(), pickRideGarminActivity: vi.fn() }));
const saveRideFtp = vi.fn();
vi.mock("@/lib/actions/ride-ftp", () => ({ saveRideFtp: (d: unknown) => saveRideFtp(d) }));

const parsed = parseWorkout(ftpTestWorkout("20min"));
if (!parsed.ok) throw new Error("template");
const plan = buildRidePlan(parsed.workout, workoutToRows(parsed.workout).map((_, i) => i + 1), { ftp: 180 }, "indoor");
const allOut = allOutStep(plan.steps)!;
const log = (s: (typeof plan.steps)[number], avgPower: number | null): StepLog => ({
  status: "done",
  durationSeconds: s.seconds,
  targetOffsetW: 0,
  extendedSeconds: 0,
  avgPower,
  avgHr: null,
  maxHr: null,
  avgCadence: null,
  avgSpeed: null,
  distanceMeters: null,
  climbM: null,
  rpe: 9,
  sources: { durationSeconds: "clock", ...(avgPower !== null && { avgPower: "typed" }) },
});
const logs = Object.fromEntries(plan.steps.map((s) => [s.programSetId, log(s, s === allOut ? 196 : 120)]));

function show(currentFtp: number) {
  render(
    <RideSummary
      programId={1}
      exerciseName="FTP test"
      doneLine="Done 17:12 · Indoor trainer"
      summary={rideSummary(plan, logs)}
      doneHref="/"
      saveTheRide={false}
      rideId={7}
      ftpTest={ftpTestView(plan, logs, null, currentFtp)}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  saveRideFtp.mockResolvedValue({ success: true, data: { ftp: 186 } });
});

describe("RideSummary of an FTP test", () => {
  it("shows New FTP 186 W with Save, and Save sends only the ride id", async () => {
    show(180);
    const row = screen.getByTestId("summary-ftp");
    expect(row.textContent).toBe("New FTP 186 WSave");
    expect(row.textContent).not.toContain(":");
    fireEvent.click(within(row).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveRideFtp).toHaveBeenCalledWith({ rideId: 7 }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("an FTP from the ramp's planned watts is marked est. and can still be saved", async () => {
    render(
      <RideSummary
        programId={1}
        exerciseName="FTP test"
        doneLine="Done"
        summary={rideSummary(plan, logs)}
        doneHref="/"
        saveTheRide={false}
        rideId={7}
        ftpTest={{ test: "ramp", result: { test: "ramp", power: 260, basis: "target", ftp: 195, estimated: true }, currentFtp: 180, saved: false }}
      />,
    );
    const row = screen.getByTestId("summary-ftp");
    expect(row.textContent).toBe("New FTP 195 West.Save");
    fireEvent.click(within(row).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveRideFtp).toHaveBeenCalledWith({ rideId: 7 }));
  });

  it("says Saved, with no button, once the test row is stored", () => {
    render(
      <RideSummary
        programId={1}
        exerciseName="FTP test"
        doneLine="Done"
        summary={rideSummary(plan, logs)}
        doneHref="/"
        saveTheRide={false}
        rideId={7}
        ftpTest={{ ...ftpTestView(plan, logs, null, 186)!, saved: true }}
      />,
    );
    const row = screen.getByTestId("summary-ftp");
    expect(row.textContent).toBe("New FTP 186 WSaved");
    expect(within(row).queryByRole("button")).toBeNull();
  });

  it("a refused save shows the reason and keeps Save", async () => {
    saveRideFtp.mockResolvedValue({ success: false, error: "This ride gives no FTP" });
    show(180);
    fireEvent.click(within(screen.getByTestId("summary-ftp")).getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toBe("This ride gives no FTP");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("no line when the test gives no FTP", () => {
    const empty = { ...logs, [allOut.programSetId]: log(allOut, null) };
    render(
      <RideSummary
        programId={1}
        exerciseName="FTP test"
        doneLine="Done"
        summary={rideSummary(plan, empty)}
        doneHref="/"
        saveTheRide={false}
        rideId={7}
        ftpTest={ftpTestView(plan, empty, null, 180)}
      />,
    );
    expect(screen.queryByTestId("summary-ftp")).toBeNull();
  });
});
