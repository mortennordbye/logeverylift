"use client";

import { toggleReaction } from "@/lib/actions/friends";
import type { ReactionSummary } from "@/types/workout";
import { useState } from "react";

const EMOJIS = ["🔥", "💪", "👏"] as const;

type Props = {
  sessionId: number;
  initialReactions: ReactionSummary[];
};

export function WorkoutReactions({ sessionId, initialReactions }: Props) {
  const [reactions, setReactions] = useState(initialReactions);

  async function handleToggle(emoji: typeof EMOJIS[number]) {
    // Optimistic update
    const prev = reactions;
    setReactions((r) =>
      r.map((item) =>
        item.emoji === emoji
          ? {
              ...item,
              count: item.reactedByMe ? item.count - 1 : item.count + 1,
              reactedByMe: !item.reactedByMe,
            }
          : item,
      ),
    );

    const result = await toggleReaction({ sessionId, emoji });
    if (!result.success) {
      // Roll back on error
      setReactions(prev);
    }
  }

  return (
    <div className="flex gap-1.5 pt-1">
      {EMOJIS.map((emoji) => {
        const item = reactions.find((r) => r.emoji === emoji) ?? { emoji, count: 0, reactedByMe: false };
        return (
          <button
            key={emoji}
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleToggle(emoji);
            }}
            className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors active:scale-95 ${
              item.reactedByMe
                ? "bg-primary/15 text-primary"
                : "bg-muted text-muted-foreground"
            }`}
          >
            <span>{emoji}</span>
            {item.count > 0 && <span>{item.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
