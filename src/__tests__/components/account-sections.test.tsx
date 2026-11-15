// @vitest-environment jsdom
import { SECTIONS, type AccountData } from "@/components/features/account/sections";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/athlete-profile", () => ({
  addThresholdValue: vi.fn(),
  deleteThresholdValue: vi.fn(),
  restoreThresholdValue: vi.fn(),
  saveProfile: vi.fn(),
  addInjuryEntry: vi.fn(),
  updateInjuryEntry: vi.fn(),
  deleteInjuryEntry: vi.fn(),
  restoreInjuryEntry: vi.fn(),
}));
vi.mock("@/lib/actions/garmin", () => ({ setGarminSync: vi.fn(), takeGarminField: vi.fn() }));
vi.mock("@/lib/actions/friends", () => ({ updateActivityPrivacy: vi.fn() }));
vi.mock("@/lib/actions/legal", () => ({ setAiConsent: vi.fn() }));
vi.mock("@/lib/actions/profile", () => ({ updateUserProfile: vi.fn() }));
vi.mock("@/lib/actions/workouts-compliance", () => ({ manageIllness: vi.fn() }));
vi.mock("@/lib/auth-client", () => ({ authClient: {} }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

/** The training-number rows' note: source line and "Garmin says · Use" (docs/plans/account-profile.md, 10.8 and 11.2). */

const ftp = SECTIONS.find((s) => s.id === "training-numbers")!.rows.find((r) => r.id === "threshold-ftp")!;

const data = (over: Partial<AccountData>): AccountData =>
  ({
    premium: true,
    garminSync: false,
    thresholds: [],
    suggestions: [{ kind: "ftp", value: 262, basis: "your rides" }],
    units: { distance: "km", swim: "m" },
    today: "2026-11-15",
    ...over,
  }) as AccountData;

describe("the FTP row's note", () => {
  it("offers Garmin's estimate on an empty number while the sync is off", () => {
    render(<>{ftp.note!(data({}))}</>);
    expect(screen.getByText(/Garmin says 262 W/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use" })).toBeTruthy();
  });

  it("shows nothing for an empty number while the sync is on", () => {
    expect(ftp.note!(data({ garminSync: true }))).toBeNull();
  });

  it("offers it on a typed number while the sync is on", () => {
    const typed = { id: 1, kind: "ftp" as const, value: 240, measuredOn: "2026-11-01", source: "manual" as const };
    render(<>{ftp.note!(data({ garminSync: true, thresholds: [typed] }))}</>);
    expect(screen.getByText(/Set by you · /)).toBeTruthy();
    expect(screen.getByText(/Garmin says 262 W/)).toBeTruthy();
  });
});
