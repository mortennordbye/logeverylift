"use client";

/**
 * The endurance part of the home screen (docs/plans/workouts-and-compliance.md,
 * 6.5 to 6.7 and 7): "Did you do these?" for past sessions with no answer,
 * the suggested day for a missed key session, and the sick and return
 * banners. Rendered only with the endurance switch on; a lifter's home does
 * not change.
 */

import { EndIllness, shortDay } from "@/components/features/IllnessSheet";
import type { AnswerSession } from "@/components/features/answer-session";
import { AnswerButtons, AnswerSheets } from "@/components/features/SessionAnswers";
import { updatePlannedSession } from "@/lib/actions/planned-sessions";
import { callAction } from "@/lib/utils/stale-bundle";
import { useRouter } from "next/navigation";
import { useState } from "react";

export type MissedKeyRow = { session: AnswerSession; moveTo: string | null; reason: string | null };

/** The "Did you do these?" card and the missed key sessions with their suggested day. */
export function DidYouDoItCard({ unconfirmed, missedKey, today }: { unconfirmed: AnswerSession[]; missedKey: MissedKeyRow[]; today: string }) {
  const [answering, setAnswering] = useState<AnswerSession | null>(null);
  const [answered, setAnswered] = useState<Set<number>>(new Set());
  const open = unconfirmed.filter((s) => !answered.has(s.id));
  const markAnswered = (id: number) => setAnswered((prev) => new Set(prev).add(id));

  if (open.length === 0 && missedKey.length === 0 && answering === null) return null;
  return (
    <>
      {open.length > 0 && (
        <div className="rounded-2xl bg-muted px-4 py-3 shrink-0" data-testid="did-you-do-it">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Did you do these?</p>
          <ul className="flex flex-col divide-y divide-border/40">
            {open.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 py-2" data-testid="unconfirmed-session">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{s.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {shortDay(s.date)}
                    {s.summary ? ` · ${s.summary}` : ""}
                  </p>
                </div>
                <div className="shrink-0">
                  <AnswerButtons session={s} onYes={setAnswering} onAnswered={markAnswered} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {missedKey.length > 0 && (
        <div className="rounded-2xl bg-amber-500/10 border border-amber-500/30 px-4 py-3 shrink-0" data-testid="missed-key">
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300 mb-2">Missed key session</p>
          <ul className="flex flex-col divide-y divide-amber-500/20">
            {missedKey.map((m) => (
              <MissedKeyItem key={m.session.id} row={m} />
            ))}
          </ul>
        </div>
      )}
      <AnswerSheets session={answering} today={today} onClose={() => setAnswering(null)} onAnswered={markAnswered} />
    </>
  );
}

function MissedKeyItem({ row }: { row: MissedKeyRow }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function move(date: string) {
    if (pending) return;
    setPending(true);
    setError(null);
    const r = await callAction(updatePlannedSession({ op: "move", id: row.session.id, date }));
    setPending(false);
    if (!r.success) {
      setError(r.error);
      return;
    }
    router.refresh();
  }

  return (
    <li className="py-2 space-y-1.5" data-testid="missed-key-session">
      <p className="text-sm">
        <span className="text-muted-foreground">{shortDay(row.session.date)}: </span>
        <span className="font-medium">{row.session.name}</span>
      </p>
      {row.moveTo ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => move(row.moveTo!)}
          className="min-h-[44px] rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground active:opacity-80 disabled:opacity-50"
        >
          Move to {shortDay(row.moveTo)}
        </button>
      ) : (
        <p className="text-sm text-muted-foreground">{row.reason}</p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </li>
  );
}

export type ReturnRuleLine = { text: string; evidence: string };

/**
 * "Sick since Mon. Sessions are paused." with "I'm better" while a sick
 * period covers today; the return rule after it, first line only until
 * "More" is tapped.
 */
export function IllnessBanner({
  sick,
  returning,
  today,
}: {
  sick: { id: number; startedOn: string } | null;
  returning: ReturnRuleLine[] | null;
  today: string;
}) {
  const router = useRouter();
  const [more, setMore] = useState(false);
  if (sick) {
    return (
      <div className="rounded-2xl bg-violet-500/10 border border-violet-500/30 px-4 py-3 shrink-0 space-y-2" data-testid="sick-banner">
        <p className="text-sm font-medium">Sick since {shortDay(sick.startedOn)}. Sessions are paused.</p>
        <EndIllness id={sick.id} startedOn={sick.startedOn} today={today} onEnded={() => router.refresh()} />
      </div>
    );
  }
  if (!returning?.length) return null;
  const lines = more ? returning : returning.slice(0, 1);
  return (
    <div className="rounded-2xl bg-violet-500/10 border border-violet-500/30 px-4 py-3 shrink-0" data-testid="return-banner">
      <p className="text-xs font-semibold uppercase tracking-wider text-violet-700 dark:text-violet-300 mb-1">Back after being sick</p>
      <ul className="space-y-1.5">
        {lines.map((l) => (
          <li key={l.text} className="text-sm">
            {l.text}
            {more && <span className="block text-xs text-muted-foreground">{l.evidence}</span>}
          </li>
        ))}
      </ul>
      {returning.length > 1 && (
        <button type="button" aria-expanded={more} onClick={() => setMore(!more)} className="min-h-[44px] text-sm font-medium text-primary active:opacity-60">
          {more ? "Less" : "More"}
        </button>
      )}
    </div>
  );
}
