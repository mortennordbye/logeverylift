"use client";

import { AiCheckinCard } from "@/components/features/AiCheckinCard";
import type { McpAccess } from "@/lib/mcp/scopes";
import { Brain, ChevronDown, ChevronRight, History, MessageSquare, Plug, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const ACCESS_LABEL: Record<McpAccess, string> = { read: "Read only", write: "Read and change" };

type Props = {
  plan: { cycleId: number; name: string; week: number; weeks: number; weekdays: number[] | null } | null;
  checkin: { id: number; cycleName: string } | null;
  memoryCount: number;
  assistants: { id: string; name: string; access: McpAccess | null }[];
  lastChange: { clientName: string; when: string; lines: string[] } | null;
  changesThisWeek: number;
};

const card = "rounded-2xl bg-card border border-border";
const rowClass = "flex items-center gap-3 px-4 min-h-[56px] active:bg-muted/50 transition-colors";

function Row({ href, icon: Icon, title, sub }: { href: string; icon: typeof Brain; title: string; sub: string }) {
  return (
    <Link href={href} className={rowClass}>
      <Icon className="w-5 h-5 text-muted-foreground flex-none" />
      <div className="flex-1 min-w-0 py-2">
        <div className="font-medium">{title}</div>
        <div className="text-sm text-muted-foreground">{sub}</div>
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground flex-none" />
    </Link>
  );
}

/**
 * The AI coach hub (docs/plans/ai-coach-hub.md). A normal user sees the plan,
 * the check-in and their notes. The assistant card draws only once the user
 * has connected their own AI, which is also what changes a running plan.
 */
export function AiCoachHubClient({ plan, checkin, memoryCount, assistants, lastChange, changesThisWeek }: Props) {
  const [moreOpen, setMoreOpen] = useState(false);
  const connected = assistants.length > 0;
  const writer = assistants.find((a) => a.access === "write") ?? null;
  const first = assistants[0];
  const notes = memoryCount === 1 ? "1 note" : `${memoryCount} notes`;

  return (
    <div className="flex flex-col gap-3 px-4 pt-2 pb-8">
      {plan ? (
        <Link href={`/cycles/${plan.cycleId}`} className={`${card} p-4 active:opacity-80`} data-testid="coach-plan">
          <div className="text-lg font-semibold">{plan.name}</div>
          <div className="text-sm text-muted-foreground">
            Week {plan.week} of {plan.weeks}
          </div>
          <div className="h-1.5 rounded-full bg-muted mt-3 overflow-hidden">
            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(((plan.week - 1) / plan.weeks) * 100)}%` }} />
          </div>
          {plan.weekdays && (
            <div className="flex gap-1.5 mt-3">
              {WEEKDAYS.map((d, i) => (
                <span
                  key={d}
                  className={`flex-1 text-center rounded-lg py-1.5 text-xs ${
                    plan.weekdays!.includes(i + 1) ? "bg-primary/15 text-foreground font-semibold" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {d}
                </span>
              ))}
            </div>
          )}
        </Link>
      ) : (
        <div className={`${card} p-5 bg-gradient-to-br from-primary/15 via-card to-card`}>
          <div className="w-10 h-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center mb-3">
            <Sparkles className="w-5 h-5" />
          </div>
          <div className="text-lg font-semibold">Get a plan that fits your week</div>
          <p className="text-sm text-muted-foreground mt-1">
            Tell us your goal, how many days you train and what gym you have. Your coach builds the programs and the
            schedule.
          </p>
          <Link
            href="/more/ai-setup"
            className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground min-h-[48px] text-sm font-semibold active:opacity-80"
          >
            <Sparkles className="w-4 h-4" />
            Get a plan
          </Link>
        </div>
      )}

      {checkin && <AiCheckinCard id={checkin.id} cycleName={checkin.cycleName} />}

      {plan &&
        (writer ? (
          <div className={`${card} p-4`} data-testid="coach-ask">
            <div className="flex items-center gap-2 font-semibold">
              <Sparkles className="w-4 h-4 text-primary" />
              Ask {writer.name}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Open a chat in {writer.name}. It sees your plan and your notes, and can change your programs and days.
              Each change shows here.
            </p>
          </div>
        ) : (
          <Link href="/more/ai-coach/connect" className={`${card} p-4 active:opacity-80`} data-testid="coach-ask">
            <div className="flex items-center gap-2 font-semibold">
              <Sparkles className="w-4 h-4 text-primary" />
              <span className="flex-1">Change your plan with your own AI</span>
              <ChevronRight className="w-4 h-4 text-muted-foreground flex-none" />
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Connect Claude or ChatGPT. It sees your plan and your notes, and can change your programs and days.
            </p>
          </Link>
        ))}

      {!connected && (
        <div className={`${card} overflow-hidden`}>
          <Row href="/more/coach-memory" icon={Brain} title="Memory" sub={memoryCount > 0 ? `What your coach knows · ${notes}` : "What your coach knows · none yet"} />
        </div>
      )}

      {connected && (
        <section className="pt-3" aria-label="Your assistant">
          <h2 className="pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Your assistant</h2>
          <div className={`${card} overflow-hidden`}>
            <Link href="/more/assistants" className="flex items-center gap-3 p-4 active:bg-muted/50">
              <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center font-semibold flex-none">
                {first.name.slice(0, 1).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold truncate">
                  {first.name}
                  {assistants.length > 1 && <span className="text-muted-foreground font-normal"> and {assistants.length - 1} more</span>}
                </div>
                <div className="text-sm text-muted-foreground flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  {first.access ? ACCESS_LABEL[first.access] : "No access"}
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground flex-none" />
            </Link>
            {lastChange && (
              <Link href="/more/assistants/changes" className="block px-4 pb-4 active:opacity-80" data-testid="coach-last-change">
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    Last change · {lastChange.clientName} · {lastChange.when}
                  </span>
                  <ChevronRight className="w-4 h-4 flex-none" aria-label="See and undo" />
                </div>
                {lastChange.lines.length > 0 && (
                  <ul className="mt-1 text-sm list-disc pl-4">
                    {lastChange.lines.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                )}
              </Link>
            )}
            <div className="grid grid-cols-3 border-t border-border">
              {[
                { href: "/more/assistants/changes", icon: History, label: "Changes", sub: `${changesThisWeek} in 7 days` },
                { href: "/more/coach-memory", icon: Brain, label: "Memory", sub: notes },
                { href: "/more/assistants", icon: Plug, label: "Connection", sub: "On" },
              ].map((t, i) => (
                <Link
                  key={t.label}
                  href={t.href}
                  className={`flex flex-col items-center justify-center gap-0.5 py-3 min-h-[64px] active:bg-muted/50 ${i > 0 ? "border-l border-border" : ""}`}
                >
                  <t.icon className="w-5 h-5 text-muted-foreground" />
                  <span className="text-sm font-semibold">{t.label}</span>
                  <span className="text-xs text-muted-foreground">{t.sub}</span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      <button
        type="button"
        onClick={() => setMoreOpen((v) => !v)}
        aria-expanded={moreOpen}
        className="mt-4 flex items-center gap-3 border-t border-border pt-3 min-h-[56px] text-left active:opacity-70"
      >
        <span className="flex-1">
          <span className="block font-medium">More options</span>
          <span className="block text-sm text-muted-foreground">
            {plan ? "New plan, your own AI chat, connect an assistant" : "Your own AI chat, or connect an assistant"}
          </span>
        </span>
        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${moreOpen ? "rotate-180" : ""}`} />
      </button>
      {moreOpen && (
        <div className={`${card} overflow-hidden divide-y divide-border`}>
          {plan && <Row href="/more/ai-setup" icon={Sparkles} title="Build a new plan" sub="Start again with new picks" />}
          <Row href="/more/ai-coach/own-chat" icon={MessageSquare} title="Use your own AI chat" sub="ChatGPT, Gemini or Claude. Copy and paste." />
          <Row
            href="/more/ai-coach/connect"
            icon={Plug}
            title={connected ? "Connect another assistant" : "Connect an assistant"}
            sub="Let Claude or ChatGPT read and change your training"
          />
        </div>
      )}
    </div>
  );
}
