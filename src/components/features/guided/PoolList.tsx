"use client";

/**
 * Pool view, list mode (docs/plans/endurance-app.md, 4.4): one block per
 * screen in very large text. Tap anywhere for the next block; large targets
 * for wet hands. "Start send-off clock" opens the guided player, whose swim
 * layout counts down to each send-off.
 */

import Link from "next/link";
import { useState } from "react";

export type PoolBlock = { key: string; title: string; targets: string[]; extras: string[]; notes: string[] };

export function PoolList({
  plannedSessionId,
  name,
  poolLengthM,
  swimUnit,
  blocks,
}: {
  plannedSessionId: number;
  name: string;
  poolLengthM: number | null;
  swimUnit: "m" | "yd";
  blocks: PoolBlock[];
}) {
  const [i, setI] = useState(0);
  const b = blocks[i];
  const pool = poolLengthM === null ? "Open water" : swimUnit === "yd" && Math.abs(poolLengthM - 22.86) < 0.01 ? "25 yd pool" : `${poolLengthM} m pool`;
  return (
    <div className="flex-1 flex flex-col" data-testid="pool-view">
      <div className="flex items-center justify-between px-4 pt-6">
        <Link href={`/planned/${plannedSessionId}`} className="min-h-11 min-w-11 inline-flex items-center text-base text-primary active:opacity-70">
          Back
        </Link>
        <span className="text-base font-semibold">
          {name} · {pool}
        </span>
      </div>
      <button
        type="button"
        onClick={() => setI((n) => Math.min(blocks.length - 1, n + 1))}
        className="flex-1 flex flex-col items-center justify-center gap-6 px-6 text-center active:opacity-80"
        aria-label={i < blocks.length - 1 ? "Next block" : "Last block"}
      >
        <span className="text-lg font-semibold text-muted-foreground" data-testid="pool-block-count">
          Block {i + 1} of {blocks.length}
        </span>
        <span className="text-5xl font-bold leading-tight" data-testid="pool-block">
          {b?.title}
        </span>
        {b?.targets.map((t) => (
          <span key={t} className="text-4xl font-bold tabular-nums text-primary" data-testid="pool-target">
            {t}
          </span>
        ))}
        {b && b.extras.length > 0 && <span className="text-2xl">{b.extras.join(", ")}</span>}
        {b?.notes.map((n) => (
          <span key={n} className="text-2xl">
            {n}
          </span>
        ))}
      </button>
      <div className="grid grid-cols-2 gap-3 px-4 pb-8">
        <button
          type="button"
          onClick={() => setI((n) => Math.max(0, n - 1))}
          disabled={i === 0}
          className="min-h-[88px] rounded-2xl bg-muted text-xl font-semibold disabled:opacity-40 active:scale-95 transition-all"
        >
          Previous
        </button>
        <Link
          href={`/planned/${plannedSessionId}/play`}
          className="min-h-[88px] rounded-2xl bg-primary text-xl font-semibold text-primary-foreground flex items-center justify-center text-center active:scale-95 transition-all"
        >
          Start send-off clock
        </Link>
      </div>
    </div>
  );
}
