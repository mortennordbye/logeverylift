import { redirect } from "next/navigation";

/**
 * The triathlon plan is made in New season now ("Make a triathlon plan",
 * docs/plans/plan-tab-redesign.md, P4): a season whose phases end on race day.
 */
export default function TriathlonPlanPage() {
  redirect("/seasons/new?plan=triathlon");
}
