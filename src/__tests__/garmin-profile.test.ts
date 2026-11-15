import { showGarminSays, sourceLine } from "@/lib/utils/field-sources";
import { fieldSyncLines, garminAvailability, garminTimeZone, garminUnits } from "@/lib/utils/garmin-profile";
import { describe, expect, it } from "vitest";

describe("the Garmin profile fields the sync reads", () => {
  it("turns training days into 1 (Monday) to 7, with the first long day", () => {
    expect(garminAvailability({ availableTrainingDays: ["SATURDAY", "MONDAY", "wednesday", "MONDAY"], preferredLongTrainingDays: ["SATURDAY", "SUNDAY"] })).toEqual({
      availableDays: [1, 3, 6],
      longDay: 6,
    });
    expect(garminAvailability({ availableTrainingDays: ["TUESDAY"] })).toEqual({ availableDays: [2], longDay: null });
  });

  it("has no availability without training days", () => {
    expect(garminAvailability({ availableTrainingDays: null, preferredLongTrainingDays: ["SUNDAY"] })).toBeNull();
    expect(garminAvailability({ availableTrainingDays: ["NOPE"] })).toBeNull();
    expect(garminAvailability(null)).toBeNull();
  });

  it("maps the measurement system to distance and swim units", () => {
    expect(garminUnits({ measurementSystem: "metric" })).toEqual({ distance: "km", swim: "m" });
    expect(garminUnits({ measurementSystem: "statute_us" })).toEqual({ distance: "mi", swim: "yd" });
    expect(garminUnits({ measurementSystem: "statute_uk" })).toEqual({ distance: "mi", swim: "m" });
    expect(garminUnits({ measurementSystem: "other" })).toBeNull();
    expect(garminUnits({})).toBeNull();
  });

  it("takes only a real IANA time zone", () => {
    expect(garminTimeZone({ timeZone: "Europe/Oslo" })).toBe("Europe/Oslo");
    expect(garminTimeZone({ timeZone: "Not/AZone" })).toBeNull();
    expect(garminTimeZone({ timeZone: "" })).toBeNull();
    expect(garminTimeZone({})).toBeNull();
  });
});

describe("sourceLine", () => {
  it("names who set the value and the day", () => {
    expect(sourceLine({ by: "garmin", on: "2026-11-15" })).toBe("From Garmin · Sun 15 Nov");
    expect(sourceLine({ by: "you", on: "2026-11-15" })).toBe("Set by you · Sun 15 Nov");
  });
});

describe("fieldSyncLines", () => {
  const profile = { timeZone: "America/New_York", measurementSystem: "metric", availableTrainingDays: ["MONDAY"] };
  const stored = { timeZone: "Europe/Oslo", units: { distance: "km" as const, swim: "m" as const }, availability: { availableDays: [2], longDay: null } };

  it("shows Garmin's value only on a locked field that differs", () => {
    const locked = fieldSyncLines(profile, { ...stored, sources: { timeZone: { by: "you", on: "2026-11-15" }, availability: { by: "garmin", on: "2026-11-15" } } });
    expect(locked.timeZone).toEqual({ note: "Set by you · Sun 15 Nov", says: "America/New York" });
    expect(locked.availability).toEqual({ note: "From Garmin · Sun 15 Nov", says: null });
    expect(locked.units).toEqual({ note: null, says: null });
  });

  it("leaves availability out when it is not open to the user", () => {
    expect(fieldSyncLines(profile, { ...stored, availability: null, sources: {} }).availability).toBeUndefined();
  });
});

describe("showGarminSays", () => {
  it("offers every differing estimate while the sync is off", () => {
    expect(showGarminSays(false, undefined)).toBe(true);
    expect(showGarminSays(false, { source: "garmin" })).toBe(true);
    expect(showGarminSays(false, { source: "manual" })).toBe(true);
  });

  it("offers it only on a typed or tested value while the sync is on", () => {
    expect(showGarminSays(true, undefined)).toBe(false);
    expect(showGarminSays(true, { source: "garmin" })).toBe(false);
    expect(showGarminSays(true, { source: "manual" })).toBe(true);
    expect(showGarminSays(true, { source: "test" })).toBe(true);
  });
});
