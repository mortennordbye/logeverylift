import { dayMonth } from "@/lib/home/labels";
import { weekRangeLabel } from "@/lib/utils/cycle-detail";
import { keepDates } from "@/lib/utils/keep-dates";
import { rangeLabel, shortDay } from "@/lib/utils/seasons";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * A date shows its year when it is not in the current year, and a range shows
 * the year when its ends are in different years or not in the current year
 * (round 11 I2): a 52-week block started 15 Nov read "Started 15 Nov · Ends
 * 13 Nov", which reads backwards.
 */

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-15T12:00:00Z"));
});
afterAll(() => vi.useRealTimers());

describe("dayMonth", () => {
  it("shows no year in the current year", () => {
    expect(dayMonth("2026-11-15")).toBe("15 Nov");
  });
  it("shows the year in another year", () => {
    expect(dayMonth("2027-11-13")).toBe("13 Nov 2027");
    expect(dayMonth("2025-03-02")).toBe("2 Mar 2025");
  });
});

describe("shortDay", () => {
  it("shows no year in the current year", () => {
    expect(shortDay("2026-11-16")).toBe("Mon 16 Nov");
  });
  it("shows the year in another year", () => {
    expect(shortDay("2027-01-01")).toBe("Fri 1 Jan 2027");
    expect(shortDay("2027-01-01").slice(4)).toBe("1 Jan 2027");
  });
});

describe("rangeLabel", () => {
  it("shows no year when both ends are in the current year", () => {
    expect(rangeLabel("2026-11-16", "2026-12-20")).toBe("16 Nov – 20 Dec");
    expect(rangeLabel("2026-11-16", "2026-11-26")).toBe("16 – 26 Nov");
    expect(rangeLabel("2026-11-16", "2026-11-16")).toBe("16 Nov");
  });
  it("shows both years when the ends are in different years", () => {
    expect(rangeLabel("2026-09-06", "2027-09-03")).toBe("6 Sep 2026 – 3 Sep 2027");
    expect(rangeLabel("2026-12-28", "2027-01-03")).toBe("28 Dec 2026 – 3 Jan 2027");
  });
  it("shows the year once when both ends are in another year", () => {
    expect(rangeLabel("2027-08-17", "2027-08-26")).toBe("17 – 26 Aug 2027");
    expect(rangeLabel("2027-05-03", "2027-06-10")).toBe("3 May – 10 Jun 2027");
    expect(rangeLabel("2027-05-28", "2027-05-28")).toBe("28 May 2027");
  });
});

describe("weekRangeLabel", () => {
  it("follows the same rule", () => {
    expect(weekRangeLabel({ from: "2026-11-16", to: "2026-11-22" })).toBe("16–22 Nov");
    expect(weekRangeLabel({ from: "2027-03-01", to: "2027-03-07" })).toBe("1–7 Mar 2027");
    expect(weekRangeLabel({ from: "2026-12-28", to: "2027-01-03" })).toBe("28 Dec 2026 – 3 Jan 2027");
  });
});

describe("keepDates", () => {
  it("keeps a date with its year on one line", () => {
    expect(keepDates("Ends 13 Nov 2027")).toBe("Ends 13 Nov 2027");
  });
});
