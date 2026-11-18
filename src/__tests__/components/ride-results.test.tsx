// @vitest-environment jsdom
import { RideResults } from "@/components/features/bike/RideResults";
import { RideSummary } from "@/components/features/bike/RideSummary";
import { resultSteps, rideSummary, type StepLog } from "@/lib/utils/ride-results";
import { buildRidePlan } from "@/lib/utils/ride-timeline";
import { DEFAULT_UNITS } from "@/lib/utils/units";
import { parseWorkout } from "@/lib/utils/workout-steps";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** The ride results table and the summary (docs/plans/bike-ride-logger.md, section 5, step 4). */

const replace = vi.fn();
const refresh = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh, push }), usePathname: () => "/programs/1/workout/exercises/2" }));
vi.mock("@/components/ui/BackLink", () => ({ BackLink: () => <span>Workout</span> }));
const setActiveWorkout = vi.fn();
let phoneSession: { sessionId: number | null; programId: number } = { sessionId: 9, programId: 1 };
vi.mock("@/contexts/workout-session-context", () => ({ useWorkoutSession: () => ({ ...phoneSession, setActiveWorkout }) }));
const logWithRetry = vi.fn();
const unlogWithRetry = vi.fn();
vi.mock("@/contexts/pending-queue-context", () => ({ useWorkoutSetWriter: () => ({ logWithRetry, unlogWithRetry }) }));

const parsed = parseWorkout({
  v: 2,
  sport: "bike",
  name: "Bike",
  steps: [
    { type: "warmup", end: { type: "time", seconds: 900 }, ramp: { anchor: "ftp", from: 55, to: 75 } },
    { type: "work", end: { type: "time", seconds: 900 }, target: { metric: "power", anchor: "ftp", low: 75, high: 81 } },
    { type: "recovery", end: { type: "time", seconds: 300 }, target: { metric: "power", anchor: "ftp", zone: 1 } },
  ],
});
if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
const plan = (mode: "indoor" | "outdoor") => buildRidePlan(parsed.workout, [1, 2, 3], { ftp: 180, lthr_bike: 171 }, mode);

const log = (over: Partial<StepLog> = {}): StepLog => ({
  status: "done",
  durationSeconds: 900,
  targetOffsetW: 0,
  extendedSeconds: 0,
  avgPower: null,
  avgHr: null,
  maxHr: null,
  avgCadence: null,
  avgSpeed: null,
  distanceMeters: null,
  climbM: null,
  rpe: null,
  sources: { durationSeconds: "clock" },
  ...over,
});

function results(mode: "indoor" | "outdoor", logs: Record<number, StepLog>, extra: Partial<React.ComponentProps<typeof RideResults>> = {}) {
  return render(
    <RideResults
      programId={1}
      exerciseId={3}
      steps={resultSteps(plan(mode), logs)}
      mode={mode}
      setNumbers={{ 1: 1, 2: 2, 3: 3 }}
      sessionId={7}
      hand={false}
      garminWaiting={false}
      laterHref="/"
      units={DEFAULT_UNITS}
      {...extra}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  phoneSession = { sessionId: 9, programId: 1 };
  logWithRetry.mockResolvedValue({ success: true, data: {} });
});

