import { choiceFor, nextMonday, startDayFor, type StartDays } from "@/lib/utils/cycle-setup";
import { describe, expect, it } from "vitest";

const days: StartDays = { today: "2026-11-14", nextMonday: "2026-11-16", afterCurrent: "2026-12-21", latest: "2027-03-14" };

describe("nextMonday", () => {
  it.each([
    ["2026-11-14", "2026-11-16"], // Saturday
    ["2026-11-15", "2026-11-16"], // Sunday
    ["2026-11-16", "2026-11-23"], // Monday: a week ahead
    ["2026-12-30", "2027-01-04"], // across the year
  ])("%s gives %s", (today, monday) => {
    expect(nextMonday(today)).toBe(monday);
  });
});

describe("the start choice", () => {
  it("gives the day of each choice, and none for an empty date field", () => {
    expect(startDayFor("today", days, "")).toBe("2026-11-14");
    expect(startDayFor("monday", days, "")).toBe("2026-11-16");
    expect(startDayFor("after", days, "")).toBe("2026-12-21");
    expect(startDayFor("date", days, "2026-12-01")).toBe("2026-12-01");
    expect(startDayFor("date", days, "")).toBeNull();
    expect(startDayFor("after", { ...days, afterCurrent: null }, "")).toBeNull();
  });

  it("finds the choice again from a day", () => {
    expect(choiceFor("2026-11-14", days)).toBe("today");
    expect(choiceFor("2026-11-16", days)).toBe("monday");
    expect(choiceFor("2026-12-21", days)).toBe("after");
    expect(choiceFor("2026-12-01", days)).toBe("date");
  });
});
