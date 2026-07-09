"use client";

import { shareProgram } from "@/lib/actions/program-shares";
import type { FriendWithActivity } from "@/types/workout";
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
  const [sharingTo, setSharingTo] = useState<string | null>(null);
  const [sharedTo, setSharedTo] = useState<Set<string>>(new Set());

  async function handleShare(friendUserId: string) {
    setSharingTo(friendUserId);
    const result = await shareProgram({ programId, friendUserId });
    if (result.success) {
      setSharedTo((prev) => new Set([...prev, friendUserId]));
    }
    setSharingTo(null);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
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

            <div className="overflow-y-auto divide-y divide-border">
              {friends.length > 0 && friends.map((friend) => {
                const alreadyShared = sharedTo.has(friend.userId);
                const loading = sharingTo === friend.userId;
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
                    {alreadyShared ? (
                      <div className="flex items-center gap-1 text-sm text-green-600 dark:text-green-400 shrink-0">
                        <Check className="w-4 h-4" />
                        Sent
                      </div>
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
