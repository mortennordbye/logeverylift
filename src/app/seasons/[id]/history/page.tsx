import { PlanHistoryPage } from "@/components/features/PlanHistoryPage";

type Props = { params: Promise<{ id: string }> };

/** A season's change history with restore (docs/plans/seasons.md, 2.10). */
export default async function SeasonHistoryPage({ params }: Props) {
  const { id } = await params;
  return <PlanHistoryPage type="season" id={Number(id)} />;
}
