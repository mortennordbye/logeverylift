import { keepDates } from "@/lib/utils/keep-dates";
import { describe, expect, it } from "vitest";

const nb = (s: string) => s.replace(/_/g, " ");

describe("keepDates", () => {
  it("joins a weekday, day, month and year", () => {
    expect(keepDates("Starts Mon 14 Dec")).toBe(nb("Starts Mon_14_Dec"));
    expect(keepDates("9 Nov 2026 to 29 Aug 2027")).toBe(nb("9_Nov_2026 to 29_Aug_2027"));
  });

  it("keeps a range dash with the date before it", () => {
    expect(keepDates("Base · 15 wk · 28 Dec – 11 Apr")).toBe(nb("Base · 15 wk · 28_Dec_– 11_Apr"));
    expect(keepDates("20 – 29 Aug")).toBe(nb("20_– 29_Aug"));
  });

  it("leaves other words alone", () => {
    expect(keepDates("Week 2 of 6 · 8 wk")).toBe("Week 2 of 6 · 8 wk");
    expect(keepDates("Monday 3 Mayday")).toBe("Monday 3 Mayday");
  });
});
