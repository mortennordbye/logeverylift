import { toDateStr } from "@/lib/utils/cycle-position";
import { isValidTimeZone, localDateStr, todayIn, weekDatesOf } from "@/lib/utils/user-date";
import { describe, expect, it } from "vitest";

describe("localDateStr", () => {
  it.each([
    // [instant, Oslo, New York, UTC]
    ["2026-11-02T22:59:00Z", "2026-11-02", "2026-11-02", "2026-11-02"],
    ["2026-11-02T23:00:00Z", "2026-11-03", "2026-11-02", "2026-11-02"],
    ["2026-11-02T23:30:00Z", "2026-11-03", "2026-11-02", "2026-11-02"],
    ["2026-11-03T00:30:00Z", "2026-11-03", "2026-11-02", "2026-11-03"],
    ["2026-11-03T05:30:00Z", "2026-11-03", "2026-11-03", "2026-11-03"],
  ])("at %s is %s in Oslo, %s in New York, %s in UTC", (iso, oslo, ny, utc) => {
    const now = new Date(iso);
    expect(localDateStr(now, "Europe/Oslo")).toBe(oslo);
    expect(localDateStr(now, "America/New_York")).toBe(ny);
    expect(localDateStr(now, "UTC")).toBe(utc);
  });

  it("follows summer time: Oslo midnight is 22:00 UTC in July", () => {
    expect(localDateStr(new Date("2026-07-14T21:59:00Z"), "Europe/Oslo")).toBe("2026-07-14");
    expect(localDateStr(new Date("2026-07-14T22:00:00Z"), "Europe/Oslo")).toBe("2026-07-15");
  });

  it("keeps the date across the spring and autumn clock changes", () => {
    expect(localDateStr(new Date("2026-03-29T01:30:00Z"), "Europe/Oslo")).toBe("2026-03-29");
    expect(localDateStr(new Date("2026-10-25T00:30:00Z"), "Europe/Oslo")).toBe("2026-10-25");
  });

  it("falls back to the runtime's own zone with no zone or an unknown one", () => {
    const now = new Date("2026-11-02T23:30:00Z");
    expect(localDateStr(now, null)).toBe(toDateStr(now));
    expect(localDateStr(now, "Mars/Olympus")).toBe(toDateStr(now));
  });
});

describe("todayIn", () => {
  it("gives local midnight of the user's date", () => {
    const today = todayIn("Europe/Oslo", new Date("2026-11-02T23:30:00Z"));
    expect(toDateStr(today)).toBe("2026-11-03");
    expect([today.getHours(), today.getMinutes()]).toEqual([0, 0]);
  });
});

describe("weekDatesOf", () => {
  it("gives Monday to Sunday of the week", () => {
    expect(weekDatesOf("2026-11-04")).toEqual([
      "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08",
    ]);
  });

  it("puts a Sunday in the week that began the Monday before", () => {
    expect(weekDatesOf("2026-11-08")[0]).toBe("2026-11-02");
    expect(weekDatesOf("2026-11-09")[0]).toBe("2026-11-09");
  });

  it("crosses a month and a year", () => {
    expect(weekDatesOf("2027-01-01")).toEqual([
      "2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03",
    ]);
  });
});

describe("isValidTimeZone", () => {
  it("knows IANA names and refuses others", () => {
    expect(isValidTimeZone("Europe/Oslo")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  });
});
