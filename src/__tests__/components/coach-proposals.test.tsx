// @vitest-environment jsdom
import { ProposalCard, type ProposalView } from "@/components/features/account/CoachProposals";
import { GROUPS, type AccountData } from "@/components/features/account/sections";
import { thresholdSourceLine } from "@/components/features/ThresholdEditor";
import { acceptThresholdProposal, declineThresholdProposal } from "@/lib/actions/athlete-profile";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("@/lib/actions/athlete-profile", () => ({
  acceptThresholdProposal: vi.fn(),
  declineThresholdProposal: vi.fn(),
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
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

/** The coach proposal card in Account › Training numbers (docs/plans/strict-targets.md, decisions 5 and 9). */

const units = { distance: "km", swim: "m" } as const;
const ftp: ProposalView = { id: 7, kind: "ftp", value: 188, reason: "Best 20 min power 198 W on the ride of 12 Nov (Garmin) x 0.95", proposedOn: "2026-11-22" };

beforeEach(() => {
  vi.mocked(acceptThresholdProposal).mockReset();
  vi.mocked(declineThresholdProposal).mockReset();
  refresh.mockReset();
});
afterEach(cleanup);

describe("ProposalCard", () => {
  it("shows the date, the current value struck through, the new value and the reason", () => {
    render(<ProposalCard proposal={ftp} current={180} units={units} />);
    expect(screen.getByText("Coach proposes · 22 Nov")).toBeTruthy();
    const old = screen.getByText("180 W");
    expect(old.tagName).toBe("S");
    expect(screen.getByText(/188 W FTP/)).toBeTruthy();
    expect(screen.getByText(ftp.reason)).toBeTruthy();
  });

  it("shows no old value when there is none", () => {
    render(<ProposalCard proposal={{ ...ftp, id: 8, kind: "bike_cadence", value: 88, reason: "Median cadence in Z2" }} current={null} units={units} />);
    expect(screen.getByText("88 rpm Bike cadence")).toBeTruthy();
    expect(document.querySelector("s")).toBeNull();
  });

  it("Accept sends the proposal id and reloads the page", async () => {
    vi.mocked(acceptThresholdProposal).mockResolvedValue({ success: true, data: { id: 1, value: 188 } });
    render(<ProposalCard proposal={ftp} current={180} units={units} />);
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(acceptThresholdProposal).toHaveBeenCalledWith({ id: 7 });
    expect(declineThresholdProposal).not.toHaveBeenCalled();
  });

  it("Decline sends the proposal id and reloads the page", async () => {
    vi.mocked(declineThresholdProposal).mockResolvedValue({ success: true, data: undefined });
    render(<ProposalCard proposal={ftp} current={180} units={units} />);
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(declineThresholdProposal).toHaveBeenCalledWith({ id: 7 });
  });

  it("shows the server's error and keeps the card", async () => {
    vi.mocked(acceptThresholdProposal).mockResolvedValue({ success: false, error: "This proposal is no longer open" });
    render(<ProposalCard proposal={ftp} current={180} units={units} />);
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "This proposal is no longer open");
    expect(refresh).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Accept" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("the dot and the source line", () => {
  const button = GROUPS.flatMap((g) => g.buttons).find((b) => b.id === "training-numbers")!;

  it("the Training numbers button has a dot only while a proposal is open", () => {
    expect(button.dot!({ proposals: [ftp] } as AccountData)).toBe("Coach proposal open");
    expect(button.dot!({ proposals: [] } as unknown as AccountData)).toBeNull();
  });

  it("an accepted value says it came from the coach", () => {
    const row = { id: 1, kind: "ftp" as const, value: 188, measuredOn: "2026-11-22", source: "coach" as const };
    expect(thresholdSourceLine(row, "2026-11-22", true)).toBe("From your coach · Sun 22 Nov");
  });
});
