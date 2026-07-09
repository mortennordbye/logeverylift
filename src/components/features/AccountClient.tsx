"use client";

import { authClient } from "@/lib/auth-client";
import { updateActivityPrivacy } from "@/lib/actions/friends";
import { updateUserProfile } from "@/lib/actions/profile";
import type { Goal } from "@/lib/utils/goals";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { CheckCircle2, KeyRound, LogOut } from "lucide-react";
import { useState } from "react";

type Gender = "male" | "female" | "other" | "prefer_not_to_say";
type ExperienceLevel = "beginner" | "intermediate" | "advanced";

interface UserProfile {
  gender: Gender | null;
  birthYear: number | null;
  heightCm: number | null;
  weightKg: number | null;
  goals: Goal[];
  experienceLevel: ExperienceLevel | null;
}

interface AccountClientProps {
  name: string;
  email: string;
  role: string;
  profile: UserProfile;
  showActivityToFriends: boolean;
}

interface ProfileState extends UserProfile {
  name: string;
}

const GOAL_LABELS: Record<Goal, string> = {
  strength: "Strength",
  muscle_gain: "Muscle Gain",
  weight_loss: "Weight Loss",
  endurance: "Endurance",
  general_fitness: "General Fitness",
};

const EXPERIENCE_LABELS: Record<ExperienceLevel, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

const GENDER_LABELS: Record<Gender, string> = {
  male: "Male",
  female: "Female",
  other: "Other",
  prefer_not_to_say: "Prefer not to say",
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1 mb-2">
      {children}
    </p>
  );
}

function PickerRow<T extends string>({
  label,
  value,
  options,
  labelMap,
  onChange,
}: {
  label: string;
  value: T | null;
  options: T[];
  labelMap: Record<T, string>;
  onChange: (v: T | null) => void;
}) {
  return (
    <div className="px-4 py-3.5">
      <p className="text-xs text-muted-foreground mb-2">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <button
            key={opt}
            onClick={() => onChange(value === opt ? null : opt)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors active:opacity-70 ${
              value === opt
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-transparent text-foreground border-border"
            }`}
          >
            {labelMap[opt]}
          </button>
        ))}
      </div>
    </div>
  );
}

function GoalPickerRow({
  values,
  onChange,
}: {
  values: Goal[];
  onChange: (v: Goal[]) => void;
}) {
  const options: Goal[] = ["strength", "muscle_gain", "weight_loss", "endurance", "general_fitness"];

  function toggle(opt: Goal) {
    if (values.includes(opt)) {
      onChange(values.filter((v) => v !== opt));
    } else {
      onChange([...values, opt]);
    }
  }

  return (
    <div className="px-4 py-3.5">
      <p className="text-xs text-muted-foreground mb-2">Goals</p>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const selected = values.includes(opt);
          return (
            <button
              key={opt}
              onClick={() => toggle(opt)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors active:opacity-70 ${
                selected
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-transparent text-foreground border-border"
              }`}
            >
              {GOAL_LABELS[opt]}
            </button>
          );
        })}
      </div>
      {values.length === 0 && (
        <p className="text-xs text-muted-foreground mt-2">Select all that apply</p>
      )}
    </div>
  );
}

function NumberRow({
  label,
  value,
  unit,
  placeholder,
  onChange,
}: {
  label: string;
  value: number | null;
  unit: string;
  placeholder: string;
  onChange: (v: number | null) => void;
}) {
  return (
    <div className="px-4 py-3.5 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          inputMode="numeric"
          placeholder={placeholder}
          value={value ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v === "" ? null : Number(v));
          }}
          className="w-20 rounded-lg bg-muted px-3 py-2 text-sm text-right outline-none focus:ring-2 ring-primary"
        />
        <span className="text-sm text-muted-foreground w-6">{unit}</span>
      </div>
    </div>
  );
}

