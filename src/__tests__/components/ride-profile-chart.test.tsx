// @vitest-environment jsdom
import { RideProfileChart } from "@/components/features/bike/RideProfileChart";
import { timeTicks } from "@/lib/utils/bike-ride-view";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("RideProfileChart time axis", () => {
  it("a session under 7.5 min has one tick, its length, anchored at the right end so it is not cut", () => {
    const xTicks = timeTicks(5 * 60);
    expect(xTicks.map((t) => t.label)).toEqual(["5 min"]);
    const { container } = render(<RideProfileChart chart={{ bars: [], bands: [], ftpY: null, yTicks: [], xTicks }} label="Profile" />);
    const label = [...container.querySelectorAll("text")].find((t) => t.textContent === "5 min")!;
    expect(label.getAttribute("text-anchor")).toBe("end");
  });

  it("drops the last minute tick when its label would touch the end label: 135 min has no 120", () => {
    expect(timeTicks(135 * 60).map((t) => t.label)).toEqual(["0", "30", "60", "90", "135 min"]);
    // A tick with room before the end label stays.
    expect(timeTicks(90 * 60).map((t) => t.label)).toEqual(["0", "15", "30", "45", "60", "75", "90 min"]);
    expect(timeTicks(150 * 60).map((t) => t.label)).toEqual(["0", "30", "60", "90", "120", "150 min"]);
  });
});
