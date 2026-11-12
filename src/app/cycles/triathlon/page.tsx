import { TriathlonPlanForm } from "@/components/features/TriathlonPlanForm";
import { getAthleteProfile } from "@/lib/athlete-profile";
import { enduranceEnabledFor } from "@/lib/endurance";
import { requireSession } from "@/lib/utils/session";
import { STRENGTH_GOAL_LABEL } from "@/lib/utils/strength-goal";
import { planDefaultsFromProfile } from "@/lib/utils/triathlon-plan";
import { redirect } from "next/navigation";

export default async function TriathlonPlanPage() {
  const session = await requireSession();
  // Part of the endurance add-on (src/lib/endurance.ts).
  if (!(await enduranceEnabledFor(session.user.id))) redirect("/cycles");
  // Making a plan starts with the intake interview (D10; docs/plans/athlete-profile.md, 2.7).
  const profile = await getAthleteProfile(session.user.id);
  if (!profile?.interviewCompletedAt) redirect("/more/athlete/interview?next=/cycles/triathlon");
  const defaults = planDefaultsFromProfile(profile);
  return (
    <TriathlonPlanForm
      initialLevel={defaults.level}
      initialRestDays={defaults.restDays}
      restNote={defaults.note}
      strengthGoal={profile.strengthGoal ? STRENGTH_GOAL_LABEL[profile.strengthGoal] : null}
    />
  );
}
