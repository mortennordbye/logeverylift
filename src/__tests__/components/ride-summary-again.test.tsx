// @vitest-environment jsdom
import { RideSummary } from "@/components/features/bike/RideSummary";
import { workoutToRows } from "@/lib/utils/program-steps";
import { rideSummary } from "@/lib/utils/ride-results";
import { buildRidePlan } from "@/lib/utils/ride-timeline";
import { parseWorkout } from "@/lib/utils/workout-steps";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** "Ride again" on the summary of a ride that ended early (docs/plans/bike-ride-logger.md, section 9). */

const replace = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh }), usePathname: () => "/programs/1/workout/exercises/2" }));
vi.mock("@/components/ui/BackLink", () => ({ BackLink: () => <span>Workout</span> }));
vi.mock("@/lib/actions/ride-garmin", () => ({ undoRideGarminFill: vi.fn(), pickRideGarminActivity: vi.fn() }));
vi.mock("@/lib/actions/ride-ftp", () => ({ saveRideFtp: vi.fn() }));
const startRide = vi.fn();
vi.mock("@/lib/actions/rides", () => ({ startRide: (d: unknown) => startRide(d) }));
const armRide = vi.fn();
const disarmRide = vi.fn();
vi.mock("@/components/features/bike/useRide", () => ({ armRide: () => armRide(), disarmRide: () => disarmRide() }));

const parsed = parseWorkout({
  v: 2,
  sport: "bike",
  name: "Tempo",
  steps: [
    { type: "warmup", end: { type: "time", seconds: 600 }, target: { metric: "power", anchor: "ftp", low: 50, high: 60 } },
    { type: "work", end: { type: "time", seconds: 900 }, target: { metric: "power", anchor: "ftp", low: 76, high: 85 } },
  ],
});
if (!parsed.ok) throw new Error("tempo");
const plan = buildRidePlan(parsed.workout, workoutToRows(parsed.workout).map((_, i) => i + 1), { ftp: 180 }, "indoor");

function show(rideAgain: { sessionId: number; programExerciseId: number; mode: "indoor" | "outdoor" } | null) {
  render(
    <RideSummary
      programId={1}
      exerciseName="Tempo"
      doneLine="Ended early 17:12 · Indoor trainer"
      summary={rideSummary(plan, {})}
      doneHref="/"
      saveTheRide={false}
      rideId={7}
      rideAgain={rideAgain}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  startRide.mockResolvedValue({ success: true, data: {} });
});

describe("Ride again", () => {
  it("starts a new ride of the same exercise and session in the same mode, then opens ride mode", async () => {
    show({ sessionId: 9, programExerciseId: 2, mode: "indoor" });
    fireEvent.click(screen.getByRole("button", { name: "Ride again" }));
    expect(armRide).toHaveBeenCalled();
    await waitFor(() => expect(startRide).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 9, programExerciseId: 2, mode: "indoor", again: true })));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/programs/1/workout/exercises/2?ride=1"));
  });

  it("a refusal shows the reason and lets go of the wake lock", async () => {
    startRide.mockResolvedValue({ success: false, error: "A ride is already running" });
    show({ sessionId: 9, programExerciseId: 2, mode: "indoor" });
    fireEvent.click(screen.getByRole("button", { name: "Ride again" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "A ride is already running");
    expect(disarmRide).toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("a ride too short for a load says so (4.6)", () => {
    const log = { status: "partial" as const, durationSeconds: 8, targetOffsetW: 0, extendedSeconds: 0, avgPower: null, avgHr: null, maxHr: null, avgCadence: null, avgSpeed: null, distanceMeters: null, climbM: null, rpe: 6, sources: null };
    render(<RideSummary programId={1} exerciseName="Tempo" doneLine="Ended early" summary={rideSummary(plan, { [plan.steps[0].programSetId]: log })} doneHref="/" saveTheRide={false} rideId={7} />);
    expect(screen.getByTestId("summary-no-load").textContent).toBe("No load · the ride is too short to count");
  });

  it("a finished ride has no Ride again", () => {
    show(null);
    expect(screen.queryByRole("button", { name: "Ride again" })).toBeNull();
  });
});
