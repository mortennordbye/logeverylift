import { PlanHistoryPage } from "@/components/features/PlanHistoryPage";

type Props = { params: Promise<{ id: string }> };

/** A cycle's change history with restore (docs/plans/revisions.md, 2.9). */
export default async function CycleHistoryPage({ params }: Props) {
  const { id } = await params;
  return <PlanHistoryPage type="cycle" id={Number(id)} />;
}
