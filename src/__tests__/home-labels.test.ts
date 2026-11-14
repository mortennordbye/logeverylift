import { describe, expect, it } from "vitest";
import { dayMonth } from "@/lib/home/labels";

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
