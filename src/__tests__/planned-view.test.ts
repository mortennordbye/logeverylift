import { describe, expect, it, vi } from "vitest";
import { playerSession } from "@/lib/planned-view";
import { parseWorkout } from "@/lib/utils/workout-steps";
import { DEFAULT_UNITS } from "@/lib/utils/units";
import { APP_FTP, GARMIN_CYCLING_ZONES, TEMPO_WORKOUT } from "./fixtures/bike-sessions";

// playerSession is pure; the module also imports server code that reads the env and the database.
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/env", () => ({ env: {} }));

describe("playerSession: the player's second line (docs/plans/bike-sessions.md 5.4)", () => {
  const r = parseWorkout(TEMPO_WORKOUT);
  if (!r.ok) throw new Error();

  it("carries % FTP, the second target with its zone, and cadence as text", () => {
    const steps = playerSession(1, r.workout, { ftp: APP_FTP }, DEFAULT_UNITS, GARMIN_CYCLING_ZONES).steps;
    expect(steps[1]).toMatchObject({ targetText: "135-144 W", pctFtpText: "75-80% FTP", secondaryText: "141-160 bpm", secondaryZoneText: "Garmin Z3", cadenceText: "85-95 rpm" });
    expect(steps[2]).toMatchObject({ targetText: "90-108 W", secondaryText: "under 140 bpm", secondaryZoneText: "Garmin Z2", cadenceText: null });
  });

  it("falls back to the estimate with no zones", () => {
    const steps = playerSession(1, r.workout, { ftp: APP_FTP, lthr_bike: 175 }, DEFAULT_UNITS).steps;
    expect(steps[1]).toMatchObject({ secondaryText: "158-163 bpm", secondaryZoneText: "Z3 (estimate)" });
  });
});
