// @vitest-environment jsdom
import { UserSettingsHydrator } from "@/components/features/UserSettingsHydrator";
import { setUserSettings, useUserSettings } from "@/contexts/user-settings-context";
import { clearLocalUserData } from "@/lib/utils/local-data";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * The user-settings store lives as long as the tab. The next account in the
 * same tab must not see the last one's zone or units.
 */

vi.mock("@/lib/actions/user-settings", () => ({ setTimeZone: vi.fn() }));

function Shown() {
  const s = useUserSettings();
  return <p>{`${s.timeZone ?? "none"} ${s.units.distance} ${s.units.swim}`}</p>;
}

const signedIn = { timeZone: "Europe/Oslo", units: { distance: "mi", swim: "yd" } } as const;

describe("the user-settings store", () => {
  it("fills from the signed-in user and resets when nobody is signed in", async () => {
    const { rerender } = render(
      <>
        <UserSettingsHydrator settings={signedIn} fillTimeZone={false} />
        <Shown />
      </>,
    );
    expect(screen.getByText("Europe/Oslo mi yd")).toBeTruthy();

    await act(async () => {
      rerender(
        <>
          <UserSettingsHydrator settings={null} fillTimeZone={false} />
          <Shown />
        </>,
      );
    });
    expect(screen.getByText("none km m")).toBeTruthy();
  });

  it("resets on sign-out", async () => {
    render(<Shown />);
    act(() => setUserSettings(signedIn));
    expect(screen.getByText("Europe/Oslo mi yd")).toBeTruthy();
    await act(async () => {
      await clearLocalUserData();
    });
    expect(screen.getByText("none km m")).toBeTruthy();
  });
});
