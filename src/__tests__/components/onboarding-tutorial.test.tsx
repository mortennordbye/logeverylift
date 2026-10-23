// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingTutorial } from "@/components/features/OnboardingTutorial";

const updateUserProfile = vi.fn();
vi.mock("@/lib/actions/profile", () => ({
  updateUserProfile: (data: unknown) => updateUserProfile(data),
}));
vi.mock("@/lib/actions/onboarding", () => ({
  dismissTutorial: () => Promise.resolve({ success: true, data: undefined }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn() }),
}));

const empty = { heightCm: null, weightKg: null, birthYear: null };

async function toAboutYou() {
  while (!screen.queryByRole("heading", { name: "About you" })) {
    const next = screen.queryByRole("button", { name: "Next" }) ?? screen.getByRole("button", { name: "Maybe later" });
    await act(async () => next.click());
  }
}

beforeEach(() => {
  updateUserProfile.mockReset().mockResolvedValue({ success: true, data: undefined });
});

describe("OnboardingTutorial — About you", () => {
  it("saves the filled fields and moves on", async () => {
    render(<OnboardingTutorial defaultShow profile={empty} />);
    await toAboutYou();

    fireEvent.change(screen.getByLabelText("Height (cm)"), { target: { value: "180" } });
    fireEvent.change(screen.getByLabelText("Weight (kg)"), { target: { value: "82,5" } });
    await act(async () => screen.getByRole("button", { name: "Save and continue" }).click());

    expect(updateUserProfile).toHaveBeenCalledWith({ heightCm: 180, weightKg: 82.5 });
    expect(screen.getByRole("heading", { name: "You're All Set" })).toBeTruthy();
  });

  it("skips without saving", async () => {
    render(<OnboardingTutorial defaultShow profile={empty} />);
    await toAboutYou();

    fireEvent.change(screen.getByLabelText("Birth year"), { target: { value: "1990" } });
    await act(async () => screen.getByRole("button", { name: "Skip for now" }).click());

    expect(updateUserProfile).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "You're All Set" })).toBeTruthy();
  });

  it("keeps you on the slide with the error when saving fails", async () => {
    updateUserProfile.mockResolvedValue({ success: false, error: "Number must be less than or equal to 300" });
    render(<OnboardingTutorial defaultShow profile={empty} />);
    await toAboutYou();

    fireEvent.change(screen.getByLabelText("Height (cm)"), { target: { value: "400" } });
    await act(async () => screen.getByRole("button", { name: "Save and continue" }).click());

    expect(screen.getByRole("heading", { name: "About you" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("300");
  });

  it("prefills what the profile already has and saves only changes", async () => {
    render(<OnboardingTutorial defaultShow profile={{ heightCm: 175, weightKg: 70, birthYear: 1988 }} />);
    await toAboutYou();

    expect((screen.getByLabelText("Height (cm)") as HTMLInputElement).value).toBe("175");
    await act(async () => screen.getByRole("button", { name: "Save and continue" }).click());

    expect(updateUserProfile).not.toHaveBeenCalled();
  });
});
