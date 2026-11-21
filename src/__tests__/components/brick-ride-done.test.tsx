// @vitest-environment jsdom
import { BrickRideDone } from "@/components/features/run/BrickRideDone";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn() }), usePathname: () => "/programs/1/workout/exercises/2" }));

describe("BrickRideDone", () => {
  it("names a ride that ended early as ended early, and offers Start run", () => {
    render(<BrickRideDone programId={1} exerciseName="Bike" doneLine="Ended early 18:00 · Indoor trainer" endedEarly runHref="/programs/2/workout/exercises/3" />);
    expect(screen.getByRole("heading").textContent).toBe("Ride ended early");
    expect(screen.getByRole("link", { name: "Start run" }).getAttribute("href")).toBe("/programs/2/workout/exercises/3");
  });

  it("a finished ride is Ride done", () => {
    render(<BrickRideDone programId={1} exerciseName="Bike" doneLine="Done 18:00 · Indoor trainer" endedEarly={false} runHref="/x" />);
    expect(screen.getByRole("heading").textContent).toBe("Ride done");
  });
});
