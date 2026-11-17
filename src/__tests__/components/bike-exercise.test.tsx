// @vitest-environment jsdom
import { BikeExercise } from "@/components/features/bike/BikeExercise";
import type { BikeExerciseData } from "@/lib/bike-exercise-view";
import { bikeStepRows, plannedRideNumbers, rideChart } from "@/lib/utils/bike-ride-view";
import { buildRidePlan } from "@/lib/utils/ride-timeline";
import { parseWorkout, type ThresholdValues } from "@/lib/utils/workout-steps";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** The bike exercise screen (docs/plans/bike-ride-logger.md, section 5, step 2). */

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }), usePathname: () => "/programs/1/workout/exercises/2" }));
vi.mock("@/components/ui/BackLink", () => ({ BackLink: () => <span>Workout</span> }));
vi.mock("@/contexts/workout-session-context", () => ({ useWorkoutSession: () => ({ sessionId: 7 }) }));
const startRide = vi.fn();
vi.mock("@/lib/actions/rides", () => ({ startRide: (d: unknown) => startRide(d) }));

const parsed = parseWorkout({
  v: 2,
  sport: "bike",
  name: "Bike",
  steps: [
    { type: "warmup", end: { type: "time", seconds: 900 }, ramp: { anchor: "ftp", from: 55, to: 75 } },
    { type: "work", end: { type: "time", seconds: 900 }, target: { metric: "power", anchor: "ftp", low: 75, high: 81 }, cadence: { low: 85, high: 95 }, note: "Talk in short sentences" },
    { type: "recovery", end: { type: "time", seconds: 300 }, target: { metric: "power", anchor: "ftp", zone: 1 } },
  ],
});
if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
const workout = parsed.workout;

function data(thresholds: ThresholdValues, defaultMode: "indoor" | "outdoor" = "indoor"): BikeExerciseData {
  const view = (mode: "indoor" | "outdoor") => {
    const plan = buildRidePlan(workout, [1, 2, 3], thresholds, mode);
    return { numbers: plannedRideNumbers(plan), chart: rideChart(plan), rows: bikeStepRows(plan) };
  };
  return { defaultMode, indoor: view("indoor"), outdoor: view("outdoor"), ftp: thresholds.ftp ?? null, lthr: thresholds.lthr_bike ?? null };
}

const targets = () => screen.getAllByTestId("ride-step-target").map((t) => t.textContent);

beforeEach(() => {
  replace.mockReset();
  startRide.mockReset();
});

describe("BikeExercise", () => {
  it("indoors: the summary line, the power chart, the numbers and watts on every step", () => {
    render(<BikeExercise programId={1} programExerciseId={2} exerciseName="Bike" data={data({ ftp: 180, lthr_bike: 171 })} />);
    expect(screen.getByTestId("ride-summary").textContent).toBe("35 min · load about 29 · FTP 180 W");
    expect(screen.getByTestId("ride-mode").textContent).toBe("Indoor trainer");
    expect(screen.getByTestId("ride-profile")).toBeTruthy();
    expect(within(screen.getByTestId("ride-stats")).getByText("kJ")).toBeTruthy();
    expect(targets()).toEqual(["99 to 135 W", "135-146 W", "under 97 W"]);
    expect(screen.getByText("Talk in short sentences")).toBeTruthy();
    expect(screen.queryByTestId("no-ftp")).toBeNull();
  });

  it("opens in the default mode and Change switches to the outdoor targets", () => {
    render(<BikeExercise programId={1} programExerciseId={2} exerciseName="Bike" data={data({ ftp: 180, lthr_bike: 171 }, "outdoor")} />);
    expect(screen.getByTestId("ride-mode").textContent).toBe("Outdoor");
    expect(screen.queryByTestId("ride-profile")).toBeNull();
    expect(screen.getByTestId("ride-summary").textContent).toContain("LTHR 171");
    expect(targets()).toEqual(["HR under 139", "HR 154-159", "Effort 2"]);
    expect(screen.getByText("Z3 · 135-146 W with a power meter")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Change to Indoor trainer" }));
    expect(screen.getByTestId("ride-mode").textContent).toBe("Indoor trainer");
    expect(targets()).toEqual(["99 to 135 W", "135-146 W", "under 97 W"]);
  });

  it("with no FTP: targets in % FTP, no kJ, and a way to set it", () => {
    render(<BikeExercise programId={1} programExerciseId={2} exerciseName="Bike" data={data({})} />);
    expect(targets()).toEqual(["55 to 75% FTP", "75-81% FTP", "under 55% FTP"]);
    expect(screen.getByText("Set your FTP to see watts")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Set FTP" }).getAttribute("href")).toBe("/more/account/training-numbers");
    expect(within(screen.getByTestId("ride-stats")).queryByText("kJ")).toBeNull();
    expect(screen.getByTestId("ride-summary").textContent).toBe("35 min · load about 29");
  });

  it("outdoors with no bike LTHR: effort targets", () => {
    render(<BikeExercise programId={1} programExerciseId={2} exerciseName="Bike" data={data({ ftp: 180 }, "outdoor")} />);
    expect(targets()).toEqual(["Effort 2", "Effort 6", "Effort 2"]);
  });

  it("Start ride starts the ride in the chosen mode and opens ride mode; Log by hand opens the set list", async () => {
    startRide.mockResolvedValue({ success: true, data: {} });
    render(<BikeExercise programId={1} programExerciseId={2} exerciseName="Bike" data={data({ ftp: 180 })} />);
    expect(screen.getByRole("link", { name: "Log by hand" }).getAttribute("href")).toBe("/programs/1/workout/exercises/2?hand=1");
    fireEvent.click(screen.getByRole("button", { name: "Change to Outdoor" }));
    fireEvent.click(screen.getByRole("button", { name: "Start ride" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/programs/1/workout/exercises/2?ride=1"));
    expect(startRide).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 7, programExerciseId: 2, mode: "outdoor" }));
  });

  it("shows the server's reason when the ride does not start", async () => {
    startRide.mockResolvedValue({ success: false, error: "A ride is already running" });
    render(<BikeExercise programId={1} programExerciseId={2} exerciseName="Bike" data={data({ ftp: 180 })} />);
    fireEvent.click(screen.getByRole("button", { name: "Start ride" }));
    expect((await screen.findByRole("alert")).textContent).toBe("A ride is already running");
    expect(replace).not.toHaveBeenCalled();
  });
});
