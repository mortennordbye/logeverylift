import { keepDates } from "@/lib/utils/keep-dates";
import { describe, expect, it } from "vitest";

const nb = (s: string) => s.replace(/_/g, " ");

describe("keepDates", () => {
  it("joins a weekday, day, month and year", () => {
    expect(keepDates("Starts Mon 14 Dec")).toBe(nb("Starts Mon_14_Dec"));
    expect(keepDates("9 Nov 2026 to 29 Aug 2027")).toBe(nb("9_Nov_2026 to 29_Aug_2027"));
  });

  it("keeps a range dash with the date before it", () => {
    expect(keepDates("Base · 15 wk · 28 Dec – 11 Apr")).toBe(nb("Base_· 15_wk_· 28_Dec_– 11_Apr"));
    expect(keepDates("20 – 29 Aug")).toBe(nb("20_– 29_Aug"));
  });

  it("keeps a separator dot with the part before it, so no line starts with one (J4-17, J7-02)", () => {
    expect(keepDates("Not started · Starts 14 Dec")).toBe(nb("Not started_· Starts 14_Dec"));
  });

  it("joins counts: week 3 of 6, 90 days, a number and its unit (J3-09, J7-09, J8-06)", () => {
    expect(keepDates("This ends Base at week 3 of 6.")).toBe(nb("This ends Base at week_3_of_6."));
    expect(keepDates("You can restore it for 90 days.")).toBe(nb("You can restore it for 90_days."));
    expect(keepDates("Week 2 of 6 · 8 wk")).toBe(nb("Week_2_of_6_· 8_wk"));
    expect(keepDates("Position 2 of 5")).toBe(nb("Position_2_of_5"));
    expect(keepDates("Bike 6 min")).toBe(nb("Bike 6_min"));
  });

  it("leaves other words alone", () => {
    expect(keepDates("Monday 3 Mayday")).toBe("Monday 3 Mayday");
    expect(keepDates("5 × 6 intervals")).toBe("5 × 6 intervals");
  });
});
