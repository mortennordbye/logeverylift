// @vitest-environment jsdom
import { BottomNav } from "@/components/ui/bottom-nav";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/** The tab bar marks the tab of the page the user is on. */

const nav = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));
vi.mock("@/contexts/workout-session-context", () => ({ useWorkoutSession: () => null }));
vi.mock("@/lib/actions/friends", () => ({ getFriendsBadgeCount: vi.fn(async () => ({ success: true, data: 0 })) }));

const marked = () => screen.getAllByRole("link").filter((l) => l.getAttribute("aria-current") === "page").map((l) => l.textContent);

describe("the active tab", () => {
  it.each(["/cycles", "/cycles/12", "/seasons/7", "/seasons/7/history"])("is Plan on %s", (path) => {
    nav.pathname = path;
    render(<BottomNav />);
    expect(marked()).toEqual(["Plan"]);
  });

  it("is More on a More page", () => {
    nav.pathname = "/more/metrics";
    render(<BottomNav />);
    expect(marked()).toEqual(["More"]);
  });
});
