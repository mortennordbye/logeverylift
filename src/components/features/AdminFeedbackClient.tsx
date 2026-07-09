"use client";

import { markFeedbackRead, type FeedbackWithUser } from "@/lib/actions/feedback";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

const TYPE_LABELS: Record<string, string> = {
  bug: "Bug",
  feature: "Feature",
  other: "Other",
};

const TYPE_COLORS: Record<string, string> = {
  bug: "bg-destructive/10 text-destructive",
  feature: "bg-primary/10 text-primary",
  other: "bg-muted text-muted-foreground",
};

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

export function AdminFeedbackClient({ initial }: { initial: FeedbackWithUser[] }) {
  const [items, setItems] = useState(initial);
  const [expanded, setExpanded] = useState<number | null>(null);

  const newCount = items.filter((i) => i.status === "new").length;

  async function handleMarkRead(id: number) {
    await markFeedbackRead(id);
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, status: "read" } : i)));
  }

  return (
    <div className="h-[100dvh] bg-background flex flex-col overflow-hidden">
      <div className="flex items-center px-4 pt-6 pb-2 shrink-0">
        <Link href="/more/admin" className="flex items-center gap-0.5 text-primary active:opacity-70 -ml-1 min-h-[44px]">
          <ChevronLeft className="w-5 h-5" />
          <span className="text-sm font-medium">Admin Tools</span>
        </Link>
      </div>
      <div className="px-4 pt-2 pb-4 shrink-0 flex items-baseline gap-3">
        <h1 className="text-3xl font-bold tracking-tight">Feedback</h1>
        {newCount > 0 && (
          <span className="text-sm font-semibold text-primary">{newCount} new</span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-nav-safe">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 pb-16 text-center">
            <p className="text-muted-foreground">No feedback yet.</p>
          </div>
        ) : (
          <div className="space-y-2 pt-2">
            {items.map((item) => (
              <div
                key={item.id}
                className={`bg-card rounded-2xl overflow-hidden ${item.status === "new" ? "ring-1 ring-primary/30" : ""}`}
              >
                <button
                  type="button"
                  onClick={() => setExpanded(expanded === item.id ? null : item.id)}
                  className="w-full px-4 py-3.5 text-left active:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${TYPE_COLORS[item.type]}`}>
                        {TYPE_LABELS[item.type]}
                      </span>
                      {item.status === "new" && (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                          New
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">{formatDate(item.createdAt)}</span>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{item.userName ?? "Unknown"} · {item.userEmail ?? ""}</p>
                  <p className={`mt-1.5 text-sm ${expanded === item.id ? "" : "line-clamp-2"}`}>
                    {item.message}
                  </p>
                </button>
                {expanded === item.id && item.status === "new" && (
                  <div className="px-4 pb-4">
                    <button
                      onClick={() => handleMarkRead(item.id)}
                      className="text-sm font-semibold text-primary active:opacity-70"
                    >
                      Mark as read
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
