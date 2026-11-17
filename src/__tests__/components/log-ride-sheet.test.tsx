// @vitest-environment jsdom
import { LogRunModal } from "@/components/features/LogRunModal";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * The bike has no default distance (docs/plans/bike-ride-logger.md, D2): a
 * 15 min set once opened at 40 km and showed 160 km/h. The sheet starts empty
 * and shows a speed only once a distance is typed. A run keeps its 5 km.
 */

vi.mock("@/contexts/user-settings-context", () => ({ useUnits: () => ({ distance: "km", swim: "m" }) }));

function sheet(discipline: "bike" | "run", onConfirm = vi.fn()) {
  render(
    <LogRunModal open onClose={() => {}} discipline={discipline} onConfirm={onConfirm} targetDurationSeconds={900} setNumber={1} totalSets={1} />,
  );
  return onConfirm;
}

const distanceInput = () => screen.getAllByRole("textbox")[0] as HTMLInputElement;

describe("LogRunModal for a ride", () => {
  it("starts with no distance and no speed, and logs the time alone", () => {
    const onConfirm = sheet("bike");
    expect(distanceInput().value).toBe("");
    expect(screen.queryByText(/km\/h/)).toBeNull();
    const log = screen.getByRole("button", { name: "Log Ride" });
    expect((log as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(log);
    expect(onConfirm).toHaveBeenCalledWith(0, 900, 7, null, null);
  });

  it("shows the speed once a distance is typed", () => {
    sheet("bike");
    fireEvent.change(distanceInput(), { target: { value: "8" } });
    expect(screen.getAllByText(/32(\.0)? km\/h/).length).toBeGreaterThan(0);
  });

  it("keeps the 5 km default for a run", () => {
    sheet("run");
    expect(distanceInput().value).toBe("5");
  });
});
