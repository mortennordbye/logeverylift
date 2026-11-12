import { PlanHistoryPage } from "@/components/features/PlanHistoryPage";

type Props = { params: Promise<{ id: string }> };

/** A program's change history with restore (docs/plans/revisions.md, 2.9). */
export default async function ProgramHistoryPage({ params }: Props) {
  const { id } = await params;
  return <PlanHistoryPage type="program" id={Number(id)} />;
}
