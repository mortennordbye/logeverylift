// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn(), replace: vi.fn() }) }));

describe("loading skeletons", () => {
  it("show the page's parent as Back's label, as the page will", async () => {
    window.history.replaceState(null, "", "/settings");
    const { ListPageSkeleton } = await import("@/components/ui/PageSkeletons");
    render(<ListPageSkeleton title="Settings" back={{ href: "/more", label: "More" }} />);
    expect(screen.getByText("More")).toBeTruthy();
    expect(screen.queryByText("Back")).toBeNull();
  });

  it.each([
    ["week", () => import("@/app/week/loading")],
    ["guided session", () => import("@/app/planned/[id]/play/loading")],
    ["pool view", () => import("@/app/planned/[id]/pool/loading")],
  ])("%s has no Back, as its page has none", async (_name, load) => {
    const { default: Loading } = await load();
    const { container } = render(<Loading />);
    expect(container.textContent).not.toMatch(/Back/);
    expect(container.querySelector("svg.lucide-chevron-left")).toBeNull();
  });
});
