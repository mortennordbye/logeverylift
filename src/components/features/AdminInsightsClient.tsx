"use client";

import type { AdminInsightsData } from "@/lib/actions/admin-insights";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

const SORT_OPTIONS = [
  { key: "lastActive", label: "Last active" },
  { key: "sessions", label: "Sessions" },
  { key: "joined", label: "Joined" },
] as const;

type SortKey = (typeof SORT_OPTIONS)[number]["key"];

export function AdminInsightsClient({ data }: { data: AdminInsightsData }) {
  const { summary, funnel, users } = data;
  const [sort, setSort] = useState<SortKey>("lastActive");

  const sortedUsers = useMemo(() => {
    return [...users].sort((a, b) => {
      if (sort === "lastActive") {
        if (!a.lastActiveDate && !b.lastActiveDate) return 0;
        if (!a.lastActiveDate) return 1;
        if (!b.lastActiveDate) return -1;
        return b.lastActiveDate.localeCompare(a.lastActiveDate);
      }
      if (sort === "sessions") {
        return b.completedSessionCount - a.completedSessionCount;
      }
      // joined
      return new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime();
    });
  }, [users, sort]);

  const funnelSteps = [
    { label: "Created a program", value: funnel.usersWithProgram },
    { label: "Set up a cycle", value: funnel.usersWithCycle },
    { label: "Completed a workout", value: funnel.usersWithCompletedSession },
    { label: "Created a custom exercise", value: funnel.usersWithCustomExercise },
  ];

  return (
    <div className="h-[100dvh] bg-background flex flex-col overflow-hidden">
      <div className="flex items-center px-4 pt-6 pb-2 shrink-0">
        <Link
          href="/more/admin"
          className="flex items-center gap-0.5 text-primary active:opacity-70 -ml-1"
        >
          <ChevronLeft className="w-5 h-5" />
          <span className="text-sm font-medium">Admin</span>
        </Link>
      </div>
      <div className="px-4 pt-2 pb-4 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight">Insights</h1>
      </div>

      <main className="flex-1 overflow-y-auto px-4 pt-6 pb-nav-safe space-y-6">
        {/* Overview */}
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">
            Overview
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground mb-1">Total Users</p>
              <p className="text-2xl font-bold tabular-nums">
                {summary.totalUsers.toLocaleString()}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground mb-1">Active (7d)</p>
              <p className="text-2xl font-bold tabular-nums">
                {summary.activeLastSevenDays.toLocaleString()}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground mb-1">Active (30d)</p>
              <p className="text-2xl font-bold tabular-nums">
                {summary.activeLastThirtyDays.toLocaleString()}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground mb-1">Sessions</p>
              <p className="text-2xl font-bold tabular-nums">
                {summary.totalCompletedSessions.toLocaleString()}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground mb-1">Programs</p>
              <p className="text-2xl font-bold tabular-nums">
                {summary.totalPrograms.toLocaleString()}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground mb-1">Cycles</p>
              <p className="text-2xl font-bold tabular-nums">
                {summary.totalCycles.toLocaleString()}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground mb-1">Custom Exercises</p>
              <p className="text-2xl font-bold tabular-nums">
                {summary.totalCustomExercises.toLocaleString()}
              </p>
            </div>
          </div>
        </section>

        {/* Engagement funnel */}
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">
            Engagement
          </h2>
          <div className="rounded-xl border border-border p-4 space-y-4">
            {funnelSteps.map((step) => {
              const pct =
                summary.totalUsers > 0
                  ? Math.round((step.value / summary.totalUsers) * 100)
                  : 0;
              return (
                <div key={step.label} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">{step.label}</span>
                    <span className="text-sm font-semibold tabular-nums">
                      {step.value}{" "}
                      <span className="font-normal text-muted-foreground">
                        ({pct}%)
                      </span>
                    </span>
                  </div>
                  <div className="h-1.5 bg-border rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Per-user breakdown */}
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">
            Users
          </h2>

          <div className="flex gap-2">
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                onClick={() => setSort(opt.key)}
                className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                  sort === opt.key
                    ? "bg-muted text-foreground font-medium"
                    : "text-muted-foreground"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="rounded-xl border border-border divide-y divide-border overflow-hidden">
            {sortedUsers.map((user) => {
              const lastActive = user.lastActiveDate
                ? new Date(user.lastActiveDate + "T00:00:00").toLocaleDateString(
                    "en-US",
                    { day: "numeric", month: "short" },
                  )
                : "Never";
              const joined = new Date(user.joinedAt).toLocaleDateString("en-US", {
                month: "short",
                year: "numeric",
              });

              return (
                <div key={user.id} className="px-4 py-3 flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium truncate">{user.name}</span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {lastActive}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground truncate">{user.email}</p>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span>
                      {user.programCount} program{user.programCount !== 1 ? "s" : ""}
                    </span>
                    <span>
                      {user.cycleCount} cycle{user.cycleCount !== 1 ? "s" : ""}
                      {user.activeCycleCount > 0 && ` · ${user.activeCycleCount} active`}
                    </span>
                    <span>
                      {user.completedSessionCount} session{user.completedSessionCount !== 1 ? "s" : ""}
                    </span>
                    {user.customExerciseCount > 0 && (
                      <span>{user.customExerciseCount} custom</span>
                    )}
                    <span className="text-muted-foreground/60">joined {joined}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
