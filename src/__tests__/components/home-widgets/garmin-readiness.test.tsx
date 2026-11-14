// @vitest-environment jsdom
import type { Readiness } from "@/lib/garmin/analytics/readiness";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * C3: Garmin readiness from a fixture (e2e accounts are not Garmin users by
 * default), at each size, without a connection, without a score, and failing.
 */

const load = vi.fn();
vi.mock("@/components/features/home/widgets/garmin-readiness/load", () => ({ loadGarminReadiness: (...a: unknown[]) => load(...a) }));

const { garminReadinessWidget: w } = await import("@/components/features/home/widgets/garmin-readiness/View");
const { streamedContent } = await import("@/components/features/home/render-widget");

const readiness: Readiness = {
  score: 72,
  band: "as_planned",
  signals: 5,
  capped: false,
  contributors: [
    { key: "hrv", score: 64, detail: "7-day 58 ms, band 50–66" },
    { key: "sleep", score: 40, detail: "6h 10m" },
  ],
};
const ctx = { userId: "u1", role: "admin", today: "2026-11-13" };

describe("Garmin readiness", () => {
  it("S shows the score, the word and two contributors", () => {
    render(<>{w.View({ data: { connected: true, readiness }, size: "s" })}</>);
    expect(screen.getByText("72")).toBeTruthy();
    expect(screen.getByText("Train as planned")).toBeTruthy();
    expect(screen.getByRole("img", { name: "HRV 64 of 100" })).toBeTruthy();
    expect(screen.queryByText("5 of 6 signals")).toBeNull();
  });

  it("M adds the contributor bars", () => {
    render(<>{w.View({ data: { connected: true, readiness }, size: "m" })}</>);
    expect(screen.getByText("72")).toBeTruthy();
    expect(screen.getByRole("img", { name: "HRV 64 of 100" })).toBeTruthy();
    expect(screen.getByText("5 of 6 signals")).toBeTruthy();
  });

  it("M names both sleep rows in full, with no cut-off label (owner report, 2026-11-14)", () => {
    const all: Readiness = {
      ...readiness,
      contributors: [
        { key: "restingHr", score: 0, detail: "49 bpm, normal 45" },
        { key: "sleep", score: 100, detail: "110 % of need" },
        { key: "sleepDebt", score: 96, detail: "0.4 h over 14 nights" },
        { key: "form", score: 74, detail: "TSB 0" },
      ],
    };
    const m = render(<>{w.View({ data: { connected: true, readiness: all }, size: "m" })}</>);
    expect(screen.getByText("Sleep")).toBeTruthy();
    expect(screen.getByText("Sleep debt")).toBeTruthy();
    expect(m.container.querySelector("li .truncate")).toBeNull();
    m.unmount();
    const s = render(<>{w.View({ data: { connected: true, readiness: { ...all, contributors: all.contributors.slice(1) } }, size: "s" })}</>);
    expect(screen.getByText("Debt")).toBeTruthy();
    expect(s.container.querySelector("li .truncate")).toBeNull();
  });

  it("without a connection it offers Connect Garmin", () => {
    render(<>{w.View({ data: { connected: false }, size: "m" })}</>);
    expect(screen.getByRole("link", { name: "Connect Garmin" }).getAttribute("href")).toBe("/more/garmin");
  });

  it("without a score today it says so", () => {
    render(<>{w.View({ data: { connected: true, readiness: null }, size: "s" })}</>);
    expect(screen.getByText("Not enough signals for today yet.")).toBeTruthy();
  });

  it("a failing loader shows \"Couldn't load this.\"", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    load.mockRejectedValueOnce(new Error("db down"));
    render(<>{await streamedContent("garminReadiness", w, ctx, "m")}</>);
    expect(screen.getByText("Couldn't load this.")).toBeTruthy();
  });
});
