"use client";

import { authClient } from "@/lib/auth-client";
import { DEMO_USER_EMAIL } from "@/lib/constants/demo";
import { BarChart2, CalendarDays, ChevronRight, Clock, Library, LogOut, MessageSquare, Settings, Shield, Sparkles, Trophy, UserCircle, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

const baseItems = [
  {
    label: "AI Setup",
    href: "/more/ai-setup",
    icon: Sparkles,
    description: "Generate your programs and training schedule with AI",
  },
  {
    label: "Friends",
    href: "/more/friends",
    icon: Users,
    description: "Connect and share programs with friends",
  },
  {
    label: "Account",
    href: "/more/account",
    icon: UserCircle,
    description: "Profile and sign out",
  },
  {
    label: "Calendar",
    href: "/more/calendar",
    icon: CalendarDays,
    description: "Visualise your training cycles",
  },
  {
    label: "Exercises",
    href: "/exercises",
    icon: Library,
    description: "Browse and manage exercises",
  },
  {
    label: "History",
    href: "/history",
    icon: Clock,
    description: "All your workouts",
  },
  {
    label: "Metrics",
    href: "/more/metrics",
    icon: BarChart2,
    description: "Volume, records, and muscle balance",
  },
  {
    label: "Personal records",
    href: "/more/prs",
    icon: Trophy,
    description: "Every PR you've broken, newest first",
  },
  {
    label: "Settings",
    href: "/settings",
    icon: Settings,
    description: "Appearance and preferences",
  },
  {
    label: "Feedback",
    href: "/more/feedback",
    icon: MessageSquare,
    description: "Report issues or suggest features",
  },
];

const adminItem = {
  label: "Admin Tools",
  href: "/more/admin",
  icon: Shield,
  description: "Users, insights, and test data",
};

export function MoreClient({ role }: { role: string }) {
  const isAdmin = role === "admin";
  const { data: session } = authClient.useSession();
  const [stopping, setStopping] = useState(false);
  const isImpersonating = !!session?.session.impersonatedBy;
  const isDemoMode = isImpersonating && session?.user.email === DEMO_USER_EMAIL;

  async function handleStopImpersonating() {
    setStopping(true);
    if (isDemoMode) {
      // Restore admin's active workout state that was backed up on enter
      const workoutBackup = localStorage.getItem("adminWorkoutBackup");
      const timersBackup = localStorage.getItem("adminRestTimersBackup");
      localStorage.removeItem("adminWorkoutBackup");
      localStorage.removeItem("adminRestTimersBackup");
      if (workoutBackup !== null) {
        localStorage.setItem("activeWorkout", workoutBackup);
      } else {
        localStorage.removeItem("activeWorkout");
      }
      if (timersBackup !== null) {
        localStorage.setItem("restTimerEnds", timersBackup);
      } else {
        localStorage.removeItem("restTimerEnds");
      }
    }
    await authClient.admin.stopImpersonating();
    window.location.href = "/more/admin";
  }

  return (
    <div className="h-[100dvh] bg-background flex flex-col overflow-hidden">
      <header className="flex-none px-4 pt-6 pb-4 border-b border-border">
        <h1 className="text-3xl font-bold tracking-tight">More</h1>
      </header>

      <main className="flex-1 overflow-y-auto pb-nav-safe">
        {isImpersonating && (
          <div className="px-4 pt-4 pb-2">
            <button
              onClick={handleStopImpersonating}
              disabled={stopping}
              className="flex items-center gap-3 w-full rounded-2xl bg-orange-500/10 border border-orange-500/30 px-4 py-3.5 active:opacity-70 disabled:opacity-50"
            >
              <LogOut className="w-5 h-5 text-orange-500 flex-none" />
              <div className="flex-1 text-left">
                <div className="font-medium text-orange-500">
                  {stopping ? "Returning…" : isDemoMode ? "Exit Demo Mode" : "Return to your account"}
                </div>
                <div className="text-sm text-orange-500/70">
                  {isDemoMode ? "Return to your own account" : `Viewing as ${session?.user.name}`}
                </div>
              </div>
            </button>
          </div>
        )}
        <div className="divide-y divide-border">
          {baseItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-4 px-4 min-h-[56px] active:bg-muted/50 transition-colors"
              >
                <Icon className="w-5 h-5 text-muted-foreground flex-none" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{item.label}</div>
                  {item.description && (
                    <div className="text-sm text-muted-foreground">
                      {item.description}
                    </div>
                  )}
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground flex-none" />
              </Link>
            );
          })}
          {isAdmin && (
            <Link
              href={adminItem.href}
              className="flex items-center gap-4 px-4 min-h-[56px] active:bg-muted/50 transition-colors"
            >
              <Shield className="w-5 h-5 text-muted-foreground flex-none" />
              <div className="flex-1 min-w-0">
                <div className="font-medium">{adminItem.label}</div>
                <div className="text-sm text-muted-foreground">{adminItem.description}</div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground flex-none" />
            </Link>
          )}
        </div>
      </main>
    </div>
  );
}
