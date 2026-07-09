"use client";

import { copySharedProgram } from "@/lib/actions/program-shares";
import type { IncomingShare } from "@/types/workout";
import { CheckCircle2, Copy, Gift } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface Props {
  shares: IncomingShare[];
}

function Avatar({ name, image }: { name: string; image: string | null }) {
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0">
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element -- avatar URL from auth provider; not worth wiring next/image loader
        <img src={image} alt={name} className="w-full h-full object-cover" />
      ) : (
        <span className="text-xs font-semibold text-muted-foreground">{initials}</span>
      )}
    </div>
  );
}

export function SharedProgramsClient({ shares }: Props) {
  const router = useRouter();
  const [copyingId, setCopyingId] = useState<number | null>(null);
  const [copiedIds, setCopiedIds] = useState<Set<number>>(
    new Set(shares.filter((s) => s.alreadyCopied).map((s) => s.shareId)),
  );

  async function handleCopy(shareId: number) {
    setCopyingId(shareId);
    const result = await copySharedProgram({ shareId });
    if (result.success) {
      setCopiedIds((prev) => new Set([...prev, shareId]));
      router.refresh();
    }
    setCopyingId(null);
  }

  if (shares.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 py-16 text-center px-8">
        <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center">
          <Gift className="w-7 h-7 text-muted-foreground" />
        </div>
        <p className="font-medium">No shared programs</p>
        <p className="text-sm text-muted-foreground">
          When a friend shares a program with you, it will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="divide-y divide-border border-y border-border">
        {shares.map((share) => {
          const alreadyCopied = copiedIds.has(share.shareId);
          return (
            <div key={share.shareId} className="px-4 py-4 flex items-start gap-3">
              <Avatar name={share.sharedByName} image={share.sharedByImage} />
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{share.programName}</p>
                <p className="text-sm text-muted-foreground">
                  Shared by {share.sharedByName}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {new Date(share.sharedAt).toLocaleDateString()}
                </p>
              </div>
              {alreadyCopied ? (
                <div className="flex items-center gap-1 text-sm text-green-600 dark:text-green-400 shrink-0">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Copied</span>
                </div>
              ) : (
                <button
                  onClick={() => handleCopy(share.shareId)}
                  disabled={copyingId === share.shareId}
                  className="flex items-center gap-1.5 h-9 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium active:opacity-80 disabled:opacity-50 shrink-0"
                >
                  <Copy className="w-3.5 h-3.5" />
                  {copyingId === share.shareId ? "Copying…" : "Copy"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