describe("RideResults", () => {
  it("indoors: Avg W and Avg HR per step; More numbers adds max HR and cadence, never distance, speed or climbing", () => {
    results("indoor", { 1: log(), 2: log(), 3: log({ durationSeconds: 300 }) });
    expect(screen.getAllByTestId("result-row")).toHaveLength(3);
    expect(screen.getByLabelText("Avg W step 1")).toBeTruthy();
    expect(screen.getByLabelText("Avg HR step 1")).toBeTruthy();
    expect(screen.queryByLabelText("Max HR step 1")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More numbers · max HR, cadence" }));
    expect(screen.getByLabelText("Max HR step 1")).toBeTruthy();
    expect(screen.getByLabelText("Cadence step 1")).toBeTruthy();
    expect(screen.queryByText(/Distance|km\/h|Climbing/)).toBeNull();
  });

  it("outdoors: More numbers adds max HR, distance, speed and climbing", () => {
    results("outdoor", { 1: log(), 2: log(), 3: log() });
    fireEvent.click(screen.getByRole("button", { name: /^More numbers/ }));
    for (const label of ["Max HR", "Distance km", "Avg km/h", "Climbing m"]) expect(screen.getByLabelText(`${label} step 2`)).toBeTruthy();
  });

  it("the clock's times show; a skipped or not ridden step takes no numbers", () => {
    results("indoor", { 1: log({ durationSeconds: 905 }), 2: log({ status: "skipped", durationSeconds: 0 }) });
    expect(screen.getByTestId("result-time-1").textContent).toBe("15:05");
    expect(screen.getByTestId("result-time-2").textContent).toBe("Skipped");
    expect(screen.getByTestId("result-time-3").textContent).toBe("Not ridden");
    expect((screen.getByLabelText("Avg W step 2") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("Avg W step 3") as HTMLInputElement).disabled).toBe(true);
  });

  it("Done saves typed fields as typed, keeps the clock's time, and the effort once on each ridden step", async () => {
    results("indoor", { 1: log({ status: "partial", durationSeconds: 600 }), 2: log(), 3: log({ durationSeconds: 300 }) });
    fireEvent.change(screen.getByLabelText("Avg W step 2"), { target: { value: "141" } });
    fireEvent.click(screen.getByRole("button", { name: "6" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/programs/1/workout/exercises/2"));
    expect(logWithRetry).toHaveBeenCalledTimes(3);
    const [a, b] = logWithRetry.mock.calls.map((c) => c[0]);
    expect(a).toMatchObject({ sessionId: 7, programSetId: 1, durationSeconds: 600, stepStatus: "partial", rpe: 6, sources: {} });
    expect(b).toMatchObject({ programSetId: 2, setNumber: 2, durationSeconds: 900, avgPower: 141, rpe: 6, sources: { avgPower: "typed" } });
  });

  it("only one effort is chosen; a second tap clears it", () => {
    results("indoor", { 1: log() });
    const group = screen.getByRole("group", { name: "Effort of the ride" });
    fireEvent.click(within(group).getByRole("button", { name: "6" }));
    fireEvent.click(within(group).getByRole("button", { name: "8" }));
    expect(within(group).getAllByRole("button").filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.textContent)).toEqual(["8"]);
    fireEvent.click(within(group).getByRole("button", { name: "8" }));
    expect(within(group).getAllByRole("button").some((b) => b.getAttribute("aria-pressed") === "true")).toBe(false);
  });

  it("a number out of range blocks Done", () => {
    results("indoor", { 1: log() });
    fireEvent.change(screen.getByLabelText("Avg HR step 1"), { target: { value: "400" } });
    expect(screen.getByLabelText("Avg HR step 1").getAttribute("aria-invalid")).toBe("true");
    expect((screen.getByRole("button", { name: "Done" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toBe("Check the marked numbers.");
  });

  it("Waiting for your Garmin ride only with Garmin; Later goes where it is told", () => {
    const { unmount } = results("indoor", { 1: log() }, { garminWaiting: true, laterHref: "/programs/1/workout" });
    expect(screen.getByTestId("garmin-waiting").textContent).toBe("Waiting for your Garmin ride. It fills the numbers.");
    expect(screen.getByRole("link", { name: "Later" }).getAttribute("href")).toBe("/programs/1/workout");
    unmount();
    results("indoor", { 1: log() });
    expect(screen.queryByTestId("garmin-waiting")).toBeNull();
  });

  it("by hand: the time field says Minutes when empty and marks a time it cannot read or that is too long", () => {
    results("indoor", {}, { hand: true, sessionId: null });
    const t = screen.getByLabelText("Time step 1") as HTMLInputElement;
    expect(t.placeholder).toBe("Minutes");
    fireEvent.change(t, { target: { value: "1530" } });
    expect(t.getAttribute("aria-invalid")).toBe("false");
    fireEvent.change(t, { target: { value: "11:00:00" } });
    expect(t.getAttribute("aria-invalid")).toBe("true");
    expect((screen.getByRole("button", { name: "Done" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("by hand: a cleared time un-logs that step through the queue", async () => {
    results("indoor", { 1: log(), 2: log() }, { hand: true, sessionId: 9 });
    fireEvent.change(screen.getByLabelText("Time step 1"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(unlogWithRetry).toHaveBeenCalledWith({ sessionId: 9, exerciseId: 3, setNumber: 1, programSetId: 1 });
    expect(logWithRetry.mock.calls.map((c) => c[0].programSetId)).not.toContain(1);
  });

  it("by hand: writes to the session the table read, and points the phone at it", async () => {
    results("indoor", { 1: log() }, { hand: true, sessionId: 12, sessionStart: "2026-11-17T10:00:00.000Z" });
    fireEvent.change(screen.getByLabelText("Avg W step 1"), { target: { value: "120" } });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(logWithRetry.mock.calls.every((c) => c[0].sessionId === 12)).toBe(true);
    expect(setActiveWorkout).toHaveBeenCalledWith(1, "2026-11-17T10:00:00.000Z", 12);
  });

  it("by hand: times start at the plan, are typed, and Done goes back to the workout with the phone's session", async () => {
    results("indoor", {}, { hand: true, sessionId: null });
    expect(screen.queryByRole("link", { name: "Later" })).toBeNull();
    expect((screen.getByLabelText("Time step 1") as HTMLInputElement).value).toBe("15:00");
    fireEvent.change(screen.getByLabelText("Time step 2"), { target: { value: "14:30" } });
    fireEvent.change(screen.getByLabelText("Time step 3"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/programs/1/workout"));
    expect(logWithRetry.mock.calls.map((c) => [c[0].sessionId, c[0].programSetId, c[0].durationSeconds, c[0].sources.durationSeconds])).toEqual([
      [9, 1, 900, "typed"],
      [9, 2, 870, "typed"],
    ]);
  });
});

describe("RideSummary", () => {
  const summary = (logs: Record<number, StepLog>) =>
    render(<RideSummary programId={1} exerciseName="Bike" doneLine="Done 17:12 · Indoor trainer" summary={rideSummary(plan("indoor"), logs)} doneHref="/" saveTheRide={false} />);

  it("tiles, est. on the load, the zone bar and ↓ under the target", () => {
    summary({ 1: log({ avgPower: 124, rpe: 6 }), 2: log({ avgPower: 131, rpe: 6 }), 3: log({ durationSeconds: 300, avgPower: 92, rpe: 6 }) });
    const tiles = screen.getByTestId("summary-tiles");
    expect(within(tiles).getByTestId("tile-Avg W").textContent).toBe("Avg W122");
    expect(within(tiles).getByTestId("tile-Load").textContent).toContain("est.");
    expect(within(tiles).queryByTestId("tile-NP")).toBeNull();
    expect(within(tiles).queryByTestId("tile-IF")).toBeNull();
    expect(screen.getByTestId("summary-zones")).toBeTruthy();
    const rows = screen.getAllByTestId("summary-row");
    expect(within(rows[1]).getByLabelText("under target")).toBeTruthy();
    expect(within(rows[0]).queryByLabelText("under target")).toBeNull();
    expect(screen.queryByTestId("summary-plan-only")).toBeNull();
  });

  it("times only: Plan only with Add numbers to the results table", () => {
    summary({ 1: log(), 2: log() });
    const row = screen.getByTestId("summary-plan-only");
    expect(row.textContent).toContain("Plan only · no ride numbers");
    expect(within(row).getByRole("link", { name: "Add numbers" }).getAttribute("href")).toBe("/programs/1/workout/exercises/2?results=1");
    expect(screen.getAllByTestId("summary-row").map((r) => r.textContent)).toContain("Easy" + "under 97" + "Not ridden");
  });

  it("Save the ride when the workout is still open", () => {
    render(<RideSummary programId={1} exerciseName="Bike" doneLine="Ended early 17:12 · Indoor trainer" summary={rideSummary(plan("indoor"), { 1: log() })} doneHref="/" saveTheRide />);
    expect(screen.getByRole("link", { name: "Save the ride" }).getAttribute("href")).toBe("/programs/1/workout/exercises/2?ride=1");
    expect(screen.getByTestId("summary-line").textContent).toBe("Ended early 17:12 · Indoor trainer");
  });
});
