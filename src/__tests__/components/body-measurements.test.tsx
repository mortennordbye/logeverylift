// @vitest-environment jsdom
import { MeasureLogClient } from "@/components/features/measurements/MeasureLogClient";
import { MeasurementsClient } from "@/components/features/measurements/MeasurementsClient";
import { PartClient } from "@/components/features/measurements/PartClient";
import { TrendLine } from "@/components/features/measurements/measurement-ui";
import { partOf } from "@/lib/utils/body-measurement-parts";
import type { MeasurementRow } from "@/lib/utils/body-measurements";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const save = vi.fn();
vi.mock("@/lib/actions/body-measurements", () => ({
  saveBodyMeasurement: (d: unknown) => save(d),
  deleteBodyMeasurement: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }) }));

let id = 0;
const row = (measuredOn: string, valueCm: number, site: MeasurementRow["site"] = "waist", side: MeasurementRow["side"] = "none"): MeasurementRow => ({
  id: ++id,
  site,
  side,
  valueCm,
  measuredOn,
});

/** The save answers with the row it was sent. */
const saves = () =>
  save.mockImplementation(async (d: Omit<MeasurementRow, "id">) => ({ success: true, data: { id: ++id, ...d } }));

beforeEach(() => {
  save.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-21T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

const TODAY = "2026-11-21";
// A length is logged, so the flow has the 13 circumference steps only.
const LENGTH = row("2026-01-10", 80, "arm-length");

const click = (name: string) => act(async () => fireEvent.click(screen.getByRole("button", { name, exact: true } as never)));
const skipAll = async (n: number) => {
  for (let i = 0; i < n; i++) await click("Skip");
};

describe("MeasureLogClient", () => {
  it("forgets the values saved for the old date when the log date changes", async () => {
    saves();
    render(<MeasureLogClient rows={[LENGTH]} today={TODAY} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Neck in cm" }), { target: { value: "39" } });
    await click("Next");
    await click("Back to the previous step");
    expect(screen.getByRole("textbox", { name: "Neck in cm" })).toHaveProperty("value", "39.0");

    // Back on step 1, the user logs an older date: nothing is saved on it yet.
    await act(async () => fireEvent.change(screen.getByLabelText("Log date"), { target: { value: "2026-10-01" } }));
    expect(screen.getByRole("textbox", { name: "Neck in cm" })).toHaveProperty("value", "");

    await skipAll(13);
    expect(screen.getByTestId("done-row-neck").textContent).toContain("Skipped");
    expect(screen.getByText(/0 of 13 values/)).toBeTruthy();

    // The same value typed for the new date is written to the new date.
    await act(async () => fireEvent.click(screen.getByTestId("done-row-neck")));
    fireEvent.change(screen.getByRole("textbox", { name: "Neck in cm" }), { target: { value: "39" } });
    await click("Save");
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ site: "neck", valueCm: 39, measuredOn: "2026-10-01" }));
  });

  it("does not carry an old save error into the Done screen and the correction sheet", async () => {
    save.mockResolvedValueOnce({ success: false, error: "Failed to save" });
    render(<MeasureLogClient rows={[LENGTH]} today={TODAY} />);
    await skipAll(12);
    fireEvent.change(screen.getByRole("textbox", { name: "Calf · left in cm" }), { target: { value: "38" } });
    await click("Next");
    expect(screen.getByRole("alert").textContent).toBe("Failed to save");
    await click("Skip");

    await act(async () => fireEvent.click(screen.getByTestId("done-row-neck")));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("one date of a sided part", () => {
  const calf = [row("2026-11-01", 38, "calf", "left"), row("2026-11-01", 39, "calf", "right")];

  it("puts the points in the middle of the trend line", () => {
    const { container } = render(<TrendLine series={[calf.slice(0, 1), calf.slice(1)]} width={48} height={20} />);
    const xs = [...container.querySelectorAll("circle")].map((c) => c.getAttribute("cx"));
    expect(xs).toEqual(["24", "24"]);
  });

  it("shows no chart with the same date at both ends on the part page", () => {
    render(<PartClient part={partOf("calf")!} rows={calf} today={TODAY} />);
    // Only the two history rows name the date.
    expect(screen.getAllByText("1 Nov")).toHaveLength(2);
  });
});

describe("the part page history", () => {
  it("shows the year of a date outside the current year", () => {
    render(<PartClient part={partOf("waist")!} rows={[row("2025-11-01", 92), row("2026-11-01", 90)]} today={TODAY} />);
    const rows = screen.getAllByTestId("history-row");
    expect(within(rows[0]).getByText("1 Nov")).toBeTruthy();
    expect(within(rows[1]).getByText("1 Nov 2025")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete 1 Nov 2025" })).toBeTruthy();
  });
});

describe("the body map", () => {
  it("makes each point a link with a name and a tap area of 44 px at 320 px wide", () => {
    const { container } = render(<MeasurementsClient rows={[]} today={TODAY} gender={null} heightCm={null} />);
    const waist = screen.getByRole("link", { name: "Waist" });
    expect(waist.getAttribute("href")).toBe("/more/account/measurements/waist");

    // At 320 px the map is 272 px wide (gutters 2 x 16 and 2 x 8) for 340 units.
    const minUnits = 44 / (272 / 340);
    const svg = container.querySelector('svg[viewBox="0 0 340 392"]')!;
    const areas = [...svg.querySelectorAll("a rect")].map((r) => ({
      x: Number(r.getAttribute("x")),
      y: Number(r.getAttribute("y")),
      h: Number(r.getAttribute("height")),
    }));
    expect(areas).toHaveLength(9);
    for (const a of areas) expect(a.h).toBeGreaterThanOrEqual(minUnits);
    // Points on the same side do not share any of their tap area.
    for (const side of [areas.filter((a) => a.x === 0), areas.filter((a) => a.x !== 0)]) {
      const sorted = [...side].sort((a, b) => a.y - b.y);
      for (let i = 1; i < sorted.length; i++) expect(sorted[i].y).toBeGreaterThanOrEqual(sorted[i - 1].y + sorted[i - 1].h);
    }
  });
});
