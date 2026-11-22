"use client";

import { authClient } from "@/lib/auth-client";
import { exportMyData } from "@/lib/actions/account";
import { GROUPS, SECTIONS, type AccountData, type Row } from "@/components/features/account/sections";
import { OpenDot, ProposalCard } from "@/components/features/account/CoachProposals";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { currentThresholds } from "@/lib/utils/thresholds";
import { forgetStepAlerts } from "@/lib/push-client";
import { clearLocalUserData, unsyncedChangeCount } from "@/lib/utils/local-data";
import { callAction } from "@/lib/utils/stale-bundle";
import { ChevronRight, Download, LogOut, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface AccountClientProps {
  data: AccountData;
  /** A sub-page id (SUB_PAGES), or null for the top page. */
  page: string | null;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1 mb-2">
      {children}
    </p>
  );
}

const text = (label: Row["label"], d: AccountData) => (typeof label === "string" ? label : label(d));

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");

function Switch({ on }: { on: boolean }) {
  return (
    <div className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${on ? "bg-primary" : "bg-muted-foreground/30"}`}>
      <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${on ? "translate-x-5" : "translate-x-0.5"}`} />
    </div>
  );
}

/** One row: a link, a switch, a button that opens the sheet, or a plain value; its note sits under it, outside the control. */
function AccountRow({
  row,
  data,
  on,
  error,
  onOpen,
  onToggle,
}: {
  row: Row;
  data: AccountData;
  on: boolean;
  error: string | null;
  onOpen: () => void;
  onToggle: () => void;
}) {
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
      {error && (
        <p role="alert" className="px-4 pb-3 -mt-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function AccountClient({ data, page }: AccountClientProps) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [flipping, setFlipping] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<{ id: string; message: string } | null>(null);

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
    // A shared phone must not get this user's step alerts.
    await forgetStepAlerts();
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
    setToggleError(null);
    const result = await callAction(r.toggle!.set(!r.toggle!.on(data)));
    setFlipping(null);
    if (!result.success) setToggleError({ id: r.id, message: result.error });
    router.refresh();
  }

  return (
    <>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-2 flex flex-col gap-6">

        {page === null && (
          <Link href="/more/account/profile" className="flex items-center gap-3 rounded-2xl bg-card px-4 py-3.5 active:opacity-60" data-testid="account-me">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
              {initials(data.name)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold truncate">{data.name}</p>
              <p className="text-xs text-muted-foreground truncate">{data.email}</p>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
          </Link>
        )}

        {page === "training-numbers" && data.proposals.length > 0 && (
          <div className="shrink-0 flex flex-col gap-3">
            {data.proposals.map((p) => (
              <ProposalCard key={p.id} proposal={p} current={currentThresholds(data.thresholds)[p.kind]?.value ?? null} units={data.units} />
            ))}
          </div>
        )}

        {/* The top page shows only the Garmin switch; a sub-page shows its own section. */}
        {SECTIONS.filter((section) => section.id === (page ?? "garmin")).map((section) => {
          const rows = section.rows.filter(visible);
          if (rows.length === 0) return null;
          return (
            <div key={section.id} className="shrink-0 rounded-2xl bg-card overflow-hidden divide-y divide-border/50">
              {rows.map((r) => (
                <AccountRow
                  key={r.id}
                  row={r}
                  data={data}
                  on={!!r.toggle && isOn(r)}
                  error={toggleError?.id === r.id ? toggleError.message : null}
                  onOpen={() => setOpen(r.id)}
                  onToggle={() => flip(r)}
                />
              ))}
            </div>
          );
        })}

        {page === null &&
          GROUPS.map((group) => (
            <div key={group.title}>
              <SectionLabel>{group.title}</SectionLabel>
              <div className="rounded-2xl bg-card overflow-hidden divide-y divide-border/50">
                {group.buttons.map((b) => {
                  const dot = b.dot?.(data);
                  return (
                    <Link key={b.id} href={`/more/account/${b.id}`} className="flex items-center gap-3 px-4 min-h-[52px] py-3 active:opacity-60" data-testid={`account-group-${b.id}`}>
                      <b.icon className="w-5 h-5 text-muted-foreground shrink-0" />
                      <span className="flex-1 text-sm font-medium">{b.title}</span>
                      {dot && <OpenDot label={dot} />}
                      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}

        {page === "privacy-and-security" && (
          <p className="text-xs text-muted-foreground px-1 -mt-4">
            <a href="/privacy" className="text-primary">Privacy policy</a> ·{" "}
            <a href="/terms" className="text-primary">Terms of use</a>
          </p>
        )}

        {page === "your-data" && (
          <div>
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
        )}

        {page === null && (
          <div>
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
        )}

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

    </>
  );
}
