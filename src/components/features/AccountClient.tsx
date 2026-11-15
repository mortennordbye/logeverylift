"use client";

import { authClient } from "@/lib/auth-client";
import { exportMyData } from "@/lib/actions/account";
import { setAiConsent } from "@/lib/actions/legal";
import { updateActivityPrivacy } from "@/lib/actions/friends";
import { SECTIONS, type AccountData, type Row } from "@/components/features/account/sections";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { clearLocalUserData, unsyncedChangeCount } from "@/lib/utils/local-data";
import { callAction } from "@/lib/utils/stale-bundle";
import { CheckCircle2, ChevronRight, Download, KeyRound, LogOut, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface AccountClientProps {
  data: AccountData;
  showActivityToFriends: boolean;
  aiConsent: boolean;
  primaryGymName: string | null;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1 mb-2">
      {children}
    </p>
  );
}

const text = (label: Row["label"], d: AccountData) => (typeof label === "string" ? label : label(d));

function Switch({ on }: { on: boolean }) {
  return (
    <div className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${on ? "bg-primary" : "bg-muted-foreground/30"}`}>
      <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${on ? "translate-x-5" : "translate-x-0.5"}`} />
    </div>
  );
}

/** One row: a link, a switch, a button that opens the sheet, or a plain value; its note sits under it, outside the control. */
function AccountRow({ row, data, on, onOpen, onToggle }: { row: Row; data: AccountData; on: boolean; onOpen: () => void; onToggle: () => void }) {
  const body = (
    <div className="flex-1 min-w-0 flex items-center justify-between gap-3">
      <span className={`text-sm shrink-0 ${row.toggle ? "font-medium" : "text-muted-foreground"}`}>{text(row.label, data)}</span>
      {row.value && <span className="min-w-0 text-sm font-medium text-right break-words">{row.value(data)}</span>}
    </div>
  );
  const rowClass = "flex items-center gap-3 w-full px-4 min-h-[52px] py-3 text-left";
  const testId = `account-${row.id}`;
  let main = (
    <div className={rowClass} data-testid={testId}>
      {body}
    </div>
  );
  if (row.href) {
    main = (
      <Link href={row.href} className={`${rowClass} active:opacity-60`} data-testid={testId}>
        {body}
        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
      </Link>
    );
  } else if (row.toggle) {
    main = (
      <button onClick={onToggle} role="switch" aria-checked={on} className={`${rowClass} active:opacity-60`} data-testid={testId}>
        {body}
        <Switch on={on} />
      </button>
    );
  } else if (row.editor) {
    main = (
      <button onClick={onOpen} className={`${rowClass} active:opacity-60`} data-testid={testId}>
        {body}
        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
      </button>
    );
  }
  const note = row.note?.(data);
  return (
    <div>
      {main}
      {note && (
        <div className="px-4 pb-3 -mt-2 text-xs text-muted-foreground" data-testid={`${testId}-note`}>
          {note}
        </div>
      )}
    </div>
  );
}

