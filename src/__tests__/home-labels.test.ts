import { afterAll, describe, expect, it, vi } from "vitest";
import { dayMonth } from "@/lib/home/labels";

// The fixed 2026 dates here read without a year only while the clock is in
// 2026 (yearSuffix in src/lib/utils/date-label.ts). Pinned at load, before any
// fixture below is built.
vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(new Date("2026-11-25T12:00:00Z"));
afterAll(() => vi.useRealTimers());

describe("dayMonth", () => {
  // Node's ICU formats en-GB September as "Sept" and WebKit as "Sep"; a
  // label made with toLocaleDateString differed between server and browser.
  it("writes September as Sep, the same on server and browser", () => {
    expect(dayMonth("2026-09-21")).toBe("21 Sep");
  });

  it("drops the leading zero of the day", () => {
    expect(dayMonth("2026-11-02")).toBe("2 Nov");
  });
});