export function AccountClient({ name, email, role, profile: initialProfile, showActivityToFriends: initialActivityPrivacy }: AccountClientProps) {
  const [showPasswordSheet, setShowPasswordSheet] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordStatus, setPasswordStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const [profile, setProfile] = useState<ProfileState>({ ...initialProfile, name });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [activityPrivacy, setActivityPrivacy] = useState(initialActivityPrivacy);

  async function handleSignOut() {
    await authClient.signOut();
    window.location.href = "/login";
  }

  function closePasswordSheet() {
    setShowPasswordSheet(false);
    setPasswordStatus("idle");
    setPasswordError(null);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  }

  async function handleChangePassword() {
    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords don't match.");
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError("Password must be at least 8 characters.");
      return;
    }
    setPasswordStatus("saving");
    setPasswordError(null);
    const result = await authClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: false,
    });
    if (result.error) {
      setPasswordStatus("error");
      setPasswordError(result.error.message ?? "Failed to change password.");
    } else {
      setPasswordStatus("success");
      setTimeout(() => closePasswordSheet(), 1500);
    }
  }

  async function handleSaveProfile() {
    setProfileSaving(true);
    setProfileError(null);
    const { name: profileName, goals, ...bodyFields } = profile;
    const result = await updateUserProfile({
      ...bodyFields,
      name: profileName.trim() || undefined,
      goals: goals.length > 0 ? goals : null,
    });
    setProfileSaving(false);
    if (result.success) {
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 2000);
    } else {
      setProfileError(result.error ?? "Failed to save profile");
    }
  }

  async function handleActivityPrivacyToggle() {
    const next = !activityPrivacy;
    setActivityPrivacy(next);
    await updateActivityPrivacy({ showActivityToFriends: next });
  }

  return (
    <>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-2 flex flex-col gap-6">

        {/* Profile */}
        <div>
          <SectionLabel>Profile</SectionLabel>
          <div className="rounded-2xl bg-card overflow-hidden divide-y divide-border/50">
            <div className="px-4 py-3.5 flex items-center gap-3">
              <div className="shrink-0">
                <p className="text-xs text-muted-foreground mb-0.5">Name</p>
              </div>
              <input
                type="text"
                value={profile.name}
                onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))}
                className="flex-1 min-w-0 rounded-lg bg-muted px-3 py-2 text-sm text-right outline-none focus:ring-2 ring-primary"
              />
            </div>
            <div className="px-4 py-3.5">
              <p className="text-xs text-muted-foreground mb-0.5">Email</p>
              <p className="text-sm font-medium">{email}</p>
            </div>
            <div className="px-4 py-3.5">
              <p className="text-xs text-muted-foreground mb-0.5">Role</p>
              <p className="text-sm font-medium capitalize">{role}</p>
            </div>
          </div>
        </div>

        {/* Body & Goals */}
        <div>
          <SectionLabel>Body &amp; Goals</SectionLabel>
          <div className="rounded-2xl bg-card overflow-hidden divide-y divide-border/50">
            <GoalPickerRow
              values={profile.goals}
              onChange={(v) => setProfile((p) => ({ ...p, goals: v }))}
            />
            <PickerRow
              label="Experience level"
              value={profile.experienceLevel}
              options={["beginner", "intermediate", "advanced"]}
              labelMap={EXPERIENCE_LABELS}
              onChange={(v) => setProfile((p) => ({ ...p, experienceLevel: v }))}
            />
            <PickerRow
              label="Gender"
              value={profile.gender}
              options={["male", "female", "other", "prefer_not_to_say"]}
              labelMap={GENDER_LABELS}
              onChange={(v) => setProfile((p) => ({ ...p, gender: v }))}
            />
            <NumberRow
              label="Year of birth"
              value={profile.birthYear}
              unit=""
              placeholder="1990"
              onChange={(v) => setProfile((p) => ({ ...p, birthYear: v != null ? Math.round(v) : null }))}
            />
            <NumberRow
              label="Height"
              value={profile.heightCm}
              unit="cm"
              placeholder="180"
              onChange={(v) => setProfile((p) => ({ ...p, heightCm: v != null ? Math.round(v) : null }))}
            />
            <NumberRow
              label="Body weight"
              value={profile.weightKg}
              unit="kg"
              placeholder="80"
              onChange={(v) => setProfile((p) => ({ ...p, weightKg: v }))}
            />
            <div className="px-4 py-3 flex flex-col gap-2">
              <button
                onClick={handleSaveProfile}
                disabled={profileSaving || profileSaved}
                className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50 active:opacity-80"
              >
                {profileSaved ? "Saved" : profileSaving ? "Saving…" : "Save"}
              </button>
              {profileError && (
                <p className="text-xs text-destructive text-center">{profileError}</p>
              )}
            </div>
          </div>
        </div>

        {/* Security */}
        <div>
          <SectionLabel>Security</SectionLabel>
          <div className="rounded-2xl bg-card overflow-hidden">
            <button
              onClick={() => setShowPasswordSheet(true)}
              className="flex items-center gap-3 w-full px-4 py-3.5 active:opacity-60"
            >
              <KeyRound className="w-5 h-5 text-muted-foreground" />
              <span className="text-sm font-medium">Change Password</span>
            </button>
          </div>
        </div>

        {/* Privacy */}
        <div>
          <SectionLabel>Privacy</SectionLabel>
          <div className="rounded-2xl bg-card overflow-hidden">
            <button
              onClick={handleActivityPrivacyToggle}
              className="flex items-center gap-3 w-full px-4 py-3.5 active:opacity-60"
            >
              <div className="flex-1 text-left">
                <p className="text-sm font-medium">Show workout activity to friends</p>
                <p className="text-xs text-muted-foreground mt-0.5">Friends can see when you worked out today</p>
              </div>
              <div
                className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
                  activityPrivacy ? "bg-primary" : "bg-muted-foreground/30"
                }`}
              >
                <div
                  className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${
                    activityPrivacy ? "translate-x-5" : "translate-x-0.5"
                  }`}
                />
              </div>
            </button>
          </div>
        </div>

        {/* Sign out */}
        <div>
          <SectionLabel>Session</SectionLabel>
          <div className="rounded-2xl bg-card overflow-hidden">
            <button
              onClick={handleSignOut}
              className="flex items-center gap-3 w-full px-4 py-3.5 active:opacity-60"
            >
              <LogOut className="w-5 h-5 text-destructive" />
              <span className="text-sm font-medium text-destructive">Sign Out</span>
            </button>
          </div>
        </div>

        <div aria-hidden="true" className="pb-nav-safe-lg" style={{ height: "var(--kb-height, 0px)" }} />
      </div>

      {/* Change Password Sheet */}
      <BottomSheet open={showPasswordSheet} onClose={closePasswordSheet} blur>
        <div className="bg-background rounded-t-2xl flex flex-col" style={{ maxHeight: "80dvh" }}>
          <div className="flex items-center justify-between px-4 pt-5 pb-4 shrink-0">
            <h2 className="text-lg font-semibold">Change Password</h2>
            <button
              onClick={closePasswordSheet}
              className="text-primary text-sm font-medium min-h-[44px] px-1"
            >
              Cancel
            </button>
          </div>

          <div className="overflow-y-auto flex flex-col gap-4 px-4 pb-10">
            {passwordStatus === "success" ? (
              <div className="flex flex-col items-center gap-3 py-6">
                <CheckCircle2 className="w-12 h-12 text-green-500" />
                <p className="text-base font-semibold">Password updated</p>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-3">
                  <input
                    type="password"
                    autoComplete="current-password"
                    placeholder="Current password"
                    value={currentPassword}
                    onChange={(e) => { setCurrentPassword(e.target.value); setPasswordError(null); }}
                    className="w-full rounded-xl bg-muted px-4 py-3.5 text-sm outline-none focus:ring-2 ring-primary"
                  />
                  <input
                    type="password"
                    autoComplete="new-password"
                    placeholder="New password"
                    value={newPassword}
                    onChange={(e) => { setNewPassword(e.target.value); setPasswordError(null); }}
                    className="w-full rounded-xl bg-muted px-4 py-3.5 text-sm outline-none focus:ring-2 ring-primary"
                  />
                  <input
                    type="password"
                    autoComplete="new-password"
                    placeholder="Confirm new password"
                    value={confirmPassword}
                    onChange={(e) => { setConfirmPassword(e.target.value); setPasswordError(null); }}
                    className="w-full rounded-xl bg-muted px-4 py-3.5 text-sm outline-none focus:ring-2 ring-primary"
                  />
                </div>

                {passwordError && (
                  <p className="text-sm text-destructive">{passwordError}</p>
                )}

                <button
                  onClick={handleChangePassword}
                  disabled={passwordStatus === "saving" || !currentPassword || !newPassword || !confirmPassword}
                  className="w-full rounded-xl bg-primary py-4 text-sm font-semibold text-primary-foreground disabled:opacity-50 active:opacity-80"
                >
                  {passwordStatus === "saving" ? "Updating…" : "Update Password"}
                </button>
              </>
            )}
          </div>
        </div>
      </BottomSheet>
    </>
  );
}
