// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/** C3: Recent PRs at each size, empty and failing (docs/home-widgets-audit.md, section 7). */

const load = vi.fn();
vi.mock("@/components/features/home/widgets/recent-prs/load", () => ({ loadRecentPrs: (...a: unknown[]) => load(...a) }));

const { recentPrsWidget: w } = await import("@/components/features/home/widgets/recent-prs/View");
const { streamedContent } = await import("@/components/features/home/render-widget");

const prs = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, exercise: `Lift ${i + 1}`, value: `${100 + i} kg`, kind: "Heaviest set", date: "13 Nov" }));
const ctx = { userId: "u1", role: "user", today: "2026-11-13" };

describe("Recent PRs", () => {
  it("S shows the newest PR and links to the records", () => {
    render(<>{w.View({ data: prs, size: "s" })}</>);
    expect(screen.getByText("Lift 1")).toBeTruthy();
    expect(screen.getByText("100")).toBeTruthy();
    expect(screen.getByText("kg")).toBeTruthy();
    expect(screen.queryByText("Lift 2")).toBeNull();
    expect(screen.getByRole("link").getAttribute("href")).toBe("/more/metrics?tab=records");
  });

  it("M shows the last 3, L the last 6", () => {
    const m = render(<>{w.View({ data: prs, size: "m" })}</>);
    expect(m.container.querySelectorAll("li")).toHaveLength(3);
    m.unmount();
    const l = render(<>{w.View({ data: prs, size: "l" })}</>);
    expect(l.container.querySelectorAll("li")).toHaveLength(6);
  });

  it("empty: one line, never nothing", () => {
    render(<>{w.Empty({ size: "m" })}</>);
    expect(screen.getByText("No PRs yet. Log a workout to set your first.")).toBeTruthy();
  });

  it("a failing loader shows \"Couldn't load this.\"", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    load.mockRejectedValueOnce(new Error("db down"));
    render(<>{await streamedContent("recentPrs", w, ctx, "m")}</>);
    expect(screen.getByText("Couldn't load this.")).toBeTruthy();
  });

  it("null from the loader renders the empty state", async () => {
    load.mockResolvedValueOnce(null);
    render(<>{await streamedContent("recentPrs", w, ctx, "m")}</>);
    expect(screen.getByText(/No PRs yet/)).toBeTruthy();
  });
});
