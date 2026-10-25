// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// MapLibre needs WebGL; a stand-in that keeps each pin's element, so the test
// clicks the real button the component built.
const pins: HTMLElement[] = [];
vi.mock("maplibre-gl", () => {
  class Map {
    touchZoomRotate = { disableRotation: () => {} };
    fitBounds() {}
    remove() {}
  }
  class LngLatBounds {
    extend() {}
  }
  class Marker {
    constructor({ element }: { element: HTMLElement }) {
      pins.push(element);
    }
    setLngLat() {
      return this;
    }
    addTo() {
      return this;
    }
  }
  return { default: { Map, LngLatBounds, Marker } };
});
vi.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}));

type Member = { id: string; name: string; image: null; friendshipStatus: "none"; isMe: boolean };
const pending = new Map<number, (members: Member[]) => void>();
vi.mock("@/lib/actions/gyms", () => ({
  getGymMembers: ({ gymId }: { gymId: number }) =>
    new Promise((resolve) => pending.set(gymId, (data) => resolve({ success: true, data }))),
}));
vi.mock("@/lib/actions/friends", () => ({ sendFriendRequest: vi.fn() }));

const pin = (id: number, name: string) => ({ id, name, lat: 59.9, lng: 10.7, address: null, memberCount: 1 });
const member = (name: string): Member => ({ id: name, name, image: null, friendshipStatus: "none", isMe: false });

describe("GymMapClient", () => {
  it("shows the members of the gym tapped last, whichever answer arrives first", async () => {
    const { GymMapClient } = await import("@/components/features/GymMapClient");
    render(<GymMapClient pins={[pin(1, "Gym A"), pin(2, "Gym B")]} myGymId={null} />);
    await waitFor(() => expect(pins).toHaveLength(2));

    act(() => pins[0].click());
    act(() => pins[1].click());
    await act(async () => pending.get(2)!([member("Bea")]));
    await act(async () => pending.get(1)!([member("Arne")]));

    expect(screen.getByRole("heading", { name: "Gym B" })).toBeTruthy();
    expect(screen.getByText("Bea")).toBeTruthy();
    expect(screen.queryByText("Arne")).toBeNull();
  });
});
