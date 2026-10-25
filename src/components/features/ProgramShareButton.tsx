"use client";

import { getOutgoingShares, revokeShare, shareProgram } from "@/lib/actions/program-shares";
import { callAction } from "@/lib/utils/stale-bundle";
import type { FriendWithActivity, OutgoingShare } from "@/types/workout";
import { Check, Download, Loader2, Share2, Users } from "lucide-react";
import { useState } from "react";

interface Props {
  programId: number;
  friends: FriendWithActivity[];
  onExport: () => void;
  exporting: boolean;
}

export function ProgramShareButton({ programId, friends, onExport, exporting }: Props) {
  const [open, setOpen] = useState(false);
  const [busyFor, setBusyFor] = useState<string | null>(null);
  const [shares, setShares] = useState<OutgoingShare[]>([]);
  const [error, setError] = useState("");

  async function loadShares() {
    const result = await callAction(getOutgoingShares(programId));
    if (result.success) setShares(result.data);
  }

  function handleOpen() {
    setOpen(true);
    setError("");
    void loadShares();
  }

  async function handleShare(friendUserId: string) {
    setBusyFor(friendUserId);
    const result = await callAction(shareProgram({ programId, friendUserId }));
    setError(result.success ? "" : result.error);
    // Also on failure: "already shared" means the list was out of date.
    await loadShares();
    setBusyFor(null);
  }

  async function handleRevoke(friendUserId: string, shareId: number) {
    setBusyFor(friendUserId);
    const result = await callAction(revokeShare(shareId));
    setError(result.success ? "" : result.error);
    await loadShares();
    setBusyFor(null);
  }

  return (
    <>
      <button
        onClick={handleOpen}
        className="flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border text-sm font-medium active:opacity-70"
      >
        <Share2 className="w-4 h-4" />
        Share
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
          />

          {/* Sheet */}
          <div className="relative bg-background rounded-t-2xl pb-safe max-h-[70dvh] flex flex-col">
            <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-border shrink-0">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-muted-foreground" />
                <h2 className="font-semibold">Share with a friend</h2>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="text-sm text-muted-foreground active:opacity-70"
              >
                Done
              </button>
            </div>

            {error && (
              <p role="alert" className="mx-4 mt-3 rounded-xl bg-destructive/10 px-4 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="overflow-y-auto divide-y divide-border">
              {friends.length > 0 && friends.map((friend) => {
                // Only a share the friend hasn't copied yet can be taken back;
                // once copied, the program is theirs.
                const pending = shares.find((s) => s.sharedWithUserId === friend.userId && s.copiedProgramId === null);
                const loading = busyFor === friend.userId;
                const initials = friend.name
                  .split(" ")
                  .map((w) => w[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase();

                return (
                  <div key={friend.userId} className="flex items-center gap-3 px-4 py-3">
                    <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0">
                      {friend.image ? (
                        // eslint-disable-next-line @next/next/no-img-element -- avatar URL from auth provider; not worth wiring next/image loader
                        <img src={friend.image} alt={friend.name} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-xs font-semibold text-muted-foreground">{initials}</span>
                      )}
                    </div>
                    <p className="flex-1 font-medium truncate">{friend.name}</p>
                    {pending ? (
                      <>
                        <div className="flex items-center gap-1 text-sm text-green-600 dark:text-green-400 shrink-0">
                          <Check className="w-4 h-4" />
                          Sent
                        </div>
                        <button
                          onClick={() => handleRevoke(friend.userId, pending.shareId)}
                          disabled={loading}
                          aria-label={`Revoke share with ${friend.name}`}
                          className="h-11 px-2 text-sm text-destructive font-medium active:opacity-70 disabled:opacity-50 shrink-0"
                        >
                          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Revoke"}
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => handleShare(friend.userId)}
                        disabled={loading}
                        className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium active:opacity-80 disabled:opacity-50 shrink-0"
                      >
                        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Share2 className="w-3.5 h-3.5" />}
                        Share
                      </button>
                    )}
                  </div>
                );
              })}
              <div className="px-4 py-3 flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <Download className="w-4 h-4 text-muted-foreground" />
                </div>
                <p className="flex-1 font-medium">Export as JSON</p>
                <button
                  onClick={() => { onExport(); setOpen(false); }}
                  disabled={exporting}
                  className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium active:opacity-80 disabled:opacity-50 shrink-0"
                >
                  {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  Export
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