export function AccountClient({ data, showActivityToFriends: initialActivityPrivacy, aiConsent: initialAiConsent, primaryGymName }: AccountClientProps) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [flipping, setFlipping] = useState<string | null>(null);
  const [showPasswordSheet, setShowPasswordSheet] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordStatus, setPasswordStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const [activityPrivacy, setActivityPrivacy] = useState(initialActivityPrivacy);
  const [aiConsent, setAiConsentState] = useState(initialAiConsent);

  const [signOutWarning, setSignOutWarning] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [showDeleteSheet, setShowDeleteSheet] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleSignOut() {
    // Signing out clears this device, so unsynced sets would be lost: say so
    // once, and sign out on the second tap.
    const unsynced = unsyncedChangeCount();
    if (unsynced > 0 && signOutWarning === null) {
      setSignOutWarning(unsynced);
      return;
    }
    await authClient.signOut();
    await clearLocalUserData();
    window.location.href = "/login";
  }

  async function handleExport() {
    setExporting(true);
    setExportError(null);
    const result = await callAction(exportMyData());
    setExporting(false);
    if (!result.success) {
      setExportError(result.error);
      return;
    }
    const url = URL.createObjectURL(new Blob([result.data], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `logeverylift-data-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoking in the same tick cancels the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function closeDeleteSheet() {
    setShowDeleteSheet(false);
    setDeletePassword("");
    setDeleteConfirm("");
    setDeleteError(null);
  }

  async function handleDeleteAccount() {
    setDeleting(true);
    setDeleteError(null);
    const result = await authClient.deleteUser({ password: deletePassword });
    if (result.error) {
      setDeleting(false);
      setDeleteError(result.error.message ?? "Failed to delete account.");
      return;
    }
    await clearLocalUserData();
    window.location.href = "/welcome";
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

  async function handleAiConsentToggle() {
    const next = !aiConsent;
    setAiConsentState(next);
    const result = await callAction(setAiConsent({ consent: next }));
    if (!result.success) setAiConsentState(!next);
  }

  const visible = (r: Row) => !r.show || r.show(data);
  const openRow = SECTIONS.flatMap((s) => s.rows).find((r) => r.id === open && visible(r)) ?? null;
  const isOn = (r: Row) => r.toggle!.on(data) !== (flipping === r.id);

  function done() {
    setOpen(null);
    router.refresh();
  }

  // The action revalidates the page, so the new value is in `data` once it resolves.
  async function flip(r: Row) {
    setFlipping(r.id);
    await callAction(r.toggle!.set(!r.toggle!.on(data)));
    setFlipping(null);
  }

  async function handleActivityPrivacyToggle() {
    const next = !activityPrivacy;
    setActivityPrivacy(next);
    const result = await callAction(updateActivityPrivacy({ showActivityToFriends: next }));
    if (!result.success) setActivityPrivacy(!next);
  }

  return (
    <>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-2 flex flex-col gap-6">

        {SECTIONS.map((section) => {
          const rows = section.rows.filter(visible);
          if (rows.length === 0) return null;
          return (
            <div key={section.id} id={section.id} className="scroll-mt-20">
              <SectionLabel>{section.title}</SectionLabel>
              <div className="rounded-2xl bg-card overflow-hidden divide-y divide-border/50">
                {rows.map((r) => (
                  <AccountRow key={r.id} row={r} data={data} on={!!r.toggle && isOn(r)} onOpen={() => setOpen(r.id)} onToggle={() => flip(r)} />
                ))}
              </div>
            </div>
          );
        })}

        {/* Security and privacy */}
        <div>
          <SectionLabel>Security and privacy</SectionLabel>
          <div className="rounded-2xl bg-card overflow-hidden">
            <button
              onClick={() => setShowPasswordSheet(true)}
              className="flex items-center gap-3 w-full px-4 py-3.5 active:opacity-60"
            >
              <KeyRound className="w-5 h-5 text-muted-foreground" />
              <span className="text-sm font-medium">Change Password</span>
            </button>
            <button
              onClick={handleActivityPrivacyToggle}
              className="flex items-center gap-3 w-full px-4 py-3.5 active:opacity-60 border-t border-border/50"
            >
              <div className="flex-1 text-left">
                <p className="text-sm font-medium">Show workout activity to friends</p>
                <p className="text-xs text-muted-foreground mt-0.5">Friends can see your workouts, sets and streak</p>
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
            <Link
              href="/more/account/gym"
              className="flex items-center gap-3 w-full px-4 py-3.5 active:opacity-60 border-t border-border/50"
            >
              <div className="flex-1 text-left min-w-0">
                <p className="text-sm font-medium">Primary gym</p>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  {primaryGymName ? `${primaryGymName} · shown on the gym map` : "Not set · you're not on the gym map"}
                </p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
            </Link>
            {/* Turning AI editing on happens in AI Setup, next to what it sends. */}
            {initialAiConsent && (
              <button
                onClick={handleAiConsentToggle}
                disabled={!aiConsent}
                className="flex items-center gap-3 w-full px-4 py-3.5 active:opacity-60 border-t border-border/50"
              >
                <div className="flex-1 text-left">
                  <p className="text-sm font-medium">AI editing</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {aiConsent
                      ? "AI Setup can send your request to an outside model"
                      : "Off. AI Setup will ask before the next AI edit"}
                  </p>
                </div>
                <div
                  className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
                    aiConsent ? "bg-primary" : "bg-muted-foreground/30"
                  }`}
                >
                  <div
                    className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${
                      aiConsent ? "translate-x-5" : "translate-x-0.5"
                    }`}
                  />
                </div>
              </button>
            )}
          </div>
          <p className="text-xs text-muted-foreground px-1 mt-2">
            <a href="/privacy" className="text-primary">Privacy policy</a> ·{" "}
            <a href="/terms" className="text-primary">Terms of use</a>
          </p>
        </div>

        {/* Your data */}
        <div>
          <SectionLabel>Your data</SectionLabel>
          <div className="rounded-2xl bg-card overflow-hidden">
            <button
              onClick={handleExport}
              disabled={exporting}
              className="flex items-center gap-3 w-full px-4 py-3.5 active:opacity-60 disabled:opacity-50"
            >
              <Download className="w-5 h-5 text-muted-foreground" />
              <div className="flex-1 text-left">
                <p className="text-sm font-medium">{exporting ? "Preparing…" : "Download My Data"}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Everything stored about you, as a JSON file</p>
              </div>
            </button>
            <button
              onClick={() => setShowDeleteSheet(true)}
              className="flex items-center gap-3 w-full px-4 py-3.5 active:opacity-60 border-t border-border/50"
            >
              <Trash2 className="w-5 h-5 text-destructive" />
              <span className="text-sm font-medium text-destructive">Delete Account</span>
            </button>
          </div>
          {exportError && <p className="text-xs text-destructive text-center mt-2">{exportError}</p>}
        </div>

        {/* Sign out */}
        <div>
          <SectionLabel>Sign out</SectionLabel>
          <div className="rounded-2xl bg-card overflow-hidden">
            <button
              onClick={handleSignOut}
              className="flex items-center gap-3 w-full px-4 py-3.5 active:opacity-60"
            >
              <LogOut className="w-5 h-5 text-destructive" />
              <span className="text-sm font-medium text-destructive">
                {signOutWarning === null ? "Sign Out" : "Sign Out Anyway"}
              </span>
            </button>
          </div>
          {signOutWarning !== null && (
            <p className="text-xs text-destructive px-1 mt-2">
              {signOutWarning === 1 ? "1 change hasn't" : `${signOutWarning} changes haven't`} synced yet and will be
              lost. Go back online first to keep {signOutWarning === 1 ? "it" : "them"}.
            </p>
          )}
        </div>

        <div aria-hidden="true" className="pb-nav-safe-lg" style={{ height: "var(--kb-height, 0px)" }} />
      </div>

      <BottomSheet open={openRow !== null} onClose={() => setOpen(null)} blur>
        {openRow?.editor && (
          <div className="bg-background rounded-t-2xl px-4 pt-5 pb-8 space-y-4 max-h-[85dvh] overflow-y-auto">
            <h2 className="text-lg font-semibold">{text(openRow.label, data)}</h2>
            {openRow.editor(data, done)}
          </div>
        )}
      </BottomSheet>

      {/* Delete Account Sheet */}
      <BottomSheet open={showDeleteSheet} onClose={closeDeleteSheet} blur>
        <div className="bg-background rounded-t-2xl flex flex-col" style={{ maxHeight: "80dvh" }}>
          <div className="flex items-center justify-between px-4 pt-5 pb-4 shrink-0">
            <h2 className="text-lg font-semibold">Delete Account</h2>
            <button
              onClick={closeDeleteSheet}
              className="text-primary text-sm font-medium min-h-[44px] px-1"
            >
              Cancel
            </button>
          </div>

          <div className="overflow-y-auto flex flex-col gap-4 px-4 pb-10">
            <p className="text-sm text-muted-foreground">
              This permanently deletes your account and everything in it: workouts, sets, programs, cycles, body
              weight history and friends. It can&apos;t be undone. Download your data first if you want a copy.
            </p>
            <div className="flex flex-col gap-3">
              <input
                type="password"
                autoComplete="current-password"
                placeholder="Password"
                aria-label="Password"
                value={deletePassword}
                onChange={(e) => { setDeletePassword(e.target.value); setDeleteError(null); }}
                className="w-full rounded-xl bg-muted px-4 py-3.5 text-sm outline-none focus:ring-2 ring-primary"
              />
              <input
                type="text"
                autoComplete="off"
                placeholder='Type "DELETE" to confirm'
                aria-label='Type "DELETE" to confirm'
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                className="w-full rounded-xl bg-muted px-4 py-3.5 text-sm outline-none focus:ring-2 ring-primary"
              />
            </div>

            {deleteError && <p className="text-sm text-destructive">{deleteError}</p>}

            <button
              onClick={handleDeleteAccount}
              disabled={deleting || !deletePassword || deleteConfirm !== "DELETE"}
              className="w-full rounded-xl bg-destructive py-4 text-sm font-semibold text-white disabled:opacity-50 active:opacity-80"
            >
              {deleting ? "Deleting…" : "Delete My Account"}
            </button>
          </div>
        </div>
      </BottomSheet>

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
