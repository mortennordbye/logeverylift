// @vitest-environment jsdom
import { RecordBox } from "@/components/features/bike/RecordBox";
import { StepCards } from "@/components/features/bike/StepCards";
import { YourNumbers } from "@/components/features/bike/YourNumbers";
import { numbersTable, recordLines, resolvedGroups } from "@/lib/utils/bike-view";
import { parseWorkout, type Workout } from "@/lib/utils/workout-steps";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { APP_FTP, GARMIN_CYCLING_ZONES, LTHR_BIKE, TEMPO_WORKOUT } from "../fixtures/bike-sessions";

/** The session page parts before the ride (docs/plans/bike-sessions.md, 5.2), with the tempo fixture. */

const r = parseWorkout(TEMPO_WORKOUT);
if (!r.ok) throw new Error("fixture does not parse");
const tempo: Workout = r.workout;
const anchors = { ftp: APP_FTP, lthr_bike: LTHR_BIKE };

describe("StepCards", () => {
  it("one card per step with big watts, cadence chip, HR chip and note", () => {
    render(<StepCards groups={resolvedGroups(tempo, anchors, undefined, GARMIN_CYCLING_ZONES)} />);
    const cards = screen.getAllByTestId("step-card");
    expect(cards).toHaveLength(5);
    const work = cards[1];
    expect(within(work).getByTestId("step-target").textContent).toBe("135-144 W");
    expect(within(work).getByText("85-95 rpm")).toBeTruthy();
    expect(within(work).getByText(/^HR \d+-\d+ bpm/)).toBeTruthy();
    expect(within(work).getByText("Talk in short sentences")).toBeTruthy();
    expect(within(work).getByText("min · hard")).toBeTruthy();
    expect(cards[0].textContent).toContain("HR under 140 bpm · Garmin Z2");
    expect(within(cards[2]).queryByText(/rpm/)).toBeNull();
  });
});

describe("RecordBox", () => {
  it("lists the Garmin steps for the tempo", () => {
    render(<RecordBox lines={recordLines(tempo, 5)} />);
    const box = screen.getByRole("region", { name: "Record on Garmin" });
    expect(within(box).getAllByRole("listitem").map((li) => li.textContent)).toContain("Start at the warm-up. Press Lap at each step change: 4 times.");
    expect(within(box).getByText("Auto Lap off. It is on now: your last ride has a lap every 5 km.")).toBeTruthy();
  });
});

describe("YourNumbers", () => {
  it("lists five power zones in watts and five HR zones in bpm, with a link to Thresholds", () => {
    const table = numbersTable(anchors, { ftp: { value: APP_FTP, basis: null, source: "manual", changedFrom: null }, watchFtp: null, zones: GARMIN_CYCLING_ZONES });
    render(<YourNumbers table={table} />);
    expect(screen.getByText("Power · FTP 180 W")).toBeTruthy();
    expect(screen.getByText("Heart rate · Garmin cycling zones")).toBeTruthy();
    expect(screen.getAllByText(/^((under|over) )?\d[\d-]* W$/)).toHaveLength(5);
    expect(screen.getAllByText(/^((under|over) )?\d[\d-]* bpm$/)).toHaveLength(5);
    expect(screen.getByRole("link", { name: "Thresholds" }).getAttribute("href")).toBe("/more/thresholds");
  });
});
