// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/** C3: Friends' activity at each size, empty and failing (docs/home-widgets-audit.md, section 7). */

const load = vi.fn();
vi.mock("@/components/features/home/widgets/friends-activity/load", () => ({ loadFriendsActivity: (...a: unknown[]) => load(...a) }));

const { friendsActivityWidget: w } = await import("@/components/features/home/widgets/friends-activity/View");
const { streamedContent } = await import("@/components/features/home/render-widget");

const rows = Array.from({ length: 6 }, (_, i) => ({
  name: `Friend ${i + 1}`,
  image: null,
  date: "2026-11-12",
  programName: i === 0 ? null : "Push",
  setCount: i + 1,
  sessionId: 100 + i,
}));
const ctx = { userId: "u1", role: "user", today: "2026-11-13" };

describe("Friends' activity", () => {
  it("S shows the newest friend workout", () => {
    render(<>{w.View({ data: rows, size: "s" })}</>);
    expect(screen.getByText("Friend 1")).toBeTruthy();
    expect(screen.getByText("Workout · 1 set · 12 Nov")).toBeTruthy();
    expect(screen.queryByText("Friend 2")).toBeNull();
  });

  it("M shows the last 3, L the last 6", () => {
    const m = render(<>{w.View({ data: rows, size: "m" })}</>);
    expect(screen.getAllByTestId("friend-workout")).toHaveLength(3);
    m.unmount();
    render(<>{w.View({ data: rows, size: "l" })}</>);
    expect(screen.getAllByTestId("friend-workout")).toHaveLength(6);
    expect(screen.getByText("Push · 6 sets")).toBeTruthy();
  });

  it("empty: a link to add friends", () => {
    render(<>{w.Empty({ size: "m" })}</>);
    expect(screen.getByRole("link", { name: "Add friends to see their workouts" }).getAttribute("href")).toBe("/more/friends");
  });

  it("a failing loader shows \"Couldn't load this.\"", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    load.mockRejectedValueOnce(new Error("db down"));
    render(<>{await streamedContent("friendsActivity", w, ctx, "m")}</>);
    expect(screen.getByText("Couldn't load this.")).toBeTruthy();
  });
});
