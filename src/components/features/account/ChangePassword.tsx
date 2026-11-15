"use client";

import { authClient } from "@/lib/auth-client";
import { CheckCircle2 } from "lucide-react";
import { useState } from "react";

/** The change password form, for the Account sheet. `onDone` closes it after the success mark. */
export function ChangePassword({ onDone }: { onDone: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleChangePassword() {
    if (newPassword !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setStatus("saving");
    setError(null);
    const result = await authClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: false,
    });
    if (result.error) {
      setStatus("error");
      setError(result.error.message ?? "Failed to change password.");
    } else {
      setStatus("success");
      setTimeout(onDone, 1500);
    }
  }

  if (status === "success") {
    return (
      <div className="flex flex-col items-center gap-3 py-6">
        <CheckCircle2 className="w-12 h-12 text-green-500" />
        <p className="text-base font-semibold">Password updated</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <input
          type="password"
          autoComplete="current-password"
          placeholder="Current password"
          value={currentPassword}
          onChange={(e) => { setCurrentPassword(e.target.value); setError(null); }}
          className="w-full rounded-xl bg-muted px-4 py-3.5 text-sm outline-none focus:ring-2 ring-primary"
        />
        <input
          type="password"
          autoComplete="new-password"
          placeholder="New password"
          value={newPassword}
          onChange={(e) => { setNewPassword(e.target.value); setError(null); }}
          className="w-full rounded-xl bg-muted px-4 py-3.5 text-sm outline-none focus:ring-2 ring-primary"
        />
        <input
          type="password"
          autoComplete="new-password"
          placeholder="Confirm new password"
          value={confirmPassword}
          onChange={(e) => { setConfirmPassword(e.target.value); setError(null); }}
          className="w-full rounded-xl bg-muted px-4 py-3.5 text-sm outline-none focus:ring-2 ring-primary"
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <button
        onClick={handleChangePassword}
        disabled={status === "saving" || !currentPassword || !newPassword || !confirmPassword}
        className="w-full rounded-xl bg-primary py-4 text-sm font-semibold text-primary-foreground disabled:opacity-50 active:opacity-80"
      >
        {status === "saving" ? "Updating…" : "Update Password"}
      </button>
    </div>
  );
}
