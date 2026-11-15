import { HOME_UI } from "@/components/features/home/fonts";
import { SeasonForm, type PhaseSource } from "@/components/features/SeasonForm";
import { getAthleteProfile } from "@/lib/athlete-profile";
import { enduranceEnabledFor } from "@/lib/endurance";
import { startBlocks } from "@/lib/cycle-start";
import { seasonlessCycles } from "@/lib/seasons";
import { userToday } from "@/lib/user-settings";
import { toDateStr } from "@/lib/utils/cycle-position";
import { addDaysStr } from "@/lib/utils/seasons";
import { requireSession } from "@/lib/utils/session";

/**
 * New season (J4_SeasonSetup; docs/plans/plan-tab-redesign.md, P4). For every
 * user (D22); the race and the triathlon plan only with the endurance switch.
 * `?plan=triathlon` (from /cycles/triathlon) picks the triathlon plan.
 */
export default async function NewSeasonPage({ searchParams }: { searchParams: Promise<{ plan?: string }> }) {
  const auth = await requireSession();
  const userId = auth.user.id;
  const [today, enduranceEnabled, candidates, { plan }, { running, scheduled }] = await Promise.all([
    userToday(userId),
    enduranceEnabledFor(userId),
    seasonlessCycles(userId),
    searchParams,
    startBlocks(userId),
  ]);
  const todayStr = toDateStr(today);
  const profile = enduranceEnabled ? await getAthleteProfile(userId) : null;
  // The next Monday, or today on a Monday.
  const weekday = new Date(`${todayStr}T00:00:00Z`).getUTCDay();
  const defaultStart = addDaysStr(todayStr, (8 - weekday) % 7);
  // startsWith, not ===: Playwright's WebKit can get the page redirect's
  // Location twice and joins them ("triathlon, /seasons/new?plan=triathlon").
  const initialSource: PhaseSource = enduranceEnabled && plan?.startsWith("triathlon") ? "triathlon" : "later";

  return (
    <div className={`${HOME_UI} h-[100dvh] overflow-y-auto bg-home`}>
      <SeasonForm
        defaultStart={defaultStart}
        today={todayStr}
        running={running}
        scheduled={scheduled}
        enduranceEnabled={enduranceEnabled}
        profileReady={!!profile?.enduranceLevel && !!profile.availableDays?.length}
        candidates={candidates}
        initialSource={initialSource}
      />
    </div>
  );
}
